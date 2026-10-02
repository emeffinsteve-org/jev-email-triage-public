// pipeline.test.mjs — offline unit tests for the deployed pipeline.
//
// Run: node --test test/        (from deployed/)
// CI runs this on every push/PR. No network, no credentials, no Gmail:
// only the pure functions (scoring, extraction, dates, auth verdicts).
//
// Timezone: the pipeline runs on a machine set to America/New_York (the
// cron's timezone), and lib/dates.mjs mixes local-midnight math with
// America/New_York formatting. Pin TZ here so the date tests mean the
// same thing on any runner.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composite } from '../lib/score.mjs';
import {
  parseAddress, receivedInWords, gmailLabels,
} from '../lib/extract.mjs';
import { extractDates } from '../lib/dates.mjs';
import { authVerdict } from '../lib/auth.mjs';

// --- composite scoring -------------------------------------------------------
// Weights/threshold live in config.json; these tests pin the *behavior*
// (a hot personal email surfaces, a cold promo does not) so a bad weight
// edit fails loudly instead of silently mis-triaging mail.

const coldState = { address_tier: 'other', email: { messages_in_thread: 1 } };
const hotState = { address_tier: 'primary', email: { messages_in_thread: 3 } };

test('cold promo stays below threshold', () => {
  const answers = {
    urgency: { type: 'score', score: 0, confidence: 0.9 },
    topic: { type: 'choice', choice: 'marketing', confidence: 0.9 },
    sender_type: { type: 'choice', choice: 'company_automated', confidence: 0.9 },
  };
  const d = composite(coldState, answers);
  assert.equal(d.show, false);
  assert.ok(d.score < d.threshold, `score ${d.score} should be < ${d.threshold}`);
});

test('urgent personal mail surfaces', () => {
  const answers = {
    urgency: { type: 'score', score: 4, confidence: 1 },
    topic: { type: 'choice', choice: 'conversation', confidence: 1 },
    sender_type: { type: 'choice', choice: 'person_private', confidence: 1 },
  };
  const d = composite(hotState, answers);
  assert.equal(d.show, true);
  assert.ok(d.score >= 0.79 && d.score <= 0.81, `score ${d.score} should be ~0.8`);
});

test('contributions add up to the score', () => {
  const answers = {
    urgency: { type: 'score', score: 3, confidence: 0.8 },
    topic: { type: 'choice', choice: 'bills', confidence: 0.9 },
    is_scam: { type: 'noul', noul: 0 },
  };
  const d = composite(hotState, answers);
  const sum = d.contributions.reduce((s, p) => s + p.contribution, 0);
  assert.ok(Math.abs(sum - d.score) < 0.002, `parts sum ${sum} != score ${d.score}`);
});

test('missing answers degrade gracefully', () => {
  const d = composite(coldState, null);
  assert.equal(typeof d.score, 'number');
  assert.equal(d.show, false);
});

// --- address extraction ------------------------------------------------------

test('parseAddress splits display name and address', () => {
  assert.deepEqual(parseAddress('Jane Doe <jane@example.com>'),
    { name: 'Jane Doe', address: 'jane@example.com' });
});

test('parseAddress handles bare addresses and null', () => {
  assert.deepEqual(parseAddress('bob@example.com'), { name: null, address: 'bob@example.com' });
  assert.deepEqual(parseAddress(null), { name: null, address: null });
});

test('parseAddress keys on the LAST angle-bracket address (spoof-safe)', () => {
  // A display name smuggling an address must not win; the real address is last.
  const p = parseAddress('alerts@huntington.com <evil@scam.ru>');
  assert.equal(p.address, 'evil@scam.ru');
});

test('gmailLabels drops INBOX/UNREAD, keeps the category', () => {
  const l = gmailLabels(['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS', 'STARRED']);
  assert.equal(l.gmail_category, 'promotions');
  assert.deepEqual(l.gmail_labels, ['CATEGORY_PROMOTIONS', 'STARRED']);
});

test('receivedInWords renders relative time', () => {
  const now = new Date('2026-09-30T12:00:00-04:00');
  assert.equal(receivedInWords(now, now), 'just now');
  assert.equal(receivedInWords(new Date(now - 30 * 60000), now), '30 minutes ago');
  assert.equal(receivedInWords(new Date(now - 5 * 86400000), now), '5 days ago');
});

// --- dates -------------------------------------------------------------------

test('extractDates resolves "tomorrow" against the received date', () => {
  const out = extractDates('Can we meet tomorrow?', '2026-09-30T12:00:00-04:00');
  assert.equal(out.length, 1);
  assert.ok(out[0].includes('October 1, 2026'), out[0]);
  assert.ok(out[0].includes('(tomorrow)'), out[0]);
});

test('extractDates handles month-day and dedupes', () => {
  const out = extractDates('Due October 5. Also Oct 5 works.', '2026-09-30T12:00:00-04:00');
  assert.equal(out.length, 1);
  assert.ok(out[0].includes('October 5, 2026'), out[0]);
});

// --- auth verdicts -----------------------------------------------------------

const hdr = (value) => [{ name: 'Authentication-Results', value }];

test('no auth headers -> unknown (means nothing, Jev ignores it)', () => {
  assert.equal(authVerdict([], 'user@example.com').verdict, 'unknown');
});

test('dmarc=pass -> pass', () => {
  const h = hdr('mx.google.com; dkim=pass header.i=@example.com; spf=pass; dmarc=pass (p=NONE)');
  assert.equal(authVerdict(h, 'user@example.com').verdict, 'pass');
});

test('dmarc=fail on p=REJECT that reached the inbox -> suspicious', () => {
  const h = hdr('mx.google.com; spf=fail; dkim=fail; dmarc=fail (p=REJECT sp=REJECT)');
  assert.equal(authVerdict(h, 'user@example.com').verdict, 'suspicious');
});

test('non-Gmail authserv-id is not misattributed -> unknown', () => {
  const h = hdr('some-relay.example; dkim=pass header.i=@example.com; dmarc=pass');
  assert.equal(authVerdict(h, 'user@example.com').verdict, 'unknown');
});
