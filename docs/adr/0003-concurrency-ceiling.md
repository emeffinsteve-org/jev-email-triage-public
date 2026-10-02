---
type: adr
status: accepted
date: 2026-09-30
deciders: the owner
supersedes: none
superseded-by: none
---

# ADR-0003 — 10-way concurrency ceiling on the Gmail pipeline

## Context and Problem Statement

Jev calls are latency-bound, so `triage.mjs` triages emails through a
worker pool sized by `JEV_CONCURRENCY`. Raising concurrency drains backlogs
faster — until the Gmail connector's rate limiter trips and label writes
start failing. The question: how high can concurrency go before the writes
break?

## Decision Drivers

* Measured 2026-09-30: 10-way = ~44s per 50 emails, zero failures.
  50-way = ~30s per 50 emails, but all 44 `messages.modify` label writes
  failed with `connector_rate_limited` (retry ~48s, terminal for the
  attempt). TypeSafe itself handled 50 concurrent calls without complaint —
  the ceiling is the Gmail connector, not Jev.
* A failed label write is silent data loss: the email was judged BULLSHIT
  but wears no label, so the safety net (ADR-0001) has a hole.

## Considered Options

* **10-way** — measured clean, ~44s per 50.
* **50-way** — ~30% faster, 100% of label writes throttled.
* **Serial** — ~204s per 50. Safe but too slow for backlog drains.

## Decision

`JEV_CONCURRENCY=10` is the ceiling; the cron body says so explicitly
("Do NOT raise concurrency above 10"). The limit is recorded as a code
comment in `triage.mjs` next to the worker pool.

## Consequences

* Good: backlogs drain in ~6.5 min per 260 emails with no write failures.
* Bad: bursts are capped by connector throughput, not Jev throughput.
* If bulk label writes ever fail again, `deployed/repair-labels.mjs`
  re-applies them from the decision log at a gentle 1.5s pace (it repaired
  all 44 on 2026-09-30).
