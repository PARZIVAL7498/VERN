import { NextResponse } from 'next/server';
import { getCompanyStore, getPersonalStore } from '@/lib/stores';
import { cfoDashboardRollup, buildCashSnapshot } from '@vern/core';

export const dynamic = 'force-dynamic';

export async function GET() {
  const company = await getCompanyStore();
  const personal = await getPersonalStore();
  const name = personal.recall('ceo_name')[0]?.value ?? 'boss';
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const open = company.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
  const cash = buildCashSnapshot(company.invoices, company.exceptions);
  const rollup = cfoDashboardRollup(company.invoices, company.exceptions, company.audits);
  const text = open.map((e) => e.reasons.join(' ')).join(' ').toLowerCase();
  const criticality =
    text.includes('blocked') || text.includes('bank')
      ? 'Critical'
      : open.length > 0
        ? 'Watch'
        : 'OK';

  return NextResponse.json({
    greeting: `Good ${part}, ${name}`,
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    criticality,
    openExceptions: open.length,
    openAmount: cash.openExceptionsAmount,
    autoPosted: rollup.autoPostedCount,
    openReminders: personal.listReminders().slice(0, 5),
  });
}
