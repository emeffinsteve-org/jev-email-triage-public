# jev-email-triage (public)

AI email triage with a deliberately restrained design: every unread email
gets exactly one LLM judgment, a composite score decides its fate, and
there are only two outcomes — **surface it** or **leave it unread with a
`BULLSHIT` label**. Nothing is ever archived, deleted, marked read, or
moved. A wrong call costs nothing: the BULLSHIT pile is the safety net.

This is a sanitized public snapshot of a private pipeline that triages two
real mailboxes on a 15-minute cron. Personal details (addresses, names,
employer, family) have been replaced with placeholders — every redaction is
marked with a `NOTE (sanitized)` comment at the site of removal. Configure
your own in the spots marked.

## How it works

```
Gmail / Outlook unread mail
  → lib/state.mjs builds a deterministic state object per email
      (headers, auth verdict, dates resolved to absolute, body text —
       the LLM never extracts; code does)
  → lib/jev.mjs asks the 7-question battery in questions.json
      (urgency, topic, sender_type, is_scam, is_stale,
       announces_event, is_compound)
  → lib/score.mjs composites answers + state facts → one number
  → score >= threshold (0.3): surface. Below: BULLSHIT label (Gmail)
      or log-only (Outlook — the connector can't apply labels).
```

A `state/processed.json` seen-set means each email is triaged exactly
once, even across overlapping runs. Decisions append to
`logs/decisions.jsonl` — the calibration dataset for fitting weights later.

## Layout

| Path | Job |
|---|---|
| `deployed/triage.mjs` | Gmail pipeline (worker pool, `JEV_CONCURRENCY`) |
| `deployed/triage-outlook.mjs` | Outlook/M365 pipeline (serial) |
| `deployed/repair-labels.mjs` | One-off: re-apply labels where writes failed |
| `deployed/config.json` | All tuning: model, label name, threshold, weights, value maps |
| `deployed/questions.json` | The 7-question LLM battery |
| `deployed/lib/` | state, extract, auth, dates, jev, score, surrogate |
| `deployed/test/` | Offline unit tests (`node --test deployed/test/pipeline.test.mjs`) |
| `deployed/OPERATIONS.md` | Runbook: schedule, concurrency ceiling, failure modes |
| `deployed/STATE_SPEC.md` | The state schema, field by field |
| `docs/adr/` | Architecture decision records |

## Quickstart

```bash
node --test deployed/test/pipeline.test.mjs      # offline tests, no credentials
node deployed/triage.mjs --dry-run --limit=5      # score 5 real emails, change nothing
```

## Configuration (do this first)

1. **`deployed/lib/state.mjs`** — set `PRIMARY_ADDRESSES` / `WORK_ADDRESS`
   and write your `RECIPIENT_PROFILE`. The sharper the profile, the better
   the triage.
2. **`deployed/triage-outlook.mjs`** — same for the Outlook profile and
   mailbox address.
3. **`deployed/config.json`** — label name, threshold, weights, and the
   `tier_values` map (`primary` / `work` / `other` must match what
   `addressTier()` returns).

## Portability notes (read before running live)

The author's environment is a Muse VM: the scripts shell out to
`hatch_gws_cli` (Gmail) and `outlook-mail` CLIs and authenticate through
`authd` (`lib/surrogate.mjs`), with the Jev model served by TypeSafe
(`lib/jev.mjs`). To run elsewhere, replace:

- `gws()` in `triage.mjs` → your Gmail API access,
- `omail()` in `triage-outlook.mjs` → your Outlook/M365 API access,
- `getSurrogate()` in `lib/surrogate.mjs` → your secret fetch,
- the endpoint/credential in `lib/jev.mjs` → your LLM provider.

`questions.json` is provider-agnostic; only the transport is specific.
The author's live setup runs both scripts on a 15-minute cron, looping
the Gmail script until it reports "0 triaged".

## License

No license file yet — all rights reserved until the author adds one.

<!-- copilot review probe -->
