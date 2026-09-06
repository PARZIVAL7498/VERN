import { narrateExplain } from './agent.js';
import type { ErpConnector } from './connectors/erp.js';
import { NetSuiteStub } from './connectors/erp.js';
import {
  draftToPartialInvoice,
  extractFromSampleText,
  extractInvoiceFromPdf,
  type ExtractedInvoiceDraft,
  type StructuredInvoiceFallback,
} from './documents/ocr.js';
import type {
  AuditEvent,
  Decision,
  DecisionOutcome,
  ExceptionItem,
  GuardrailContext,
  Invoice,
  PurchaseOrder,
  ToolCallEvidence,
  UserRole,
  Vendor,
} from './domain.js';
import {
  HardGuardrailPolicy,
  appendAuditEvent,
  buildExplainView,
} from './governance.js';
import type { TenantRules } from './rules.js';
import { defaultTenantRules } from './rules.js';
import { uniqueId } from './ids.js';
import { detectFraudSignals, scoreConfidence } from './scoring.js';
import { endRun, endSpan, startRun, startSpan } from './tracing.js';

export { scoreConfidence, detectFraudSignals } from './scoring.js';

export interface ProcessInvoiceInput {
  tenantId: string;
  entityId: string;
  invoiceId?: string;
  /** Raw PDF buffer, invoice text, structured fallback, or sample text */
  document: Buffer | string | StructuredInvoiceFallback;
  sampleText?: boolean;
  erp?: ErpConnector & {
    findVendorByName?(name: string): Vendor | undefined;
    findPoByNumber?(number: string): PurchaseOrder | undefined;
  };
  rules?: TenantRules;
  previousInvoices?: Invoice[];
  actor?: string;
  actorRole?: UserRole;
  audits?: AuditEvent[];
  exceptions?: ExceptionItem[];
  decisions?: Decision[];
  narrate?: boolean;
}

export interface ProcessInvoiceResult {
  invoice: Invoice;
  draft: ExtractedInvoiceDraft;
  decision: Decision;
  exception?: ExceptionItem;
  explain: ReturnType<typeof buildExplainView>;
  erpPostingId?: string;
}

function tool(toolName: string, inputSummary: string, outputSummary: string): ToolCallEvidence {
  return { tool: toolName, inputSummary, outputSummary, at: new Date().toISOString() };
}

export async function processInvoice(input: ProcessInvoiceInput): Promise<ProcessInvoiceResult> {
  const run = startRun('process_invoice', {
    tenantId: input.tenantId,
    entityId: input.entityId,
  });
  const spanAll = startSpan(run, 'pipeline', { invoiceId: input.invoiceId });
  try {
    const result = await processInvoiceInner(input, run);
    endSpan(spanAll, 'ok', {
      outcome: result.decision.outcome,
      invoiceId: result.invoice.id,
      confidence: result.decision.confidence,
    });
    endRun(run);
    return result;
  } catch (err) {
    endSpan(spanAll, 'error', {
      message: err instanceof Error ? err.message : String(err),
    });
    endRun(run);
    throw err;
  }
}

