import type {
  AuditEvent,
  Decision,
  ExplainView,
  GuardrailContext,
  GuardrailEvaluation,
  HumanOverride,
  Invoice,
  UserRole,
} from './domain.js';

let auditSeq = 0;
let overrideSeq = 0;

function nextId(prefix: string, n: number): string {
  return `${prefix}-${Date.now()}-${n}`;
}

/**
 * Hard guardrails — cannot be disabled by LLM or feature flags.
 * Policy is always enforced server-side.
 */
export class HardGuardrailPolicy {
  /** Immutable marker: LLMs must not toggle this. */
  static readonly CANNOT_BE_DISABLED_BY_LLM = true as const;

  evaluate(invoice: Invoice, context: GuardrailContext): GuardrailEvaluation {
    const hits: string[] = [];
    const reasons: string[] = [];
    let blocked = false;
    let requireController = false;

    const vendorId = invoice.vendorId ?? context.matchedVendor?.id;
    const vendor = context.matchedVendor;

    if (vendor?.blocked || (vendorId && context.blockedVendorIds.includes(vendorId))) {
      blocked = true;
      hits.push('blocked_vendor');
      reasons.push(
        `Vendor ${vendor?.name ?? vendorId} is blocked` +
          (vendor?.blockReason ? `: ${vendor.blockReason}` : ''),
      );
    }

    if (invoice.totalAmount > context.approvalAmountLimit) {
      requireController = true;
      hits.push('amount_over_threshold');
      reasons.push(
        `Amount ${invoice.totalAmount} exceeds controller approval limit ${context.approvalAmountLimit}`,
      );
    }

    // Segregation of duties: AP clerk cannot approve own high-value or self-matched posts
    if (context.actorRole === 'ap_clerk' && invoice.totalAmount > context.autoPostThreshold) {
      requireController = true;
      hits.push('sod_ap_clerk_high_value');
      reasons.push('SoD: AP clerk cannot auto-approve amounts above auto-post threshold');
    }

    if (context.actorRole === 'ap_clerk' && context.actor && invoice.metadata?.createdBy === context.actor) {
      requireController = true;
      hits.push('sod_self_approval');
      reasons.push('SoD: preparer cannot approve their own invoice');
    }

    // Short-pay vs PO outside tolerance escalates
    if (context.matchedPo) {
      const delta = Math.abs(context.matchedPo.totalAmount - invoice.totalAmount);
      const tol = context.shortPayTolerance;
      if (delta > tol) {
        requireController = true;
        hits.push('po_amount_variance');
        reasons.push(
          `Invoice vs PO variance ${delta} exceeds short-pay tolerance ${tol}`,
        );
      }
    }

    const allowed = !blocked;
    return { allowed, blocked, requireController, hits, reasons };
  }
}

export function appendAuditEvent(
  events: AuditEvent[],
  partial: Omit<AuditEvent, 'id' | 'at'> & { id?: string; at?: string },
): AuditEvent {
  auditSeq += 1;
  const event: AuditEvent = {
    id: partial.id ?? nextId('audit', auditSeq),
    tenantId: partial.tenantId,
    entityType: partial.entityType,
    entityId: partial.entityId,
    action: partial.action,
    actor: partial.actor,
    ...(partial.actorRole ? { actorRole: partial.actorRole } : {}),
    at: partial.at ?? new Date().toISOString(),
    ...(partial.before !== undefined ? { before: partial.before } : {}),
    ...(partial.after !== undefined ? { after: partial.after } : {}),
    ...(partial.reason ? { reason: partial.reason } : {}),
    ...(partial.metadata ? { metadata: partial.metadata } : {}),
  };
  events.push(event);
  return event;
}

export function buildExplainView(decision: Decision): ExplainView {
  const summaryParts = [
    `Outcome: ${decision.outcome}`,
    `Route: ${decision.route}`,
    `Confidence: ${(decision.confidence * 100).toFixed(1)}%`,
  ];
  if (decision.guardrailHits.length) {
    summaryParts.push(`Guardrails: ${decision.guardrailHits.join(', ')}`);
  }
  if (decision.fraudSignals.length) {
    summaryParts.push(`Fraud signals: ${decision.fraudSignals.join(', ')}`);
  }

  return {
    summary: summaryParts.join(' | '),
    reasoning: [...decision.reasoning],
    fraudSignals: [...decision.fraudSignals],
    guardrailHits: [...decision.guardrailHits],
    toolCalls: [...decision.toolCalls],
    confidence: decision.confidence,
    route: decision.route,
    outcome: decision.outcome,
  };
}

export function recordOverride(
  overrides: HumanOverride[],
  audits: AuditEvent[],
  input: {
    tenantId: string;
    who: string;
    whoRole: UserRole;
    why: string;
    before: unknown;
    after: unknown;
    invoiceId?: string;
  },
): HumanOverride {
  overrideSeq += 1;
  const audit = appendAuditEvent(audits, {
    tenantId: input.tenantId,
    entityType: input.invoiceId ? 'invoice' : 'rules',
    entityId: input.invoiceId ?? 'tenant-rules',
    action: 'human_override',
    actor: input.who,
    actorRole: input.whoRole,
    before: input.before,
    after: input.after,
    reason: input.why,
  });

  const override: HumanOverride = {
    id: nextId('override', overrideSeq),
    tenantId: input.tenantId,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    who: input.who,
    whoRole: input.whoRole,
    why: input.why,
    before: input.before,
    after: input.after,
    at: new Date().toISOString(),
    auditEventId: audit.id,
  };
  overrides.push(override);
  return override;
}
