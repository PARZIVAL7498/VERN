# Jarvis — personal assistant

Chat-first assistant with tools, memory, and optional browser voice.

## Run

```bash
npx pnpm@9.15.0 --filter @vern/jarvis dev
```

Open http://127.0.0.1:3100

## Tools

| Tool | What it does |
| --- | --- |
| `get_briefing` | Greeting, time, reminders, notes |
| `remember` / `recall` | Long-lived facts |
| `add_note` / `list_notes` | Scratch notes |
| `add_reminder` / `list_reminders` / `complete_reminder` | Reminders |
| `draft_message` | Draft only — never auto-sends |
| `get_time` | Local time |

## Safety

Risky actions (send email) are **draft-only** with an explicit confirm warning. No wake-word continuous listening — push-to-talk Mic only.
