// Gmail → Jev state extraction. Every field here is deterministic: code
// pulls it from the Gmail API, derives the judgment-friendly form, and hands
// Jev facts — never asks Jev (or any LLM) to extract them.
//
// Source: gmail.users.messages.get({ format: 'full' }) →
//   { id, threadId, labelIds, internalDate, payload: { headers, mimeType, parts, body } }

export function getHeader(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// "Jane Doe <jane@example.com>" → { name, address }. Display names are
// spoofable; the address is what code and Jev should key on.
export function parseAddress(raw) {
  if (!raw) return { name: null, address: null };
  const m = /^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(raw.trim());
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || null, address: m[2].toLowerCase() };
  const bare = raw.trim().toLowerCase();
  return { name: null, address: bare.includes('@') ? bare : null };
}

export function parseAddressList(raw) {
  if (!raw) return [];
  // Split on commas not inside quotes — good enough for real-world headers.
  return raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parseAddress).filter((a) => a.address);
}

// --- Dates -----------------------------------------------------------------
// internalDate is Gmail's server-stamped receipt time (epoch ms) — trustworthy.
// The Date: header is sender-claimed and spoofable; keep it for reference only.
export function receivedInfo(internalDate, now = new Date()) {
  const at = new Date(Number(internalDate));
  return { at: at.toISOString(), inWords: receivedInWords(at, now) };
}

export function receivedInWords(at, now) {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 365)} year(s) ago`;
}

// --- Body ------------------------------------------------------------------
// Walk MIME parts. Prefer text/plain; fall back to text/html converted to
// text. Track whether HTML existed and whether it carried images/tables —
// a human support reply and a marketing blast can both be HTML, so these
// are weak signals, useful only in combination.
const B64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function walkParts(part, acc) {
  const type = (part.mimeType || '').toLowerCase();
  if (type === 'text/plain' && part.body?.data) acc.text.push(B64(part.body.data));
  else if (type === 'text/html' && part.body?.data) acc.html.push(B64(part.body.data));
  (part.parts || []).forEach((p) => walkParts(p, acc));
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|p|div|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const MAX_BODY_CHARS = 6000; // state size gate (Jev state cap ~32K tokens)

export function extractBody(payload) {
  const acc = { text: [], html: [] };
  walkParts(payload, acc);
  const html = acc.html.join('\n');
  let body = acc.text.join('\n').trim();
  const wasHtml = html.length > 0;
  if (!body && wasHtml) body = htmlToText(html);
  const truncated = body.length > MAX_BODY_CHARS;
  if (truncated) body = body.slice(0, MAX_BODY_CHARS) + '\n[truncated]';
  return {
    body,
    was_html: wasHtml,
    // Counts, not booleans — "12 images" reads differently than "1 logo".
    image_count: wasHtml ? (html.match(/<img\b/gi) || []).length : 0,
    table_count: wasHtml ? (html.match(/<table\b/gi) || []).length : 0,
    truncated,
  };
}

// --- Marketing signals ------------------------------------------------------
export function unsubscribeInfo(headers) {
  const v = getHeader(headers, 'list-unsubscribe');
  return {
    has_unsubscribe_link: Boolean(v),
    // One-click (RFC 8058) vs manual — one-click is near-certain bulk mail.
    one_click: Boolean(v) && Boolean(getHeader(headers, 'list-unsubscribe-post')),
  };
}

// --- Gmail categories & labels ----------------------------------------------
// labelIds carries CATEGORY_PERSONAL/SOCIAL/PROMOTIONS/UPDATES/FORUMS plus
// user labels. INBOX/UNREAD are true for everything at triage time — drop
// them; keep the rest (STARRED/IMPORTANT are user-applied and meaningful).
const DROP_LABELS = new Set(['INBOX', 'UNREAD']);
export function gmailLabels(labelIds = []) {
  const kept = labelIds.filter((l) => !DROP_LABELS.has(l));
  const cat = kept.find((l) => l.startsWith('CATEGORY_'));
  return {
    gmail_category: cat ? cat.replace('CATEGORY_', '').toLowerCase() : null,
    gmail_labels: kept,
  };
}

// --- Sender relationship ----------------------------------------------------
// Resolved in code from the sender allowlist/pattern file (NOT by Jev).
// Unknown senders get null → the state field is omitted entirely, and Jev
// treats the sender as unknown (fail-open: unknown mail stays visible).
export function senderRelationship(address, senderMap) {
  if (!address || !senderMap) return null;
  const hit = senderMap[address.toLowerCase()];
  if (hit) return hit;
  for (const [pattern, desc] of Object.entries(senderMap)) {
    if (pattern.startsWith('*.') && address.toLowerCase().endsWith(pattern.slice(1))) return desc;
  }
  return null;
}
