// buildState: Gmail message → Jev state object. Assembles every deterministic
// field; Jev never computes these itself.
import {
  getHeader, parseAddress, parseAddressList,
  receivedInfo, extractBody, unsubscribeInfo, gmailLabels, senderRelationship,
} from './extract.mjs';
import { authVerdict } from './auth.mjs';
import { extractDates } from './dates.mjs';

// NOTE (sanitized for public release): the original hardcoded the author's
// real addresses here. Put your own below — the address_tier signal feeds
// the composite score, so keep the tiers meaningful for your mail.
export const PRIMARY_ADDRESSES = ['you@example.com', 'you@work.example.com'];
export const WORK_ADDRESS = 'you@second-job.example.com';

export function addressTier(toList) {
  const addrs = toList.map((t) => t.address).filter(Boolean);
  if (addrs.some((a) => PRIMARY_ADDRESSES.includes(a))) return 'primary';
  if (addrs.includes(WORK_ADDRESS)) return 'work';
  return 'other';
}

// NOTE (sanitized): the original profile described a real person — name,
// addresses, family, employer, and other personal details. Redacted. Write your own:
// the sharper this profile, the better the triage. Tell the model who you
// are, which addresses are yours, and what kinds of mail matter to you.
const RECIPIENT_PROFILE = `Jane Doe. Primary addresses: you@example.com (personal) and you@work.example.com (work) — mail here usually deserves attention. you@second-job.example.com is a secondary work address. Per-service aliases (e.g. via an alias service) usually carry automated mail.`;

export function buildState(msg, { threadMessageCount = 1, senderMap = null, now = new Date() } = {}) {
  const headers = msg.payload?.headers ?? [];
  const from = parseAddress(getHeader(headers, 'from'));
  const to = parseAddressList(getHeader(headers, 'to'));
  const cc = parseAddressList(getHeader(headers, 'cc'));
  const subject = getHeader(headers, 'subject') ?? '';
  const received = receivedInfo(msg.internalDate, now);
  const body = extractBody(msg.payload ?? {});
  const unsub = unsubscribeInfo(headers);
  const labels = gmailLabels(msg.labelIds);
  const auth = authVerdict(headers, from.address);
  const rel = senderRelationship(from.address, senderMap);
  const dates = extractDates(`${subject}\n${body.body}`, received.at);

  const email = {
    from: from.address,
    from_name: from.name,
    to: to.map((t) => t.address),
    ...(cc.length ? { cc: cc.map((t) => t.address) } : {}),
    subject,
    received: received.inWords,
    received_at: received.at,
    auth: auth.verdict,
    ...(rel ? { sender_relationship: rel } : {}),
    messages_in_thread: threadMessageCount,
    has_unsubscribe_link: unsub.has_unsubscribe_link,
    one_click_unsubscribe: unsub.one_click,
    ...(labels.gmail_category ? { gmail_category: labels.gmail_category } : {}),
    ...(labels.gmail_labels.length ? { gmail_labels: labels.gmail_labels } : {}),
    was_html: body.was_html,
    image_count: body.image_count,
    table_count: body.table_count,
    ...(dates.length ? { dates_mentioned: dates } : {}),
    body: body.body,
  };

  return {
    today: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    recipient_profile: RECIPIENT_PROFILE,
    address_tier: addressTier(to),
    email,
    _debug: { auth_detail: auth.detail, body_truncated: body.truncated, gmail_id: msg.id },
  };
}