async function processInvoiceInner(
  input: ProcessInvoiceInput,
  run: ReturnType<typeof startRun>,
): Promise<ProcessInvoiceResult> {
  const audits = input.audits ?? [];
  const exceptions = input.exceptions ?? [];
  const decisions = input.decisions ?? [];
  const rules = input.rules ?? defaultTenantRules(input.tenantId);
  const erp = input.erp ?? new NetSuiteStub(input.tenantId);
  const previous = input.previousInvoices ?? [];
  const toolCalls: ToolCallEvidence[] = [];
  const reasoning: string[] = [];

  const ocrSpan = startSpan(run, 'ocr.extract');
  const draft =
    input.sampleText && typeof input.document === 'string'
      ? extractFromSampleText(input.document)
      : extractInvoiceFromPdf(input.document);
  endSpan(ocrSpan, 'ok', {
    invoiceNumber: draft.invoiceNumber,
    vendorName: draft.vendorName,
    totalAmount: draft.totalAmount,
  });
  toolCalls.push(
    tool(
      'ocr.extract',
      `method=${draft.extractionMethod}`,
      `invoice=${draft.invoiceNumber} vendor=${draft.vendorName} total=${draft.totalAmount}`,
    ),
  );
  reasoning.push(`Extracted invoice ${draft.invoiceNumber} via ${draft.extractionMethod}`);

  const invoiceId = input.invoiceId ?? uniqueId('inv');
  let invoice: Invoice = {
    ...draftToPartialInvoice(draft, {
      id: invoiceId,
      tenantId: input.tenantId,
      entityId: input.entityId,
    }),
    status: 'extracted',
  };

  let vendor: Vendor | undefined;
  if (draft.vendorId) {
    vendor = await erp.getVendor(draft.vendorId);
    toolCalls.push(tool('erp.getVendor', draft.vendorId, vendor ? vendor.name : 'not found'));
  }
  if (!vendor && 'findVendorByName' in erp && typeof erp.findVendorByName === 'function') {
    vendor = erp.findVendorByName(draft.vendorName);
    toolCalls.push(
      tool('erp.findVendorByName', draft.vendorName, vendor ? vendor.id : 'not found'),
    );
  }
  if (vendor) {
    invoice = {
      ...invoice,
      vendorId: vendor.id,
      vendorName: vendor.name,
      status: 'matched',
      updatedAt: new Date().toISOString(),
    };
    reasoning.push(`Matched vendor ${vendor.name} (${vendor.id})`);
  } else {
    reasoning.push(`Vendor "${draft.vendorName}" not found in ERP`);
  }

  let po: PurchaseOrder | undefined;
  if (draft.poNumber && 'findPoByNumber' in erp && typeof erp.findPoByNumber === 'function') {
    po = erp.findPoByNumber(draft.poNumber);
    toolCalls.push(tool('erp.findPoByNumber', draft.poNumber, po ? po.id : 'not found'));
  }
  if (po) {
    invoice = {
      ...invoice,
      poId: po.id,
      poNumber: po.number,
      updatedAt: new Date().toISOString(),
    };
    reasoning.push(`Matched PO ${po.number}`);
  }

  const fraudSignals = detectFraudSignals(invoice, vendor, previous, rules.approvalAmountLimit);
  reasoning.push(
    fraudSignals.length
      ? `Fraud signals: ${fraudSignals.join(', ')}`
      : 'No fraud signals detected',
  );

  void HardGuardrailPolicy.CANNOT_BE_DISABLED_BY_LLM;
  const policy = new HardGuardrailPolicy();
  const blockedIds = [
    ...new Set([...rules.blockedVendorIds, ...(vendor?.blocked ? [vendor.id] : [])]),
  ];
  const gctx: GuardrailContext = {
    tenantId: input.tenantId,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.actorRole ? { actorRole: input.actorRole } : {}),
    approvalAmountLimit: rules.approvalAmountLimit,
    autoPostThreshold: rules.autoPostThreshold,
    blockedVendorIds: blockedIds,
    shortPayTolerance: rules.shortPayTolerance,
    ...(vendor ? { matchedVendor: vendor } : {}),
    ...(po ? { matchedPo: po } : {}),
    previousInvoices: previous,
  };
  const guard = policy.evaluate(invoice, gctx);
  toolCalls.push(
    tool(
      'governance.hardGuardrails',
      `amount=${invoice.totalAmount}`,
      `blocked=${guard.blocked} requireController=${guard.requireController} hits=${guard.hits.join('|') || 'none'}`,
    ),
  );
  reasoning.push(...guard.reasons);

  const amountVariance = po ? Math.abs(po.totalAmount - invoice.totalAmount) : undefined;
  const scored = scoreConfidence({
    vendorMatched: Boolean(vendor),
    poMatched: Boolean(po),
    fraudSignals,
    guardrailHits: guard.hits,
    extractionWarnings: draft.warnings.length,
    ...(amountVariance !== undefined ? { amountVariance } : {}),
    shortPayTolerance: rules.shortPayTolerance,
    autoPostThreshold: rules.autoPostThreshold,
  });
  let route = scored.route;
  if (route === 'auto_post' && scored.confidence < rules.autoPostThreshold) {
    route = 'exception_queue';
    reasoning.push(
      `Confidence ${scored.confidence} below tenant autoPostThreshold ${rules.autoPostThreshold}`,
    );
  }
  reasoning.push(...scored.reasons);

  let outcome: DecisionOutcome = 'exception_queue';
  if (guard.blocked) {
    outcome = 'blocked';
    route = 'exception_queue';
  } else if (guard.requireController) {
    outcome = 'require_controller';
    route = 'require_approval';
  } else if (route === 'auto_post' && fraudSignals.length === 0) {
    outcome = 'auto_post';
  } else if (route === 'require_approval') {
    outcome = 'require_controller';
  } else {
    outcome = 'exception_queue';
  }

  let erpPostingId: string | undefined;
  let exception: ExceptionItem | undefined;

  if (outcome === 'auto_post') {
    const post = await erp.postInvoice(invoice);
    toolCalls.push(
      tool('erp.postInvoice', invoice.id, `${post.status}:${post.postingId || post.message}`),
    );
    if (post.status === 'posted') {
      erpPostingId = post.postingId;
      invoice = {
        ...invoice,
        status: 'auto_posted',
        erpPostingId,
        confidence: scored.confidence,
        updatedAt: new Date().toISOString(),
      };
      reasoning.push(`Auto-posted to ERP as ${erpPostingId}`);
    } else {
      outcome = 'exception_queue';
      route = 'exception_queue';
      reasoning.push(`ERP post rejected: ${post.message}`);
    }
  }

  if (outcome !== 'auto_post') {
    invoice = {
      ...invoice,
      status: outcome === 'blocked' ? 'rejected' : 'exception',
      confidence: scored.confidence,
      updatedAt: new Date().toISOString(),
    };
  }

  const decisionId = uniqueId('dec');
  let explainText = [`Decision ${outcome} for ${invoice.invoiceNumber}`, ...reasoning.slice(0, 8)].join(
    '. ',
  );

  if (input.narrate !== false) {
    explainText = await narrateExplain({
      invoiceNumber: invoice.invoiceNumber,
      outcome,
      confidence: scored.confidence,
      reasoning,
      fraudSignals,
      guardrailHits: guard.hits,
    });
  }

  const decision: Decision = {
    id: decisionId,
    tenantId: input.tenantId,
    invoiceId: invoice.id,
    outcome,
    confidence: scored.confidence,
    route,
    reasoning,
    fraudSignals,
    guardrailHits: guard.hits,
    toolCalls,
    explainText,
    createdAt: new Date().toISOString(),
    ...(input.actor ? { actor: input.actor } : {}),
  };
  decisions.push(decision);

  appendAuditEvent(audits, {
    tenantId: input.tenantId,
    entityType: 'invoice',
    entityId: invoice.id,
    action: 'process_invoice',
    actor: input.actor ?? 'system',
    ...(input.actorRole ? { actorRole: input.actorRole } : {}),
    after: { decisionId, outcome, confidence: scored.confidence, route },
    metadata: { toolCallCount: toolCalls.length },
  });

  if (outcome !== 'auto_post') {
    const severity =
      outcome === 'blocked' || fraudSignals.includes('duplicate_invoice')
        ? 'critical'
        : guard.requireController || fraudSignals.length
          ? 'high'
          : 'medium';
    exception = {
      id: uniqueId('exc'),
      tenantId: input.tenantId,
      invoiceId: invoice.id,
      decisionId,
      severity,
      reasons: [...guard.reasons, ...fraudSignals.map((s) => `fraud:${s}`), `route:${route}`],
      status: 'open',
      assignedRole:
        outcome === 'require_controller' || guard.requireController ? 'controller' : 'ap_clerk',
      createdAt: new Date().toISOString(),
    };
    exceptions.push(exception);
    appendAuditEvent(audits, {
      tenantId: input.tenantId,
      entityType: 'exception',
      entityId: exception.id,
      action: 'enqueue_exception',
      actor: 'system',
      after: exception,
    });
  }

  return {
    invoice,
    draft,
    decision,
    ...(exception ? { exception } : {}),
    explain: buildExplainView(decision),
    ...(erpPostingId ? { erpPostingId } : {}),
  };
}
