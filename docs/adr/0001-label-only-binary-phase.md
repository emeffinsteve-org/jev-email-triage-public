---
type: adr
status: accepted
date: 2026-09-30
deciders: the owner
supersedes: none
superseded-by: none
---

# ADR-0001 — Label-only binary triage phase

## Context and Problem Statement

the owner's inboxes carry years of backlog and a fast-moving present. An AI
judge that archives or deletes on day one risks hiding something important
before its judgement is trusted. The question: what is the triage system
allowed to *do* to mail while it earns that trust?

## Decision Drivers

* A wrong hide is expensive; a wrong show is cheap (the owner glances and moves on).
* The system must be fully reversible at every step while unproven.
* the owner explicitly ordered: show it in Muse, or leave it unread with a
  BULLSHIT label. No vetoes in this phase.

## Considered Options

* **Label-only binary** — every email is either surfaced to the owner or left
  unread with a `BULLSHIT` label. Nothing archived, deleted, marked read,
  or moved.
* **Full triage** — archive/delete/file per Jev's judgement immediately.
* **Read-only scoring** — score everything, change nothing, not even a label.

## Decision

Label-only binary. The BULLSHIT pile *is* the safety net: a mis-scored
email sits unread in the inbox wearing a label, one click from recovery.
No vetoes — vetoes return in the archive phase (see `ideas/roadmap.md`).

## Consequences

* Good: every decision is auditable against the untouched inbox; the
  decision logs become the calibration dataset.
* Bad: the inbox keeps growing until the archive phase; BULLSHIT-labeled
  mail still counts as unread.
* The Outlook side cannot apply labels at all (connector limitation), so
  its BULLSHIT verdicts are log-only — see ADR-0004.
