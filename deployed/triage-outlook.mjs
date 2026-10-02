// triage-outlook.mjs — Outlook (M365) → Jev → score → surface.
//
// PORTABILITY NOTE: shells out to the author's `outlook-mail` CLI and
// authenticates via authd (see lib/surrogate.mjs). Swap for your own
// Outlook/M365 API access to run elsewhere.
//
// Same battery and composite as the Gmail pipeline. The Outlook connector
// cannot apply labels/categories, so BULLSHIT decisions are logged locally
// only — nothing in the mailbox is moved, marked read, or otherwise changed.
//
// Requires: the `outlook-mail` CLI on PATH, and authd for the TypeSafe
// connector surrogate (see lib/surrogate.mjs). No npm dependencies.
//
// Usage: node triage-outlook.mjs [--dry-run] [--limit N]
// Note: unlike triage.mjs this runs serially (one Jev call at a time) —
// the Outlook mailbox is small and the connector is latency-bound anyway.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { receivedInfo, parseAddress, parseAddressList } from './lib/extract.mjs';
import { extractDates } from './lib/dates.mjs';
import { evaluate } from './lib/jev.mjs';
import { composite } from './lib/score.mjs';
import config from './config.json' with { type: 'json' };

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
const SEEN_PATH = path.join(ROOT, 'state', 'processed-outlook.json');
const LOG_PATH = path.join(ROOT, 'logs', 'decisions-outlook.jsonl');
const USE_PATH = path.join(ROOT, 'logs', 'usage.jsonl');
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 100);

for (const d of ['state', 'logs', 'outbox']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });

async function omail(args) {
  const { stdout } = await exec('outlook-mail', args, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function listAllUnread() {
  const all = [];
  let pageToken;
  do {
    const args = ['list', '--unread', '--page-size', '100'];
    if (pageToken) args.push('--page-token', String(pageToken));
    const res = await omail(args);
    all.push(...(res.messages ?? []));
    pageToken = res.next_page_token;
  } while (pageToken);
  return all;
}

function htmlToText(html) {
  return (html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ').trim()
    .slice(0, 6000);
}

// NOTE (sanitized): the original profile described a real person — name,
// address, employer, family. Redacted. Write your own (see lib/state.mjs).
const RECIPIENT_PROFILE = `Jane Doe. This is a secondary mailbox (you@work.example.com). Write 2-3 sentences about whose mail this is and what kinds of mail matter here.`;

function buildOutlookState(m, now) {
  const from = parseAddress(m.from ?? '');
  const to = parseAddressList(Array.isArray(m.to) ? m.to.join(', ') : (m.to ?? ''));
  const cc = parseAddressList(Array.isArray(m.cc) ? m.cc.join(', ') : (m.cc ?? ''));
  const subject = m.subject ?? '';
  const received = receivedInfo(String(Date.parse(m.message_received_at?.utc ?? m.date ?? now.toISOString())), now);
  const rawBody = m.body ?? '';
  const wasHtml = (m.body_type ?? '').toLowerCase() === 'html';
  const body = (wasHtml ? htmlToText(rawBody) : String(rawBody)).slice(0, 6000);
  const dates = extractDates(`${subject}\n${body}`, received.at);
  const toAddrs = to.map((t) => t.address).filter(Boolean);
  const address_tier = toAddrs.includes('you@work.example.com') ? 'work' : 'other';

  return {
    today: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    recipient_profile: RECIPIENT_PROFILE,
    address_tier,
    email: {
      from: from.address,
      from_name: from.name,
      to: toAddrs,
      ...(cc.length ? { cc: cc.map((t) => t.address) } : {}),
      subject,
      received: received.inWords,
      received_at: received.at,
      auth: 'unknown',
      messages_in_thread: 1,
      has_unsubscribe_link: /unsubscribe/i.test(rawBody),
      one_click_unsubscribe: false,
      was_html: wasHtml,
      image_count: 0,
      table_count: 0,
      ...(dates.length ? { dates_mentioned: dates } : {}),
      body,
    },
  };
}

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8')).ids ?? []); }
  catch { return new Set(); }
}
function saveSeen(seen) {
  if (!DRY) fs.writeFileSync(SEEN_PATH, JSON.stringify({ ids: [...seen], updated_at: new Date().toISOString() }));
}

// --- Main ---------------------------------------------------------------------
const seen = loadSeen();
const messages = await listAllUnread();
const fresh = messages.filter((m) => !seen.has(m.id)).slice(0, LIMIT);
console.log(`${messages.length} unread, ${fresh.length} to triage`);

const surfaced = [];
for (const m of fresh) {
  seen.add(m.id);
  try {
    const res0 = await omail(['get', m.id]);
    if (res0.withheld) { console.log(`SKIP  withheld ${m.id}`); continue; }
    const full = res0.message;
    const state = buildOutlookState(full, new Date());
    const started = Date.now();
    const res = await evaluate(state, QUESTIONS);
    const decision = composite(state, res.answers);

    const entry = {
      at: new Date().toISOString(), outlook_id: m.id, mailbox: 'you@work.example.com',
      from: state.email.from, subject: state.email.subject,
      address_tier: state.address_tier,
      jev_model: res.model, jev_ms: Date.now() - started,
      usage: res.usage ?? null,
      answers: summarize(res.answers),
      score: decision.score, show: decision.show,
      contributions: decision.contributions,
      action: decision.show ? 'surface' : 'bullshit (logged only — Outlook connector cannot apply labels)',
      dry_run: DRY,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
    if (res.usage) {
      fs.appendFileSync(USE_PATH, JSON.stringify({
        at: entry.at, outlook_id: m.id,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      }) + '\n');
    }

    if (decision.show) {
      surfaced.push({
        outlook_id: m.id, from: state.email.from, from_name: state.email.from_name,
        subject: state.email.subject, received: state.email.received,
        snippet: (full.body ?? '').slice(0, 200), score: decision.score,
        why: topContributors(decision.contributions),
      });
    }
    console.log(`${decision.show ? 'SHOW  ' : 'BULLSH'} ${decision.score.toFixed(2)}  ${state.email.from} — ${state.email.subject.slice(0, 70)}`);
  } catch (e) {
    console.error(`ERROR ${m.id}: ${e.message}`);
    fs.appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), outlook_id: m.id, error: e.message }) + '\n');
  }
}

saveSeen(seen);
const outPath = path.join(ROOT, 'outbox', `surfaced-outlook-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), surfaced }, null, 2));
console.log(`\n${fresh.length} triaged, ${surfaced.length} surfaced → ${outPath}`);

function summarize(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (v.type === 'choice') out[k] = { choice: v.choice, confidence: r(v.confidence) };
    else if (v.type === 'score') out[k] = { score: r(v.score), confidence: r(v.confidence) };
    else if (v.type === 'noul') out[k] = r(v.noul);
  }
  return out;
}
function topContributors(parts) {
  return [...parts].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3).map((p) => `${p.key}:${p.contribution > 0 ? '+' : ''}${p.contribution}`);
}
function r(n) { return n == null ? n : Math.round(n * 1000) / 1000; }
