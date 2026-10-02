# Jev Email Triage — State Spec (v2, 2026-09-30)

One email per Jev call. Code builds this state deterministically from the
Gmail API — no LLM extraction. Every field is read by at least one question.

```json
{
  "today": "Wednesday, September 30, 2026",

  "recipient_profile": "<!-- SANITIZED: the original listed the author's real addresses, per-service alias patterns, and household members. Redacted for public release — configure your own profile (see lib/state.mjs). Example shape: name, primary addresses with roles, secondary addresses, alias conventions. -->"

  "email": {
    "from": { "name": "Example Sender", "address": "sender@example.com" },
    "to": [{ "name": null, "address": "you@example.com" }],
    "subject": "Your invoice is ready",
    "received": "2 hours ago",
    "received_at": "2026-09-30T08:15:00-04:00",
    "dates_mentioned": ["Friday, October 2, 2026 (in 2 days)"],
    "auth": "pass",
    "gmail_category": "promotions",
    "gmail_labels": ["CATEGORY_PROMOTIONS", "IMPORTANT"],
    "has_unsubscribe_link": true,
    "one_click_unsubscribe": true,
    "was_html": true,
    "image_count": 12,
    "table_count": 3,
    "messages_in_thread": 1,
    "recipient_replied_in_thread": false,
    "sender_relationship": "known vendor — monthly billing",
    "body": "[first ~6000 chars of plain text]\n[truncated]"
  }
}
```

## Field reference

| Field | Type | Source | Notes |
|---|---|---|---|
| `today` | string | code (`new Date()`) | Anchor for all relative reasoning. |
| `recipient_profile` | object | static config | Pattern-based, not an exhaustive alias list. |
| `email.from` | {name, address} | `From` header, parsed | Display name is spoofable; questions key on `address`. |
| `email.to` | array | `To` header, parsed | Preserves the alias the sender used (SimpleLogin passes it through). |
| `email.subject` | string | `Subject` header | RFC2047-decoded. |
| `email.received` | string | `internalDate` (server-stamped) → words | Trustworthy receipt time. The `Date:` header is sender-claimed; not used. |
| `email.received_at` | string | `internalDate` → ISO | Machine-readable twin of `received` (code-side use). |
| `email.dates_mentioned` | string[] | subject+body scan, resolved in code | Each entry: absolute date + relative words, e.g. `"Friday, October 2, 2026 (in 2 days)"`. Jev cannot do date math, so code resolves every date expression against `received_at`. Empty array if none found. |
| `email.auth` | enum | `Authentication-Results` → verdict | `pass` / `fail` / `suspicious` / `unknown`. Policy-aware: `p=reject` + delivered anyway → `suspicious`. See `lib/auth.mjs`. A signal, not a verdict — no extra weight. |
| `email.gmail_category` | string\|null | `labelIds` → `CATEGORY_*` | `personal` / `social` / `promotions` / `updates` / `forums`. Null when Gmail assigned none. |
| `email.gmail_labels` | string[] | `labelIds` minus `INBOX`/`UNREAD` | User labels + categories + `STARRED`/`IMPORTANT` (user-applied = meaningful). |
| `email.has_unsubscribe_link` | boolean | `List-Unsubscribe` header | Strong bulk-mail signal. |
| `email.one_click_unsubscribe` | boolean | `List-Unsubscribe-Post` header | RFC 8058 one-click → near-certain bulk/marketing. |
| `email.was_html` | boolean | MIME parts | Whether an HTML part existed. Weak alone — humans and marketers both use HTML. |
| `email.image_count` | number | `<img` count in HTML | Counts, not booleans — 12 images reads differently than 1 logo. |
| `email.table_count` | number | `<table` count in HTML | Layout tables are a marketing-template tell, in combination. |
| `email.messages_in_thread` | number | Gmail thread | 1 = new thread. |
| `email.recipient_replied_in_thread` | boolean | thread scan | Whether the owner already replied — gates reply-type actions. |
| `email.sender_relationship` | string\|null | code (sender map) | Omitted when unknown → Jev treats sender as unknown (fail-open). |
| `email.body` | string | MIME `text/plain`, else HTML→text | Capped at 6000 chars with `[truncated]` marker. |

## New vs. the first committed `buildState`

Added: `to` (was missing), `received_at`, `auth`, `gmail_labels`,
`one_click_unsubscribe`, `was_html`, `image_count`, `table_count`.
Unchanged: `today`, `recipient_profile`, `from`, `subject`, `received`,
`dates_mentioned`, `gmail_category`, `has_unsubscribe_link`,
`messages_in_thread`, `recipient_replied_in_thread`, `sender_relationship`,
`body`.
Not in state (code-side only): raw SPF/DKIM/DMARC parse (decision log),
DMARC policy string (logged for future calibration).

## Extraction code

- `lib/auth.mjs` — `parseAuthResults(headers)` + `authVerdict(headers, fromAddress)`
- `lib/extract.mjs` — headers, addresses, dates, body/HTML, unsubscribe,
  labels, sender relationship
