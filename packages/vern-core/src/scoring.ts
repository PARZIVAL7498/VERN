import type { ConfidenceRouteResult, Invoice, Vendor } from './domain.js';

export function detectFraudSignals(
  invoice: Invoice,
  vendor: Vendor | undefined,
  previous: Invoice[],
  approvalLimit: number,
): string[] {
  const signals: string[] = [];

  if (vendor?.bankChangedAt) {
    const changed = Date.parse(vendor.bankChangedAt);
    if (Number.isFinite(changed) && Date.now() - changed < 30 * 24 * 60 * 60 * 1000) {
      signals.push('recent_bank_change');
    }
  }
  if (
    invoice.bankAccountLast4 &&
    vendor?.bankAccountLast4 &&
    invoice.bankAccountLast4 !== vendor.bankAccountLast4
  ) {
    signals.push('bank_account_mismatch');
  }

  const justUnder = approvalLimit - invoice.totalAmount;
  if (justUnder >= 0 && justUnder <= approvalLimit * 0.05) {
    signals.push('just_under_threshold');
  }

  const dup = previous.find(
    (p) =>
      p.id !== invoice.id &&
      p.invoiceNumber === invoice.invoiceNumber &&
      (p.vendorId === invoice.vendorId || p.vendorName === invoice.vendorName) &&
      Math.abs(p.totalAmount - invoice.totalAmount) < 0.01,
  );
  if (dup) signals.push('duplicate_invoice');

  return signals;
}

export function scoreConfidence(args: {
  vendorMatched: boolean;
  poMatched: boolean;
  fraudSignals: string[];
  guardrailHits: string[];
  extractionWarnings: number;
  amountVariance?: number;
  shortPayTolerance: number;
  autoPostThreshold?: number;
}): ConfidenceRouteResult {
  let confidence = 0.55;
  const reasons: string[] = [];

  if (args.vendorMatched) {
    confidence += 0.2;
    reasons.push('vendor matched in ERP');
  } else {
    confidence -= 0.15;
    reasons.push('vendor not matched');
  }

  if (args.poMatched) {
    confidence += 0.15;
    reasons.push('PO matched');
  } else {
    confidence -= 0.05;
    reasons.push('no PO match');
  }

  confidence -= Math.min(0.2, args.extractionWarnings * 0.05);
  if (args.extractionWarnings) {
    reasons.push(`${args.extractionWarnings} extraction warning(s)`);
  }

  confidence -= Math.min(0.35, args.fraudSignals.length * 0.12);
  for (const s of args.fraudSignals) reasons.push(`fraud: ${s}`);

  if (args.guardrailHits.includes('blocked_vendor')) {
    confidence = Math.min(confidence, 0.1);
    reasons.push('blocked vendor caps confidence');
  }

  if (args.amountVariance !== undefined && args.amountVariance > args.shortPayTolerance) {
    confidence -= 0.1;
    reasons.push('PO amount variance');
  }

  confidence = Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));
  const thresholdUsed = args.autoPostThreshold ?? 0.85;
  let route: ConfidenceRouteResult['route'] = 'exception_queue';
  if (
    confidence >= thresholdUsed &&
    args.fraudSignals.length === 0 &&
    !args.guardrailHits.length
  ) {
    route = 'auto_post';
  } else if (confidence >= 0.6 && args.fraudSignals.length <= 1) {
    route = 'require_approval';
  }

  return { confidence, route, reasons, thresholdUsed };
}
