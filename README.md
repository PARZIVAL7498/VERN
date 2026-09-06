# VERN — Autonomous Office of the CFO (Track 2)

**Track:** Syndicate by Maximor — [Autonomous Office of the CFO](https://maaztwts.notion.site/Syndicate-by-Maximor-3cc32902e4a38075bfa9f03149ef150d)  
**Core idea:** Month-end **AP exception review** with intuitive controller judgment — Learn → Run → Escalate → Improve on ERP stubs (aligned with [Maximor](https://www.maximor.ai/)).

Close week floods AP with PDF invoices. Blind auto-post is a SOX risk; ticket queues hide *why* something failed. Controllers need match evidence, fraud/guardrail chips, a recommended action, SoD that blocks clerks from clearing controller items, and policy that learns from overrides — not another chatbot wrapper.

## What ships

1. Extract → ERP match (NetSuite / SAP / Workday / Dynamics **stubs**) → confidence route  
2. Hard guardrails the LLM cannot disable; SoD on approve  
3. **Exception review desk** — risk summary, recommended action, policy-learn preview  
4. Explain view with tool-call audit evidence  
5. Thin **Assist** chat (same SoD) for “what’s blocking close?”  
6. Close checklist / cash / variance draft  

How judgment + policy learn work: [docs/JUDGMENT.md](docs/JUDGMENT.md).

## Monorepo layout

| Path | Role |
| --- | --- |
| `packages/vern-core` | Domain, pipeline, judgment, guardrails, ERP stubs, store |
| `apps/api` | Fastify HTTP over the store |
| `apps/web` | CFO UI (dashboard, exceptions, close, assist) |
| `apps/worker` | Optional batch ingest (posts to API) |
| `packages/jarvis-core` + `apps/jarvis` | Separate personal assistant |

## Setup

Requires Node ≥ 20.

```bash
npx pnpm@9.15.0 i
cp .env.example .env
npx pnpm@9.15.0 seed
npx pnpm@9.15.0 --filter @vern/api dev
npx pnpm@9.15.0 --filter @vern/web dev
```

Or: `npx pnpm@9.15.0 dev` (API + web).

| Surface | URL |
| --- | --- |
| Web (CFO) | http://127.0.0.1:3000 |
| API health | http://127.0.0.1:4000/health |

## Jarvis (personal assistant)

```bash
npx pnpm@9.15.0 --filter @vern/jarvis dev
```

- UI: http://127.0.0.1:3100  
- Optional `TENSORMUX_API_KEY` (keyword tools work without it)

## 3-minute demo script

1. **Pain (15s):** Dashboard — open exceptions $ / auto-post rate.  
2. **Run (40s):** Note one auto-posted invoice; open bank-change / blocked exceptions.  
3. **Judgment (60s):** Exceptions desk → Explain → switch to `ap_clerk` → Approve → SoD callout → switch to `controller` → Approve → policy learn line.  
4. **Close (30s):** `/close` checklist + variance draft.  
5. **Assist (20s):** “What’s blocking close?”  
6. **AO (15s):** Show AO sessions ([docs/AO.md](docs/AO.md) / [docs/ao-sessions.md](docs/ao-sessions.md)).

Skip login/2FA theater.

## AO usage

Required for judging. See [docs/AO.md](docs/AO.md) and log IDs in [docs/ao-sessions.md](docs/ao-sessions.md).

## Env

| Variable | Purpose |
| --- | --- |
| `TENSORMUX_API_KEY` | Optional Assist / narration |
| `TENSORMUX_BASE_URL` | `https://api.tensormux.com/v1` |
| `VERN_DATA_DIR` | JSON persist (default `./data`) |
| `NEXT_PUBLIC_API_URL` | Web → API |
| `PORT` | API port (default `4000`) |
| `JARVIS_DATA_DIR` | Jarvis persist |

## API (high level)

`POST /v1/invoices/ingest` (JSON text **or** multipart file) · `POST /v1/batches/invoices` ·  
`GET /v1/exceptions` (judgment cards) · approve/reject ·  
`GET /v1/invoices/:id/explain` · `POST /v1/assistant/chat` · `GET /v1/close/*` ·  
`GET /v1/dashboards/cfo` · `GET /v1/audit/export` · `GET /v1/connectors`

## Tests

```bash
npx pnpm@9.15.0 --filter @vern/core test
```

## Ship checklist

- [x] Public GitHub — https://github.com/PARZIVAL7498/VERN  
- [x] How judgment + policy learn work — [docs/JUDGMENT.md](docs/JUDGMENT.md)  
- [ ] Demo video (product + AO) — record using script above  
- [ ] Session IDs in AO — paste into [docs/ao-sessions.md](docs/ao-sessions.md) after spawn  
