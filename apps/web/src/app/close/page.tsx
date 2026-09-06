import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Checklist = { items: Array<{ id: string; label: string; status: string; detail: string }> };
type Cash = {
  pendingAp: number;
  postedAp: number;
  openExceptionsAmount: number;
  projectedCashOut7d: number;
  asOf: string;
};
type Variance = { period: string; draft: string; drivers: Array<{ label: string; amount: number }> };

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default async function ClosePage() {
  let checklist: Checklist | null = null;
  let cash: Cash | null = null;
  let variance: Variance | null = null;
  let error: string | null = null;
  try {
    [checklist, cash, variance] = await Promise.all([
      apiFetch<Checklist>('/v1/close/checklist'),
      apiFetch<Cash>('/v1/close/cash'),
      apiFetch<Variance>('/v1/close/variance'),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load close pack';
  }

  return (
    <main>
      <h1 className="rise">Close & cash</h1>
      <p className="lede rise-delay">
        Period close checklist, cash snapshot from AP outcomes, and draft variance commentary for
        the controller — Office of the CFO layer on top of the AP spine.
      </p>
      {error && <p className="muted">{error}</p>}

      {cash && (
        <>
          <h2 className="section-title">Cash snapshot</h2>
          <div className="metrics rise">
            <div className="metric">
              <div className="label">Posted AP</div>
              <div className="value">{money(cash.postedAp)}</div>
            </div>
            <div className="metric">
              <div className="label">Pending AP</div>
              <div className="value">{money(cash.pendingAp)}</div>
            </div>
            <div className="metric">
              <div className="label">Open exceptions $</div>
              <div className="value">{money(cash.openExceptionsAmount)}</div>
            </div>
            <div className="metric">
              <div className="label">7d cash out (proj.)</div>
              <div className="value">{money(cash.projectedCashOut7d)}</div>
            </div>
          </div>
        </>
      )}

      {checklist && (
        <>
          <h2 className="section-title">Close checklist</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {checklist.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    <span className={`pill ${item.status}`}>{item.status}</span>
                  </td>
                  <td className="muted">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {variance && (
        <>
          <h2 className="section-title">Variance draft — {variance.period}</h2>
          <p className="rise">{variance.draft}</p>
          <ul>
            {variance.drivers.map((d) => (
              <li key={d.label}>
                {d.label}: {money(d.amount)}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted">
        <Link href="/">← Dashboard</Link>
      </p>
    </main>
  );
}
