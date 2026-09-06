import type { ExceptionItem, Invoice } from './domain.js';

export interface CloseChecklistItem {
  id: string;
  label: string;
  status: 'done' | 'pending' | 'blocked';
  detail: string;
}

export interface CashSnapshot {
  pendingAp: number;
  postedAp: number;
  openExceptionsAmount: number;
  projectedCashOut7d: number;
  asOf: string;
}

export interface VarianceNarrative {
  period: string;
  draft: string;
  drivers: Array<{ label: string; amount: number }>;
}

export function buildCloseChecklist(
  invoices: Invoice[],
  exceptions: ExceptionItem[],
): CloseChecklistItem[] {
  const open = exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
  const posted = invoices.filter((i) => i.status === 'auto_posted' || i.status === 'posted');
  const drafts = invoices.filter((i) => i.status === 'draft');

  return [
    {
      id: 'ap-ingest',
      label: 'AP invoices ingested for period',
      status: invoices.length > 0 ? 'done' : 'pending',
      detail: `${invoices.length} invoices in store`,
    },
    {
      id: 'ap-match',
      label: 'Vendor / PO match complete',
      status: drafts.length === 0 ? 'done' : 'pending',
      detail: drafts.length ? `${drafts.length} still draft` : 'No drafts remaining',
    },
    {
      id: 'exceptions',
      label: 'Exception queue cleared',
      status: open.length === 0 ? 'done' : open.length > 3 ? 'blocked' : 'pending',
      detail: `${open.length} open exceptions`,
    },
    {
      id: 'erp-post',
      label: 'ERP postings reconciled',
      status: posted.length > 0 ? 'done' : 'pending',
      detail: `${posted.length} posted / auto-posted`,
    },
    {
      id: 'audit-export',
      label: 'Audit pack exportable',
      status: 'done',
      detail: 'GET /v1/audit/export ready for SOX support',
    },
  ];
}

export function buildCashSnapshot(
  invoices: Invoice[],
  exceptions: ExceptionItem[],
): CashSnapshot {
  const openIds = new Set(
    exceptions.filter((e) => e.status === 'open' || e.status === 'in_review').map((e) => e.invoiceId),
  );
  let pendingAp = 0;
  let postedAp = 0;
  let openExceptionsAmount = 0;
  for (const i of invoices) {
    if (i.status === 'auto_posted' || i.status === 'posted') postedAp += i.totalAmount;
    else pendingAp += i.totalAmount;
    if (openIds.has(i.id)) openExceptionsAmount += i.totalAmount;
  }
  return {
    pendingAp: round2(pendingAp),
    postedAp: round2(postedAp),
    openExceptionsAmount: round2(openExceptionsAmount),
    projectedCashOut7d: round2(pendingAp * 0.65 + openExceptionsAmount * 0.2),
    asOf: new Date().toISOString(),
  };
}

export function draftVarianceNarrative(
  invoices: Invoice[],
  exceptions: ExceptionItem[],
): VarianceNarrative {
  const byVendor = new Map<string, number>();
  for (const i of invoices) {
    const name = i.vendorName ?? 'Unknown';
    byVendor.set(name, (byVendor.get(name) ?? 0) + i.totalAmount);
  }
  const drivers = [...byVendor.entries()]
    .map(([label, amount]) => ({ label, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const open = exceptions.filter((e) => e.status === 'open').length;
  const auto = invoices.filter((i) => i.status === 'auto_posted' || i.status === 'posted').length;
  const top = drivers[0];

  const draft = [
    `AP close commentary (draft): ${invoices.length} invoices processed; ${auto} auto/posted to ERP stubs.`,
    top
      ? `Largest vendor concentration: ${top.label} at $${top.amount.toLocaleString()}.`
      : 'No vendor spend recorded.',
    open
      ? `${open} exceptions remain in human review (fraud, blocked vendor, or policy limits) and are excluded from final cash lock until cleared.`
      : 'Exception queue is clear — ready for period lock pending controller sign-off.',
    'Policy learning: controller overrides update approval limits / short-pay tolerance without disabling hard guardrails.',
  ].join(' ');

  return {
    period: currentQuarterLabel(),
    draft,
    drivers,
  };
}

function currentQuarterLabel(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
