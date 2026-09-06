/**
 * Lightweight Neatlogs-compatible / local agent run tracing.
 * When NEATLOGS_ENDPOINT + NEATLOGS_API_KEY are set, spans POST to the collector.
 * Always keeps an in-memory ring buffer for GET /v1/traces and demo evidence.
 */

export interface TraceSpan {
  id: string;
  runId: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: 'ok' | 'error' | 'running';
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
}

export interface AgentRunTrace {
  runId: string;
  kind: string;
  startedAt: string;
  endedAt?: string;
  spans: TraceSpan[];
  tags: Record<string, string>;
}

const MAX_RUNS = 100;
const runs: AgentRunTrace[] = [];

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function startRun(kind: string, tags: Record<string, string> = {}): AgentRunTrace {
  const run: AgentRunTrace = {
    runId: id('run'),
    kind,
    startedAt: new Date().toISOString(),
    spans: [],
    tags,
  };
  runs.unshift(run);
  if (runs.length > MAX_RUNS) runs.pop();
  return run;
}

export function startSpan(
  run: AgentRunTrace,
  name: string,
  input?: unknown,
): TraceSpan {
  const span: TraceSpan = {
    id: id('span'),
    runId: run.runId,
    name,
    startedAt: new Date().toISOString(),
    status: 'running',
    ...(input !== undefined ? { input } : {}),
  };
  run.spans.push(span);
  return span;
}

export function endSpan(
  span: TraceSpan,
  status: 'ok' | 'error',
  output?: unknown,
  meta?: Record<string, unknown>,
): void {
  span.endedAt = new Date().toISOString();
  span.status = status;
  if (output !== undefined) span.output = output;
  if (meta) span.meta = { ...span.meta, ...meta };
}

export function endRun(run: AgentRunTrace): void {
  run.endedAt = new Date().toISOString();
  void shipRun(run);
}

export function listRuns(limit = 20): AgentRunTrace[] {
  return runs.slice(0, limit).map((r) => structuredClone(r));
}

export function getRun(runId: string): AgentRunTrace | undefined {
  const hit = runs.find((r) => r.runId === runId);
  return hit ? structuredClone(hit) : undefined;
}

async function shipRun(run: AgentRunTrace): Promise<void> {
  const endpoint = process.env.NEATLOGS_ENDPOINT;
  const apiKey = process.env.NEATLOGS_API_KEY;
  if (!endpoint || !apiKey) return;
  try {
    await fetch(endpoint.replace(/\/$/, '') + '/v1/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        source: 'vern',
        ...run,
      }),
    });
  } catch {
    // tracing must never break AP posting
  }
}
