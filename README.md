# VERN — Personal CFO

**VERN** is your personal CFO. You are the CEO. Ask in voice or text; get plain-English answers with **Critical / Watch / OK**, then a clear recommendation — spoken aloud and on screen.

Built with [AO (Agent Orchestrator)](https://aoagents.dev/) — see [docs/AO.md](docs/AO.md).

## Setup

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

## AO

1. Add project `D:\VERN` in AO desktop  
2. Spawn workers (`vern-core`, `vern-app`, …) — log IDs in [docs/ao-sessions.md](docs/ao-sessions.md)  
3. Launch via `.ao/launch.json` → port 3000  

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
