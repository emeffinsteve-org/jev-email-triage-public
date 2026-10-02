// dates_mentioned extraction: scan subject+body for date expressions, resolve
// each against the email's received date into absolute, human-readable
// strings. Code does the date math; Jev reads the results.
//
// Output per date: "Monday, October 5, 2026 (in 5 days)" / "(3 days ago)".

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const MAX_DATES = 8;

function fmt(d, ref) {
  const days = Math.round((d - startOfDay(ref)) / 86400000);
  const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow'
    : days === -1 ? 'yesterday'
    : days > 0 ? `in ${days} days` : `${-days} days ago`;
  const wd = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  const md = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  return `${wd}, ${md} (${rel})`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

// "October 5" → the occurrence closest to ref (prefers future on ties).
function resolveMonthDay(month, day, ref) {
  const y = ref.getFullYear();
  const mk = (yr) => new Date(yr, month, day);
  const cands = [mk(y - 1), mk(y), mk(y + 1)].filter((d) => d.getMonth() === month);
  cands.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref)
    || (b >= ref ? 0 : 1) - (a >= ref ? 0 : 1));
  return cands[0];
}

function resolveWeekday(wd, ref, direction /* 'next' | 'last' | null */) {
  const delta = (wd - ref.getDay() + 7) % 7;
  if (direction === 'last') return addDays(ref, delta === 0 ? -7 : delta - 7);
  if (direction === 'next') return addDays(ref, delta === 0 ? 7 : delta);
  return addDays(ref, delta === 0 ? 0 : delta); // nearest upcoming, incl. today
}

export function extractDates(text, receivedAt) {
  const ref = startOfDay(new Date(receivedAt));
  const found = [];
  const seen = new Set();
  const push = (d) => {
    const t = d.getTime();
    if (!seen.has(t) && found.length < MAX_DATES) { seen.add(t); found.push(d); }
  };

  const monthNames = Object.keys(MONTHS).join('|');
  const wdNames = Object.keys(WEEKDAYS).join('|');

  // "October 5", "Oct. 5th", "5 October"
  for (const m of text.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi')))
    push(resolveMonthDay(MONTHS[m[1].toLowerCase()], Number(m[2]), ref));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(${monthNames})\\b`, 'gi')))
    push(resolveMonthDay(MONTHS[m[2].toLowerCase()], Number(m[1]), ref));
  // "10/5" or "10/5/2026" (US order)
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const mo = Number(m[1]) - 1, da = Number(m[2]);
    if (mo < 0 || mo > 11 || da < 1 || da > 31) continue;
    if (m[3]) {
      const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(yr, mo, da);
      if (d.getMonth() === mo) push(d);
    } else push(resolveMonthDay(mo, da, ref));
  }
  // weekday names, with optional "last"/"next"/"this"
  for (const m of text.matchAll(new RegExp(`\\b(?:(last|next|this)\\s+)?(${wdNames})\\b`, 'gi'))) {
    if (!m[1] && !m[2]) continue;
    push(resolveWeekday(WEEKDAYS[m[2].toLowerCase()], ref, m[1]?.toLowerCase() ?? null));
  }
  // relative words
  if (/\btoday\b/i.test(text)) push(ref);
  if (/\btomorrow\b/i.test(text)) push(addDays(ref, 1));
  if (/\byesterday\b/i.test(text)) push(addDays(ref, -1));
  for (const m of text.matchAll(/\bin\s+(\d+)\s+days?\b/gi)) push(addDays(ref, Number(m[1])));
  for (const m of text.matchAll(/\bnext\s+week\b/gi)) push(addDays(ref, 7));
  for (const m of text.matchAll(/\bnext\s+month\b/gi)) {
    const d = new Date(ref); d.setMonth(d.getMonth() + 1); push(startOfDay(d));
  }

  found.sort((a, b) => a - b);
  return found.map((d) => fmt(d, ref));
}
