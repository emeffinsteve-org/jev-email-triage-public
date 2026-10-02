# Operations

How the deployed pipeline actually runs. This is the runbook for the thing
the cron executes; `README.md` next to it covers what each file does.

## The schedule

One cron, `jev-email-triage`, every 15 minutes (America/New_York).

- Owner: `goal:jev-email-triage`
- Timeout: 1200s per tick
- Delivery: surfaced mail goes to your alert destination (chat, webhook, etc.).
  Silence when nothing surfaced (no "all clear" messages).

Each tick runs, in order:

1. **Gmail** — `JEV_CONCURRENCY=10 node triage.mjs --limit=50`, looped until
   caught up: after each run, if the summary line says "0 triaged", stop;
   otherwise wait ~25 seconds and run a fresh batch. Cap 10 iterations per
   tick so the run fits its time budget; anything left drains next tick.
2. **Outlook** (`you@work.example.com`) —
   `node triage-outlook.mjs --limit=40`. One pass per tick.
3. Read the outbox JSON file(s) named in the summary lines and post each
   surfaced email (sender, subject, received date, score, one-line reason).
4. If a script fails (auth error, API down, repeated Jev errors), post a
   brief failure note naming the mailbox and the error.

Hard rules the cron follows: never mark mail read, never archive, delete,
or move anything. The Gmail script applies the BULLSHIT label itself;
Outlook bullshit is log-only.

## Concurrency ceiling

`triage.mjs` runs a worker pool sized by `JEV_CONCURRENCY` (default 10).

- 10-way: ~44s per 50 emails, runs clean. This is the ceiling.
- 50-way: ~30s per 50 emails, but every `messages.modify` label write
  fails — the Gmail connector's Sentinel rate limit trips
  (`connector_rate_limited`, retry ~48s, terminal for the attempt).

Do not raise concurrency above 10. If label writes ever start failing in
bulk again, `repair-labels.mjs` re-applies the BULLSHIT label from the
decision log at a gentle 1.5s pace (it fixed all 44 on 2026-09-30).

## Runtime data (gitignored, lives next to the scripts)

| Path | What it is |
|---|---|
| `state/processed.json` | Gmail message ids already triaged (the dedupe watermark) |
| `state/processed-outlook.json` | Same, for Outlook |
| `logs/decisions.jsonl` | One JSON line per Gmail triage: score, answers, contributions, action |
| `logs/decisions-outlook.jsonl` | Same, for Outlook |
| `logs/usage.jsonl` | TypeSafe token usage per email (cost tracking) |
| `outbox/surfaced-*.json` | Surfaced emails per run, read by the cron for delivery |

The decision logs are append-only. They are the calibration dataset:
once ~50 emails carry the owner's own verdicts, the weights in `config.json`
get fitted against them.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `connector_rate_limited` on label writes | Concurrency raised, or Gmail-side burst | Lower to 10, then run `repair-labels.mjs` |
| TypeSafe 429/529 | Credit exhausted or API trouble | Retries with backoff are built in (4x); check your TypeSafe credential / API status |
| `no surrogate for custom.typesafe` | authd unreachable | The pipeline only runs where authd is reachable (see the portability notes in triage.mjs) |
| Outlook `withheld` skips | Connector redacts the message | Logged as SKIP; nothing to do |
| Cron tick times out | Backlog larger than 10 iterations | By design: the remainder drains on the next tick |

## Timezone

The pipeline assumes the machine's local timezone is America/New_York
(the cron's timezone): `lib/dates.mjs` mixes local-midnight date math
with America/New_York formatting. On a UTC box the resolved date strings
shift. The offline tests pin `process.env.TZ = 'America/New_York'` so CI
means the same thing everywhere; a production move off Eastern would need
`dates.mjs` to stop using local-midnight.

## One-off tools

- `node repair-labels.mjs` — re-apply BULLSHIT where label writes failed.
  Reads `logs/decisions.jsonl`; only touches ids whose latest decision was
  a label (never surfaced mail).
- `node triage.mjs --dry-run` — score without changing anything in Gmail.
  Writes the decision log marked `dry_run: true`.
