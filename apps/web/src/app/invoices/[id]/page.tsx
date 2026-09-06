import Link from 'next/link';
import { apiFetch, type ExplainPayload } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function InvoiceExplainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: ExplainPayload | null = null;
  let error: string | null = null;
  try {
    data = await apiFetch<ExplainPayload>(`/v1/invoices/${id}/explain`);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Not found';
  }

  const tools = data?.explain.toolCalls ?? [];

  return (
    <main>
      <p className="muted">
        <Link href="/exceptions">← Exception review desk</Link>
      </p>
      <h1 className="rise">Why this invoice routed here</h1>
      {error && <p className="muted">{error}</p>}
      {data && (
        <>
          <p className="lede rise-delay">
            {data.invoice.invoiceNumber} · {data.invoice.vendorName ?? 'Unknown vendor'} ·{' '}
            {data.invoice.currency} {data.invoice.totalAmount.toLocaleString()} ·{' '}
            <span className="badge">{data.invoice.status}</span>
          </p>

          <div className="callout rise">
            <strong>Controller read</strong>
            <p>{data.explain.summary}</p>
            <p className="muted">
              Outcome <strong>{data.explain.outcome}</strong> · route{' '}
              <strong>{data.explain.route}</strong> · confidence{' '}
              <strong>{Math.round(data.explain.confidence * 100)}%</strong>
              {' — '}
              hard guardrails cannot be disabled by the model.
            </p>
          </div>

          <div className="stack">
            <div className="panel">
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Reasoning chain
              </h2>
              <ul className="list">
                {data.explain.reasoning.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Fraud signals
              </h2>
              {data.explain.fraudSignals.length === 0 ? (
                <p className="muted">None detected</p>
              ) : (
                <ul className="list">
                  {data.explain.fraudSignals.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel">
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Guardrail hits
              </h2>
              {data.explain.guardrailHits.length === 0 ? (
                <p className="muted">None</p>
              ) : (
                <ul className="list">
                  {data.explain.guardrailHits.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel">
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Tool calls (audit evidence)
              </h2>
              {tools.length === 0 ? (
                <p className="muted">No tool trace on this decision</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>In</th>
                      <th>Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((t) => (
                      <tr key={`${t.tool}-${t.inputSummary}`}>
                        <td>{t.tool}</td>
                        <td className="muted">{t.inputSummary}</td>
                        <td className="muted">{t.outputSummary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
