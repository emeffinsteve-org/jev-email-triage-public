---
type: adr
status: accepted
date: 2026-09-30
deciders: the owner
supersedes: none
superseded-by: none
---

# ADR-0004 — Outlook BULLSHIT verdicts are log-only

## Context and Problem Statement

The Outlook pipeline (`triage-outlook.mjs`) triages the owner's Outlook mailbox (`you@work.example.com`) with the same battery and
composite as Gmail. The question: what happens to mail Jev judges BULLSHIT
there?

## Decision Drivers

* The `outlook-mail` connector exposes no label/category write — verified,
  not assumed. There is no API to tag the message.
* ADR-0001 forbids archiving, deleting, or marking read in this phase, so
  the Outlook side cannot file BULLSHIT away either.

## Considered Options

* **Log-only** — record the verdict in `logs/decisions-outlook.jsonl`,
  change nothing in the mailbox.
* **Mark read / move** — possible via the connector, but violates the
  label-only phase's reversibility rule.

## Decision

Log-only. Surfaced Outlook mail reaches the owner through the same alert
destination; everything else is recorded in the decision log and left
untouched in the mailbox.

## Consequences

* Good: zero risk of the connector doing something unexpected to the
  Outlook mailbox.
* Bad: no visual distinction in Outlook between triaged and untriaged mail;
  the processed-id watermark (`state/processed-outlook.json`) is the only
  record.
* If the connector ever gains label writes, the Outlook side gets the same
  BULLSHIT labeling as Gmail.
