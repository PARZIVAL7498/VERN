import type { AuditEvent, ExceptionItem, Invoice } from './domain.js';

export interface CfoDashboardRollup {
  invoiceCount: number;
  totalSpend: number;
  autoPostedCount: number;
  autoPostedAmount: number;
  exceptionCount: number;
  openExceptions: number;
  criticalExceptions: number;
  blockedOrRejected: number;
  avgConfidence: number | null;
  autoPostRate: number;
  exceptionRate: number;
  spendByVendor: Array<{ vendorId: string; vendorName: string; amount: number; count: number }>;
  spendByStatus: Record<string, { count: number; amount: number }>;
  auditActionsLast24h: number;
  topExceptionReasons: Array<{ reason: string; count: number }>;
  generatedAt: string;
}

export function cfoDashboardRollup(
  invoices: Invoice[],
  exceptions: ExceptionItem[],
  audits: AuditEvent[],
): CfoDashboardRollup {
  const totalSpend = sum(invoices.map((i) => i.totalAmount));
  const autoPosted = invoices.filter(
    (i) => i.status === 'auto_posted' || i.status === 'posted',
  );
  const blockedOrRejected = invoices.filter(
    (i) => i.status === 'rejected' || i.status === 'exception',
  ).length;

  const confidences = invoices
    .map((i) => i.confidence)
    .filter((c): c is number => typeof c === 'number');
  const avgConfidence =
    confidences.length === 0 ? null : sum(confidences) / confidences.length;

  const spendByVendorMap = new Map<
    string,
    { vendorId: string; vendorName: string; amount: number; count: number }
  >();
  for (const inv of invoices) {
    const key = inv.vendorId ?? inv.vendorName ?? 'unknown';
    const cur = spendByVendorMap.get(key) ?? {
      vendorId: inv.vendorId ?? 'unknown',
      vendorName: inv.vendorName ?? 'Unknown',
      amount: 0,
      count: 0,
    };
    cur.amount += inv.totalAmount;
    cur.count += 1;
    spendByVendorMap.set(key, cur);
  }

  const spendByStatus: Record<string, { count: number; amount: number }> = {};
  for (const inv of invoices) {
    const bucket = spendByStatus[inv.status] ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += inv.totalAmount;
    spendByStatus[inv.status] = bucket;
  }

  const reasonCounts = new Map<string, number>();
  for (const ex of exceptions) {
    for (const r of ex.reasons) {
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
  }
  const topExceptionReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const auditActionsLast24h = audits.filter((a) => Date.parse(a.at) >= dayAgo).length;

  const invoiceCount = invoices.length;
  return {
    invoiceCount,
    totalSpend: round2(totalSpend),
    autoPostedCount: autoPosted.length,
    autoPostedAmount: round2(sum(autoPosted.map((i) => i.totalAmount))),
    exceptionCount: exceptions.length,
    openExceptions: exceptions.filter((e) => e.status === 'open' || e.status === 'in_review')
      .length,
    criticalExceptions: exceptions.filter((e) => e.severity === 'critical').length,
    blockedOrRejected,
    avgConfidence: avgConfidence === null ? null : round3(avgConfidence),
    autoPostRate: invoiceCount === 0 ? 0 : round3(autoPosted.length / invoiceCount),
    exceptionRate: invoiceCount === 0 ? 0 : round3(exceptions.length / invoiceCount),
    spendByVendor: [...spendByVendorMap.values()]
      .map((v) => ({ ...v, amount: round2(v.amount) }))
      .sort((a, b) => b.amount - a.amount),
    spendByStatus,
    auditActionsLast24h,
    topExceptionReasons,
    generatedAt: new Date().toISOString(),
  };
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
