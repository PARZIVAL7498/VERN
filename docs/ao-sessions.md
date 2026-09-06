# AO session log

Fill **Session ID** from the AO sidebar after spawn (judges check this in the demo video).

| Session name | Session ID | Role | Harness | What it built |
| --- | --- | --- | --- | --- |
| core-pkg | _(paste from AO)_ | worker | Cursor | `@vern/core` pipeline / governance / ERP stubs |
| api-routes | _(paste from AO)_ | worker | Cursor | `@vern/api` invoice APIs and SoD |
| web-cfo | _(paste from AO)_ | worker | Cursor | `@vern/web` dashboard + exception desk |
| worker-batch | _(paste from AO)_ | worker | Cursor | `@vern/worker` batch ingest |

Total sessions used: **4 planned** (update after spawn)

## Spawn commands (once AO daemon is running)

```bash
ao spawn --project vern --name core-pkg --kind worker --mode chat --prompt "Harden @vern/core governance and ERP stubs"
ao spawn --project vern --name api-routes --kind worker --mode chat --prompt "Extend Fastify AP invoice APIs and SoD"
ao spawn --project vern --name web-cfo --kind worker --mode chat --prompt "CFO dashboard and exception queue UX"
ao spawn --project vern --name worker-batch --kind worker --mode chat --prompt "Batch worker for invoice ingest"
ao session ls
```

Notes for Devpost: Built product primarily with Cursor; AO sessions are required for Track 2 judging — show session list in the last 15s of the demo video.
