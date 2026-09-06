import type { ExceptionItem, Invoice, UserRole } from './domain.js';
import { learnFromHumanDecision } from './learn.js';
import type { TenantRules } from './rules.js';

export type JudgmentAction = 'approve' | 'reject' | 'escalate_cfo';

export interface JudgmentCard {
  exceptionId: string;
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amount: number;
  currency: string;
  severity: string;
  reasons: string[];
  fraudChips: string[];
  guardrailChips: string[];
  recommendedAction: JudgmentAction;
  recommendationRationale: string;
  policyLearnPreview: string[];
  sod: {
    apClerkCanApprove: boolean;
    requiresController: boolean;
    requiresCfo: boolean;
    message: string;
  };
  riskSummary: string;
}

function chipsFromReasons(reasons: string[]): { fraud: string[]; guardrail: string[] } {
  const fraud: string[] = [];
  const guardrail: string[] = [];
  for (const r of reasons) {
    const lower = r.toLowerCase();
    if (lower.startsWith('fraud:')) fraud.push(r.replace(/^fraud:/i, ''));
    else if (lower.includes('blocked') || lower.includes('approval limit') || lower.includes('variance'))
      guardrail.push(r);
    else if (lower.startsWith('route:')) continue;
    else guardrail.push(r);
  }
  return { fraud, guardrail };
}

/** Build accountant-facing judgment metadata for an open exception. */
export function buildJudgmentCard(args: {
  exception: ExceptionItem;
  invoice: Invoice;
  rules: TenantRules;
}): JudgmentCard {
  const { exception, invoice, rules } = args;
  const text = exception.reasons.join(' ').toLowerCase();
  const { fraud, guardrail } = chipsFromReasons(exception.reasons);

  const blocked = text.includes('blocked');
  const bank =
    text.includes('bank_change') ||
    text.includes('bank_account') ||
    text.includes('recent_bank');
  const duplicate = text.includes('duplicate');
  const justUnder = text.includes('just_under');
  const overLimit = text.includes('exceeds controller approval') || text.includes('approval limit');
  const requiresController =
    exception.assignedRole === 'controller' ||
    overLimit ||
    justUnder ||
    Boolean(duplicate) ||
    bank;
  const requiresCfo = blocked;

  let recommendedAction: JudgmentAction = 'approve';
  let recommendationRationale =
    'Matched controls look reviewable — controller may approve to post if business intent is confirmed.';

  if (blocked) {
    recommendedAction = 'escalate_cfo';
    recommendationRationale =
      'Vendor is on the blocked list (sanctions/OFAC-style). Do not AP-approve — CFO override only after compliance review.';
  } else if (duplicate) {
    recommendedAction = 'reject';
    recommendationRationale =
      'Duplicate invoice number/amount/vendor pattern. Reject unless treasury confirms a legitimate rebill.';
  } else if (bank) {
    recommendedAction = 'escalate_cfo';
    recommendationRationale =
      'Vendor bank details changed recently or mismatch on invoice. Treat as payment-fraud risk; escalate before posting.';
  } else if (justUnder) {
    recommendedAction = 'approve';
    recommendationRationale =
      'Amount sits just under the approval threshold (classic threshold-gaming signal). Approve only if PO/receipt support the spend — policy may learn a higher limit.';
  } else if (overLimit) {
    recommendedAction = 'approve';
    recommendationRationale =
      'Over controller auto limit but not blocked. Controller judgment required before ERP post.';
  }

  const preview = learnFromHumanDecision({
    rules,
    invoice,
    exception,
    action: recommendedAction === 'reject' ? 'reject' : 'approve',
  });

  const riskBits: string[] = [];
  if (blocked) riskBits.push('blocked vendor');
  if (bank) riskBits.push('bank-change fraud risk');
  if (duplicate) riskBits.push('possible duplicate payment');
  if (justUnder) riskBits.push('just-under-threshold');
  if (overLimit) riskBits.push('over approval limit');
  if (riskBits.length === 0) riskBits.push('policy / confidence route');

  let sodMessage = 'Controller or CFO may resolve this exception.';
  if (requiresCfo) {
    sodMessage =
      'SoD: AP clerks cannot clear blocked-vendor items. CFO override required after review.';
  } else if (requiresController) {
    sodMessage =
      'SoD: assigned to controller. An AP clerk attempting Approve will be denied — switch role to controller.';
  }

  return {
    exceptionId: exception.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    vendorName: invoice.vendorName ?? 'Unknown vendor',
    amount: invoice.totalAmount,
    currency: invoice.currency,
    severity: exception.severity,
    reasons: exception.reasons,
    fraudChips: fraud,
    guardrailChips: guardrail,
    recommendedAction,
    recommendationRationale,
    policyLearnPreview: preview.learned.length
      ? preview.learned
      : ['No policy change expected from this action (hard guardrails stay enforced).'],
    sod: {
      apClerkCanApprove: !requiresController && !requiresCfo,
      requiresController,
      requiresCfo,
      message: sodMessage,
    },
    riskSummary: `${invoice.currency} ${invoice.totalAmount.toLocaleString()} · ${riskBits.join(
      ', ',
    )}`,
  };
}

export function canRoleAct(
  role: UserRole,
  card: JudgmentCard,
  action: 'approve' | 'reject',
): { ok: boolean; message?: string } {
  if (role === 'auditor') {
    return { ok: false, message: 'Auditors are read-only on the exception queue.' };
  }
  if (action === 'approve' && card.sod.requiresCfo && role !== 'cfo') {
    return { ok: false, message: card.sod.message };
  }
  if (action === 'approve' && card.sod.requiresController && role === 'ap_clerk') {
    return { ok: false, message: card.sod.message };
  }
  return { ok: true };
}
