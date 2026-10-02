# deployed/

This is the system that runs. Every 15 minutes the `jev-email-triage` cron
executes these scripts against your real mailboxes. See `OPERATIONS.md` for the schedule, runbook, and failure modes.

## What it does

Each unread email gets exactly one Jev judgement, then a composite score
decides its fate. Two outcomes, no middle ground:

- **Show** — surfaced to you at your alert destination.
- **BULLSHIT** — left unread in the inbox, tagged with the `BULLSHIT` Gmail
  label (Outlook: logged only; the connector cannot apply labels).

Nothing is archived, deleted, marked read, or moved. That restraint is the
whole design: the BULLSHIT pile is the safety net, so a wrong call costs
nothing. See `../docs/adr/0001-label-only-binary-phase.md`.

## Files

| File | Job |
|---|---|
| `triage.mjs` | Gmail pipeline. Lists unread inbox mail, builds Jev state per email, one Jev call per email (worker pool, `JEV_CONCURRENCY`), composite score, surface or label. |
| `triage-outlook.mjs` | Outlook (M365, `you@work.example.com`) pipeline. Same battery and composite, serial execution. Bullshit is log-only. |
| `repair-labels.mjs` | One-off maintenance: re-applies BULLSHIT where label writes failed, read from the decision log. Not scheduled. |
| `config.json` | All tuning in one place: Jev model, the `BULLSHIT` label name, score threshold, composite weights, topic/sender/tier value maps. |
| `questions.json` | The 7-question Jev battery: urgency, topic, sender_type, is_scam, is_stale, announces_event, is_compound. |
| `STATE_SPEC.md` | The Jev state schema: every field, its source, and why code (not Jev) computes it. |
| `OPERATIONS.md` | Cron wiring, concurrency ceiling, runtime data layout, failure modes. |
| `lib/state.mjs` | Gmail message -> Jev state object. Assembles every deterministic field. |
| `lib/extract.mjs` | Header/body parsing: addresses, MIME walk, unsubscribe signals, Gmail labels, relative-time rendering. |
| `lib/auth.mjs` | SPF/DKIM/DMARC -> one verdict (`pass` / `fail` / `suspicious` / `unknown`). Code interprets; Jev reads the conclusion. |
| `lib/dates.mjs` | Date expressions in subject+body -> absolute dates ("Thursday, October 1, 2026 (tomorrow)"). Code does the math. |
| `lib/jev.mjs` | TypeSafe API client (`POST /v1/systemone`, model `jev-latest`). Retries 429/529 with backoff. |
| `lib/score.mjs` | Composite scorer: Jev answers + state facts -> one number. No vetoes in this phase. |
| `lib/surrogate.mjs` | Fetches the `hsurr:*` surrogate for a connector credential from authd. The process never sees the real key. |
| `test/pipeline.test.mjs` | Offline unit tests (`node --test test/`): scoring behavior, extraction, dates, auth verdicts. Run by CI. |

Runtime data (`state/`, `logs/`, `outbox/`) is created next to the scripts
at first run and is gitignored — it contains real mail metadata.

## config.json reference

| Key | Current | Meaning |
|---|---|---|
| `label_name` | `"BULLSHIT"` | Gmail label applied to non-surfaced mail |
| `model` | `"jev-latest"` | TypeSafe model (resolves to the current flagship) |
| `threshold` | `0.3` | Composite score >= this surfaces. Deliberately loose; weights get fitted once ~50 owner-labeled emails exist |
| `weights` | see file | Per-signal weights. Positive pushes toward surface; negative (is_scam, is_stale) pushes away |
| `topic_values` | see file | -1..1 value per Jev topic pick (`conversation` 1.0, `marketing` -0.8) |
| `sender_values` | see file | -1..1 value per sender type (`person_private` 1.0, `company_automated` -0.5) |
| `tier_values` | see file | -1..1 value per recipient tier (`primary` 0.5, `work` 0.2, `other` -0.2) |

## Quickstart

```bash
cd deployed
node triage.mjs --dry-run --limit=5   # score 5 Gmail emails, change nothing
node triage-outlook.mjs --dry-run --limit=5
node --test test/                      # offline unit tests, no credentials needed
```

Live runs need Gmail and Outlook API access plus a Jev/TypeSafe credential —
in the author's setup these are the `hatch_gws_cli` and `outlook-mail` CLIs
plus authd for the credential surrogate (see the portability notes in
`triage.mjs`, `triage-outlook.mjs`, and `lib/`). `--dry-run` still needs the
CLIs (it reads real mail) but changes nothing.
