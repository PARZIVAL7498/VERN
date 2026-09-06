import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

type TraceRun = {
  runId: string;
  kind: string;
  startedAt: string;
  endedAt?: string;
  spans: Array<{ name: string; status: string; startedAt: string; endedAt?: string }>;
  tags: Record<string, string>;
};

export default async function TracesPage() {
  let runs: TraceRun[] = [];
  let error: string | null = null;
  try {
    const data = await apiFetch<{ runs: TraceRun[] }>('/v1/traces?limit=15');
    runs = data.runs;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load traces';
  }

  return (
    <main>
      <h1 className="rise">Agent traces</h1>
      <p className="lede rise-delay">
        In-app Neatlogs-style run spans (OCR → match → guardrails → route). Optional ship to{' '}
        <code>NEATLOGS_ENDPOINT</code> when configured.
      </p>
      {error && <p className="muted">{error}</p>}
      {!error && runs.length === 0 && (
        <p className="muted">No runs yet — ingest an invoice or reseed to populate traces.</p>
      )}
      <div className="stack">
        {runs.map((run) => (
          <article key={run.runId} className="card rise">
            <header>
              <strong>{run.kind}</strong>{' '}
              <span className="muted">{run.runId}</span>
            </header>
            <p className="muted">
              {run.startedAt}
              {run.endedAt ? ` → ${run.endedAt}` : ''}
            </p>
            <ol>
              {run.spans.map((s, i) => (
                <li key={`${run.runId}-${i}`}>
                  {s.name} — <span className={`pill ${s.status}`}>{s.status}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
      <p className="muted">
        <Link href="/">← Dashboard</Link>
      </p>
    </main>
  );
}
