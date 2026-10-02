---
type: adr
status: accepted
date: 2026-09-30
deciders: the owner
supersedes: none
superseded-by: none
---

# ADR-0002 — Composite scoring with a loose 0.3 threshold

## Context and Problem Statement

Jev answers seven questions per email (urgency, topic, sender_type,
is_scam, is_stale, announces_event, is_compound). Those answers plus
deterministic state facts (recipient tier, thread depth) must collapse to
one number: "needs the owner's eyes now". The question: how is that number
computed, and where does the show/BULLSHIT line sit before any calibration
data exists?

## Decision Drivers

* the owner: "bother me more, surface more" — missing important mail is worse
  than surfacing noise.
* No labeled data yet; weights are hand-set starting guesses.
* Every decision must be traceable to the signal that moved it.

## Considered Options

* **Weighted composite, threshold 0.3** — normalize each dimension to 0-1,
  weight in code, surface at >= 0.3.
* **Jev decides directly** — ask Jev for the final call as an 8th question.
* **Rule-based vetoes** — hard rules override the score (e.g. scam always hides).

## Decision

Weighted composite in `deployed/lib/score.mjs`, threshold 0.3 —
deliberately loose. Positive contributions push toward surface; negative
weights (is_scam, is_stale) push away. Every email's per-signal
contributions are logged, so a surprising decision traces to the question
that moved it. No vetoes in this phase (ADR-0001).

## Consequences

* Good: tunable without touching Jev; the log shows exactly why each email
  surfaced or didn't.
* Bad: hand-set weights will mis-rank until fitted. The fix is planned, not
  speculative: once ~50 emails carry the owner's own verdicts, fit the weights
  against the decision logs and tighten the threshold
  (see `ideas/roadmap.md`).
