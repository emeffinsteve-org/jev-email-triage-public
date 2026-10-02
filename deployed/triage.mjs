// triage.mjs — Gmail → Jev → Muse pipeline.
//
// One run: list unread inbox mail not yet triaged, build Jev state
// per email, one Jev call per email, composite score → show (surface) or
// BULLSHIT label. Label-only phase: nothing is archived, deleted, or marked
// read. Decision log appended as JSONL for calibration.
//
// PORTABILITY NOTE: this script shells out to `hatch_gws_cli` (the author's
// Gmail CLI) and authenticates via authd (see lib/surrogate.mjs) — both are
// specific to the author's Muse VM. To run elsewhere, swap the gws() helper
// for your own Gmail API access (service account, OAuth CLI, etc.).
//
// Requires: the `hatch_gws_cli` Gmail CLI on PATH, and authd reachable at
// $JARVIS_AUTHD_SOCK (or /run/hatch/auth/authd.sock) for the TypeSafe
// connector surrogate (see lib/surrogate.mjs). No npm dependencies.
//
// Usage: node triage.mjs [--dry-run] [--limit N] [--id <gmail-id>]
//   --dry-run   score everything, write the log, change nothing in Gmail
//   --limit N   triage at most N fresh emails (default 25)
//   --id ID     triage just one email by Gmail id (real-time path for
//               device-sync handoffs; the seen-set keeps the cron from redoing it)
// Env: JEV_CONCURRENCY (default 10) — see the worker-pool note below.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from './lib/state.mjs';
import { evaluate } from './lib/jev.mjs';
import { composite } from './lib/score.mjs';
import config from './config.json' with { type: 'json' };

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
const LOG_PATH = path.join(ROOT, 'logs', 'decisions.jsonl');
const USE_PATH = path.join(ROOT, 'logs', 'usage.jsonl');
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 25);
// Single-email mode for real-time triage (device-sync handoffs): --id=<gmail-id>
// triages just that message. The seen-set keeps the 15-min cron from redoing it.
const ONLY_ID = process.argv.find((a) => a.startsWith('--id='))?.split('=')[1] ?? null;

for (const d of ['state', 'logs', 'outbox']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });

// --- Gmail CLI ---------------------------------------------------------------
async function gws(resource, method, params, json) {
  const args = ['gmail', 'users', resource, method, '--params', JSON.stringify(params)];
  if (json) args.push('--json', JSON.stringify(json));
  const { stdout } = await exec('hatch_gws_cli', args, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function ensureLabel(name) {
  const { labels = [] } = await gws('labels', 'list', { userId: 'me' });
  const hit = labels.find((l) => l.name === name);
  if (hit) return hit.id;
  const created = await gws('labels', 'create', { userId: 'me' },
    { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
  return created.id;
}

// --- Processed-id set (messages.list returns no dates, so the watermark is
// the set of ids already triaged) -------------------------------------------
const SEEN_PATH = path.join(ROOT, 'state', 'processed.json');
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8')).ids ?? []); }
  catch { return new Set(); }
}
function saveSeen(seen) {
  if (!DRY) fs.writeFileSync(SEEN_PATH, JSON.stringify({ ids: [...seen], updated_at: new Date().toISOString() }));
}

// --- Main ---------------------------------------------------------------------
const seen = loadSeen();
const labelId = DRY ? 'DRY_RUN' : await ensureLabel(config.label_name);

async function listAllUnread() {
  const all = [];
  let pageToken;
  do {
    const params = { userId: 'me', q: 'in:inbox is:unread', maxResults: 500 };
    if (pageToken) params.pageToken = pageToken;
    const res = await gws('messages', 'list', params);
    all.push(...(res.messages ?? []));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return all;
}

const messages = ONLY_ID ? [{ id: ONLY_ID }] : await listAllUnread();
// List order is newest-first; reverse so a backlog triages oldest-first.
let fresh = messages.filter((m) => !seen.has(m.id));
if (!ONLY_ID) fresh = fresh.reverse().slice(0, LIMIT);

const surfaced = [];

async function triageOne(m) {
  seen.add(m.id);
  try {
    const full = await gws('messages', 'get', { userId: 'me', id: m.id, format: 'full' });
    let threadN = 1;
    try {
      const thread = await gws('threads', 'get', { userId: 'me', id: full.threadId, format: 'minimal' });
      threadN = thread.messages?.length ?? 1;
    } catch { /* thread count is a weak signal; proceed without it */ }

    const state = buildState(full, { threadMessageCount: threadN });
    const started = Date.now();
    const res = await evaluate(state, QUESTIONS);
    const ms = Date.now() - started;
    const decision = composite(state, res.answers);

    const entry = {
      at: new Date().toISOString(), gmail_id: m.id, thread_id: full.threadId,
      from: state.email.from, subject: state.email.subject,
      address_tier: state.address_tier, auth: state.email.auth,
      jev_model: res.model, jev_ms: ms,
      usage: res.usage ?? null,
      answers: summarize(res.answers),
      score: decision.score, show: decision.show,
      contributions: decision.contributions,
      action: decision.show ? 'surface' : `label:${config.label_name}`,
      dry_run: DRY,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
    if (res.usage) {
      fs.appendFileSync(USE_PATH, JSON.stringify({
        at: entry.at, gmail_id: m.id,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      }) + '\n');
    }

    if (decision.show) {
      surfaced.push({
        gmail_id: m.id, from: state.email.from, from_name: state.email.from_name,
        subject: state.email.subject, received: state.email.received,
        snippet: full.snippet ?? '', score: decision.score,
        why: topContributors(decision.contributions),
      });
    } else if (!DRY) {
      await gws('messages', 'modify', { userId: 'me', id: m.id }, { addLabelIds: [labelId] });
    }
    console.log(`${decision.show ? 'SHOW  ' : 'BULLSH'} ${decision.score.toFixed(2)}  ${state.email.from} — ${state.email.subject.slice(0, 70)}`);
  } catch (e) {
    console.error(`ERROR ${m.id}: ${e.message}`);
    fs.appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), gmail_id: m.id, error: e.message }) + '\n');
  }
}

// Worker pool: Jev calls are latency-bound, so N concurrent emails share
// one process. Shared state (seen Set, surfaced array, sync file appends)
// is safe under interleaved awaits. Tune with JEV_CONCURRENCY.
// 2026-09-30: 50-way trips the Gmail connector's Sentinel rate limit on
// messages.modify (all 44 label writes in the run failed); 10-way runs clean.
const CONCURRENCY = Math.max(1, Number(process.env.JEV_CONCURRENCY ?? 10));
console.log(`triaging ${fresh.length} emails at concurrency ${CONCURRENCY}`);
{
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= fresh.length) return;
      await triageOne(fresh[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length) }, worker));
}

saveSeen(seen);

const outPath = path.join(ROOT, 'outbox', `surfaced-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), surfaced }, null, 2));
console.log(`\n${fresh.length} triaged, ${surfaced.length} surfaced → ${outPath}`);

// --- helpers ------------------------------------------------------------------
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
