import Link from 'next/link';
import { AssistPanel } from '@/components/assist/AssistPanel';
import { apiFetch, type CfoDashboard } from '@/lib/api';

export const dynamic = 'force-dynamic';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function DashboardPage() {
  let dash: CfoDashboard | null = null;
  let error: string | null = null;
  try {
    dash = await apiFetch<CfoDashboard>('/v1/dashboards/cfo');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load dashboard';
  }

  return (
    <main>
      <h1 className="rise">CFO rollup</h1>
      <p className="lede rise-delay">
        Month-end AP close pulse — what auto-posted, what needs controller judgment, and how much
        cash is still stuck in exceptions.
      </p>

      {error && (
        <p className="muted">
          API unavailable ({error}). Start <code>@vern/api</code> on port 4000.
        </p>
      )}

      {dash && (
        <>
          <div className="metrics rise">
            <div className="metric">
              <div className="label">Total spend</div>
              <div className="value">{money(dash.totalSpend)}</div>
            </div>
            <div className="metric">
              <div className="label">Invoices</div>
              <div className="value">{dash.invoiceCount}</div>
            </div>
            <div className="metric">
              <div className="label">Auto-posted</div>
              <div className="value">{dash.autoPostedCount}</div>
            </div>
            <div className="metric">
              <div className="label">Open exceptions</div>
              <div className="value">{dash.openExceptions}</div>
            </div>
            <div className="metric">
              <div className="label">Auto-post rate</div>
              <div className="value">{pct(dash.autoPostRate)}</div>
            </div>
            <div className="metric">
              <div className="label">Avg confidence</div>
              <div className="value">
                {dash.avgConfidence == null ? '—' : pct(dash.avgConfidence)}
              </div>
            </div>
          </div>

          <p className="rise">
            <Link className="btn" href="/exceptions">
              Open exception review desk →
            </Link>
          </p>

          <h2 className="section-title">Spend by vendor</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Invoices</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {dash.spendByVendor.slice(0, 8).map((v) => (
                <tr key={v.vendorId}>
                  <td>{v.vendorName}</td>
                  <td>{v.count}</td>
                  <td>{money(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="section-title">Top exception reasons</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {dash.topExceptionReasons.slice(0, 6).map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
              {dash.topExceptionReasons.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No exceptions yet — <Link href="/exceptions">open the queue</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <AssistPanel role="controller" />
    </main>
  );
}
