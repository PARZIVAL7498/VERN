# VERN — Personal CFO

**VERN** is your personal CFO. You are the CEO. Ask in voice or text; get plain-English answers with **Critical / Watch / OK**, then a clear recommendation — spoken aloud and on screen.

Under the hood, VERN runs a governed AP judgment pipeline (extract → ERP match → confidence route → hard guardrails / SoD → policy learn) so answers stay grounded in exception evidence, not chatbot fluff.

How judgment + policy learn work: [docs/JUDGMENT.md](docs/JUDGMENT.md).

## Monorepo layout

| Path | Role |
| --- | --- |
| `packages/vern-core` | Domain, pipeline, judgment, guardrails, ERP stubs, personal memory, CFO agent |
| `apps/vern` | Next.js personal CFO UI + `/api/chat`, `/api/briefing`, `/api/tts` |
| `apps/api` | Legacy Fastify sketch (orphan source; not wired by root `dev`) |
| `apps/worker` | Legacy batch ingest sketch (orphan source; not wired by root `dev`) |

## Setup

Requires Node ≥ 20.

```bash
npx pnpm@9.15.0 i
cp .env.example .env   # add TENSORMUX_API_KEY
npx pnpm@9.15.0 seed
npx pnpm@9.15.0 dev
```

Open **http://127.0.0.1:3000**

## Try

- “What's on fire?”
- “Morning briefing”
- “Explain the Northwind issue”
- “Remind me to call the board”
- Mic + Speak replies

## What VERN knows

- **Memory (always on):** your name, reminders, notes, preferences + company pressure snapshot
- **Thinking profile:** quietly learns your ideation, priorities, and how you decide — then adapts replies
- **Tools (on demand):** exceptions, invoice explain, cash/close, briefing
- **LLM (TensorMux):** writes every spoken/chat reply from memory + tool facts (templates only if API fails)

Set `VERN_LLM_REPLY=0` in `.env` for template-only mode. Set `VERN_LEARN=0` to disable thinking-profile learning.

## Env

| Variable | Purpose |
| --- | --- |
| `TENSORMUX_API_KEY` | Smarter tool pick + spoken narration |
| `TENSORMUX_BASE_URL` | `https://api.tensormux.com/v1` |
| `TENSORMUX_MODEL` | default `glm-4-7-flash` |
| `VERN_DATA_DIR` | JSON stores (`company-store.json`, `personal-store.json`) |
| `VERN_LLM_REPLY` | `1` = LLM narrates every reply from memory+tools; `0` = templates only |
| `VERN_LLM_TIMEOUT_MS` | LLM reply timeout (default `12000`) |
| `VERN_LEARN` | `1` = learn thinking/ideation from chats; `0` = off |
| `VERN_LEARN_EVERY_N` | Learn every N user turns (default `3`; prefs learn immediately) |
| `VERN_LEARN_TIMEOUT_MS` | Thinking-profile learn timeout (default `10000`) |

## AO

Built with [AO (Agent Orchestrator)](https://aoagents.dev/) — see [docs/AO.md](docs/AO.md).

1. Add project `D:\VERN` (or your checkout path) in AO desktop
2. Spawn workers — log IDs in [docs/ao-sessions.md](docs/ao-sessions.md)
3. Launch via [`.ao/launch.json`](.ao/launch.json) → port 3000

## Deploy

### Vercel (UI)

1. Import the GitHub repo
2. Set **Root Directory** to `apps/vern` (uses [`apps/vern/vercel.json`](apps/vern/vercel.json))
3. Add the env vars from the table above (at least `TENSORMUX_API_KEY`)

Note: JSON stores on Vercel are ephemeral; demos may re-seed on cold start.

### Render

Use the Blueprint in [`render.yaml`](render.yaml):

1. Dashboard → New → Blueprint → connect this repo
2. Set `TENSORMUX_API_KEY` when prompted
3. Service runs `@vern/vern` (`pnpm` build/start)

Free tier disk is ephemeral. For sticky memory, attach a disk at `/var/data` and set `VERN_DATA_DIR=/var/data`.

## Tests

```bash
npx pnpm@9.15.0 test
# or
npx pnpm@9.15.0 --filter @vern/core test
```

## Ship checklist

- [x] Public GitHub — https://github.com/PARZIVAL7498/VERN
- [x] How judgment + policy learn work — [docs/JUDGMENT.md](docs/JUDGMENT.md)
- [ ] Sync local `main` with `origin/main` (local was ahead/behind during last check — merge/rebase before push)
- [ ] Demo video (product + AO)
- [ ] Session IDs in AO — paste into [docs/ao-sessions.md](docs/ao-sessions.md) after spawn
