import type { ExceptionItem, Invoice } from './domain.js';
import { applyOverrideToRules, type TenantRules } from './rules.js';

/**
 * Learn → Improve: human approvals of borderline exceptions nudge tenant policy.
 * Hard blocked-vendor list is never auto-cleared.
 */
export function learnFromHumanDecision(args: {
  rules: TenantRules;
  invoice: Invoice;
  exception: ExceptionItem;
  action: 'approve' | 'reject';
}): { rules: TenantRules; learned: string[] } {
  const learned: string[] = [];
  let patch: Partial<TenantRules> = {};
  const reasons = args.exception.reasons.join(' ').toLowerCase();

  if (args.action === 'approve') {
    if (reasons.includes('just_under_threshold')) {
      const next = Math.max(
        args.rules.approvalAmountLimit,
        Math.ceil(args.invoice.totalAmount + 250),
      );
      if (next > args.rules.approvalAmountLimit) {
        patch = { ...patch, approvalAmountLimit: next };
        learned.push(
          `Raised approvalAmountLimit ${args.rules.approvalAmountLimit} → ${next} after controller approved just-under-threshold invoice`,
        );
      }
    }
    if (reasons.includes('short') || reasons.includes('po amount variance')) {
      const bump = Math.max(args.rules.shortPayTolerance, 75);
      if (bump > args.rules.shortPayTolerance) {
        patch = { ...patch, shortPayTolerance: bump };
        learned.push(`Raised shortPayTolerance to ${bump} (SHORT-PAY style policy)`);
      }
    }
  }

  if (args.action === 'reject' && reasons.includes('duplicate')) {
    // keep threshold tight — no relaxation
    learned.push('Rejected duplicate — autoPostThreshold unchanged (tightened governance)');
  }

  if (Object.keys(patch).length === 0) {
    return { rules: args.rules, learned };
  }
  return { rules: applyOverrideToRules(args.rules, patch), learned };
}
