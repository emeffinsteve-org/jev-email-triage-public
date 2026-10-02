// repair-labels.mjs — re-apply the BULLSHIT label to emails whose label write
// failed (error entries in logs/decisions.jsonl). One-off maintenance tool,
// not part of the scheduled pipeline. Runs at a gentle pace: the Gmail
// connector throttles burst modify calls (2026-09-30).
//
// Requires: the `hatch_gws_cli` Gmail CLI on PATH.
//
// Usage: node repair-labels.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.json' with { type: 'json' };

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(ROOT, 'logs', 'decisions.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// An id needs repair when it has an error entry AND its latest decision was
// a label (not surface). Surfaced mail never gets a label by design.
const decisions = new Map();
const errored = new Set();
for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.error && e.gmail_id) errored.add(e.gmail_id);
  else if (e.gmail_id && e.action) decisions.set(e.gmail_id, e);
}
const todo = [...errored].filter((id) => {
  const d = decisions.get(id);
  return d && !d.show && typeof d.action === 'string' && d.action.startsWith('label:');
});
console.log(`${todo.length} labels to repair`);

const labelId = await ensureLabel(config.label_name);
let ok = 0, fail = 0;
for (const id of todo) {
  try {
    await gws('messages', 'modify', { userId: 'me', id }, { addLabelIds: [labelId] });
    ok++;
  } catch (e) {
    fail++;
    console.error(`FAIL ${id}: ${String(e.message).slice(0, 140)}`);
  }
  await sleep(1500); // gentle: burst writes trip the connector throttle
}
console.log(`repaired ${ok}, failed ${fail}`);
