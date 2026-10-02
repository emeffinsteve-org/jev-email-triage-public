// Auth verdict parser — SPF/DKIM/DMARC → one enum for Jev state.
//
// Design: code does the expert interpretation (it can parse headers, check
// alignment, read the DMARC policy); Jev gets the conclusion as a single
// fact. Per the vendor/community guidance, anything a parser can compute
// belongs in code — Jev's job is judging what the fact means in context,
// not re-deriving it.
//
// Verdicts: "pass" | "fail" | "suspicious" | "unknown"
//   pass       — dmarc=pass, or DKIM passes with the signing domain aligned
//                to the From domain. Strong positive signal.
//   suspicious — everything hard-fails, OR dmarc=fail on a p=reject domain
//                that reached the inbox anyway (Gmail normally bounces those
//                at SMTP time, so delivery is anomalous).
//   fail       — authentication failed but doesn't meet the suspicious bar
//                (e.g. dmarc=fail on p=none — mailing lists live here).
//   unknown    — no headers, softfail/neutral/none only, temperror, or mixed
//                results. Means nothing; Jev should ignore it.
//
// The raw parse is returned alongside for the decision log (audit trail).

// Pull the first header value case-insensitively (Gmail returns headers as
// [{name, value}]). There can be several Authentication-Results headers (one
// per hop) — the FIRST is the topmost, i.e. Gmail's own.
function firstHeader(headers, name) {
  const lower = name.toLowerCase();
  const h = headers.find((x) => x.name.toLowerCase() === lower);
  return h ? h.value : null;
}

// Parse Gmail's Authentication-Results block. Only the FIRST authserv-id
// section is Gmail's own (e.g. "mx.google.com; ...") — earlier hops' results
// are ignored, otherwise a naive regex can grab the wrong hop's spf=.
export function parseAuthResults(headers) {
  const raw = firstHeader(headers, 'authentication-results');
  if (!raw) return null;

  // Isolate the first authserv-id block: everything up to the next token
  // that looks like a new "authserv-id;" opener is overkill — in practice
  // Gmail's results come first, so first-occurrence matching per mechanism
  // within the whole header is correct for the topmost block. We additionally
  // require the header to start with Gmail's MX id; otherwise bail to null
  // rather than misattribute another hop's results.
  if (!/^\s*mx\.google\.com\s*;/i.test(raw)) return null;

  const get = (re) => {
    const m = raw.match(re);
    return m ? m[1].toLowerCase() : null;
  };

  // dkim can appear multiple times (multiple signatures) — pass if ANY passes.
  const dkimResults = [...raw.matchAll(/dkim\s*=\s*([a-zA-Z]+)/gi)].map((m) => m[1].toLowerCase());
  const dkim = dkimResults.includes('pass') ? 'pass'
    : dkimResults[0] ?? null;

  const out = {
    spf: get(/spf\s*=\s*([a-zA-Z]+)/i),
    dkim,
    dmarc: get(/dmarc\s*=\s*([a-zA-Z]+)/i),
    // Signing domain: "dkim=pass header.i=@example.com" (header.i preferred;
    // fall back to d=).
    dkimDomain: get(/header\.i=@([^\s;]+)/i) ?? get(/\bd=([^\s;]+)/i),
    // DMARC policy as published: "dmarc=fail (p=REJECT sp=REJECT ...)".
    policy: get(/dmarc\s*=\s*[a-zA-Z]+\s*\([^)]*?\bp=([A-Za-z]+)/i),
    // Envelope-from domain, for reference in the log.
    mailFrom: get(/smtp\.mailfrom=([^\s;]+)/i),
  };
  return out;
}

function domainOf(address) {
  const m = /@([^@<>\s]+)/.exec(address ?? '');
  return m ? m[1].toLowerCase() : null;
}

// Approximate organizational-domain alignment: exact match or parent/child.
// (A Public Suffix List check would be more correct; this covers the real
// cases — same domain or subdomain — without the dependency.)
function aligned(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

export function authVerdict(headers, fromAddress) {
  const parsed = parseAuthResults(headers);
  if (!parsed) return { verdict: 'unknown', detail: null };

  const fromDomain = domainOf(fromAddress);
  const { spf, dkim, dmarc, dkimDomain, policy } = parsed;

  // dmarc=pass already encodes alignment — strongest signal.
  if (dmarc === 'pass') return { verdict: 'pass', detail: parsed };
  // Aligned DKIM pass survives forwarding, which is exactly when SPF breaks.
  if (dkim === 'pass' && aligned(dkimDomain, fromDomain)) return { verdict: 'pass', detail: parsed };
  // p=reject + delivered anyway = anomalous. Gmail bounces these at SMTP
  // time; one in the inbox deserves suspicion.
  if (dmarc === 'fail' && policy === 'reject') return { verdict: 'suspicious', detail: parsed };
  // Total hard failure across the board.
  if (spf === 'fail' && dkim !== 'pass' && dmarc !== 'pass') return { verdict: 'suspicious', detail: parsed };
  // Any recorded failure that isn't total: mailing lists, p=none senders,
  // misconfigured small domains. A signal, not an accusation.
  if (spf === 'fail' || dkim === 'fail' || dmarc === 'fail') return { verdict: 'fail', detail: parsed };

  return { verdict: 'unknown', detail: parsed };
}
