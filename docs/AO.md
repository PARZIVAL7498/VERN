# AO build plan (Syndicate requirement)

Judges review **AO session count** in the demo video. Use [Agent Orchestrator](https://aoagents.dev/) for VERN — do not build only in Cursor.

## One-time setup

1. Install AO desktop: https://aoagents.dev/docs/installation/
2. `gh auth login` (GitHub projects)
3. Add this repo: **Add project** → path to this `VERN` checkout
4. Optional CLI (daemon must be running via desktop):

```bash
ao status
ao doctor
ao project add --path . --worker-agent cursor --name vern
ao spawn --project vern --name core-pkg --kind worker --mode chat --prompt "Harden @vern/core governance and ERP stubs"
ao spawn --project vern --name api-routes --kind worker --mode chat --prompt "Extend Fastify AP invoice APIs and SoD"
ao spawn --project vern --name web-cfo --kind worker --mode chat --prompt "CFO dashboard and exception queue UX"
ao spawn --project vern --name worker-batch --kind worker --mode chat --prompt "Batch worker for invoice ingest"
ao session ls
```

`--name` max **20 characters**.

## Sessions to record (fill after spawn)

Edit [ao-sessions.md](./ao-sessions.md) with real IDs from the AO sidebar.

## Demo video beat (AO)

1. Show AO project **VERN** with 3+ worker sessions.
2. Open one Chat/TUI session briefly.
3. Cut to http://127.0.0.1:3000 product demo.
4. Say in voiceover how many AO sessions you used.

## Cursor helper

Use the `ao-expert` subagent for AO CLI / Chat vs TUI / claim-PR questions.
