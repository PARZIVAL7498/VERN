# VERN — Autonomous Office of the CFO (Track 2)

**Track:** Syndicate by Maximor — [Autonomous Office of the CFO](https://maaztwts.notion.site/Syndicate-by-Maximor-3cc32902e4a38075bfa9f03149ef150d)  
**Core idea:** Month-end **AP exception review** with intuitive controller judgment — Learn → Run → Escalate → Improve on ERP stubs (aligned with [Maximor](https://www.maximor.ai/)).

## Pain point (why accountants care)

Close week floods AP with PDF invoices. Blind auto-post is a SOX risk; ticket queues hide *why* something failed. Controllers need: match evidence, fraud/guardrail chips, a recommended action, SoD that blocks clerks from clearing controller items, and policy that learns from overrides — not another chatbot wrapper.

## What ships

1. Extract → ERP match (NetSuite/SAP/Workday/Dynamics **stubs**) → confidence route  
2. Hard guardrails the LLM cannot disable; SoD on approve  
3. **Exception review desk** — risk summary, recommended action, policy-learn preview  
4. Explain view with tool-call audit evidence  
5. Thin **Assist** chat (same SoD) for “what’s blocking close?”  
6. Close checklist / cash / variance draft  

## Setup

```bash
npx pnpm@9.15.0 i
cp .env.example .env
npx pnpm@9.15.0 --filter @vern/api seed
npx pnpm@9.15.0 --filter @vern/api dev
npx pnpm@9.15.0 --filter @vern/web dev
```

- Web (CFO): http://127.0.0.1:3000  
- API: http://127.0.0.1:4000/health  

## Jarvis (personal assistant)

Separate app: chat + memory + notes + reminders + message drafts + optional voice (Web Speech).

```bash
npx pnpm@9.15.0 i
npx pnpm@9.15.0 --filter @vern/jarvis dev
```

- Jarvis UI: http://127.0.0.1:3100  
- Optional `TENSORMUX_API_KEY` for smarter routing/narration (works without it via keyword tools)

Try: “Good morning”, “Remember that my focus is VERN”, “Remind me to record the demo”, Mic + Speak replies.

## 3-minute demo script (record this)

1. **Pain (15s):** Dashboard — open exceptions $ / auto-post rate.  
2. **Run (40s):** Note one auto-posted invoice; open bank-change / blocked exceptions.  
3. **Judgment (60s):** Exceptions desk → Explain → switch to `ap_clerk` → Approve → SoD callout → switch to `controller` → Approve → policy learn line.  
4. **Close (30s):** `/close` checklist + variance draft.  
5. **Assist (20s):** “What’s blocking close?”  
6. **AO (15s):** Show AO sessions used while building ([docs/AO.md](docs/AO.md)).

Do **not** leave the video to the last hour. Skip login/2FA theater.

## AO usage

Required for judging. See [docs/AO.md](docs/AO.md) and log IDs in [docs/ao-sessions.md](docs/ao-sessions.md).

## Env

| Variable | Purpose |
| --- | --- |
| `TENSORMUX_API_KEY` | Optional Assist / narration |
| `TENSORMUX_BASE_URL` | `https://api.tensormux.com/v1` |
| `VERN_DATA_DIR` | JSON persist |
| `NEXT_PUBLIC_API_URL` | Web → API |

## API (high level)

`POST /v1/invoices/ingest` · `GET /v1/exceptions` (includes **judgment cards**) · approve/reject ·  
`GET /v1/invoices/:id/explain` · `POST /v1/assistant/chat` · `GET /v1/close/*` · `GET /v1/dashboards/cfo` · audit export  

## Devpost checklist

- [ ] Track **2**  
- [ ] Public GitHub  
- [ ] Demo video (product + AO)  
- [ ] How judgment + policy learn work  
- [ ] Session count in AO  
