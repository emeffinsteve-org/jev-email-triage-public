---
status: active
supersedes: none
superseded-by: none
last-verified: 2026-09-30
---

# Decision log

Append-only, most recent first: one dated entry per decision, pointing at the ADR or doc that holds the full rationale rather than restating it. Existing entries are never rewritten — only added above.

<!-- New entries go directly below this comment, above older ones:
## YYYY-MM-DD — Short title stating the decision
One or two lines, linking the ADR file: [ADR-0001](0001-short-title.md).
-->

- **2026-09-30** — Outlook BULLSHIT verdicts are log-only; the outlook-mail connector has no label/category write. [ADR-0004](0004-outlook-log-only.md).
- **2026-09-30** — Gmail pipeline concurrency ceiling is 10-way (`JEV_CONCURRENCY=10`); 50-way trips the connector's Sentinel rate limit on label writes. [ADR-0003](0003-concurrency-ceiling.md).
- **2026-09-30** — Composite scoring with a deliberately loose 0.3 threshold; weights to be fitted once ~50 the owner-labeled emails exist. [ADR-0002](0002-composite-scoring-threshold.md).
- **2026-09-30** — Label-only binary triage phase: every email is surfaced or left unread with a BULLSHIT label; nothing hidden, archived, or deleted; no vetoes. [ADR-0001](0001-label-only-binary-phase.md).
