// Verify the two spec_v3 behaviours in isolation, with a controlled clock:
//   1. LIVE badge: a match is "in play" from kickoff until LIVE_DURATION_MS later
//      (unless results already mark it finished).
//   2. "Hide old matches" cut: keep yesterday + everything upcoming, drop older;
//      a live match is never dropped.
// Mirrors the logic in app.js (which isn't importable as a module).
const TIME_ZONE = 'Europe/Oslo';
const LIVE_DURATION_MS = 2.5 * 60 * 60 * 1000;

const keyFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
function dateKey(iso) {
  const p = {};
  for (const x of keyFmt.formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function isLive(match, now, finished) {
  if (finished) return false;
  const start = new Date(match.kickoffUtc).getTime();
  return now >= start && now < start + LIVE_DURATION_MS;
}
function cutoffKey(now) {
  return dateKey(new Date(now - 24 * 60 * 60 * 1000).toISOString());
}
function isHiddenAsOld(match, now, finished) {
  if (isLive(match, now, finished)) return false;
  return dateKey(match.kickoffUtc) < cutoffKey(now);
}

// "Now" pinned to 2026-06-21 20:00 Oslo (== 18:00 UTC in summer / CEST = UTC+2).
const NOW = new Date('2026-06-21T18:00:00Z').getTime();

const cases = [
  ['live: kicked off 1h ago',        isLive({ kickoffUtc: '2026-06-21T17:00:00Z' }, NOW, false), true],
  ['live: kicks off in 1h (not yet)', isLive({ kickoffUtc: '2026-06-21T19:00:00Z' }, NOW, false), false],
  ['live: started 3h ago (window over)', isLive({ kickoffUtc: '2026-06-21T15:00:00Z' }, NOW, false), false],
  ['live: in window but finished',   isLive({ kickoffUtc: '2026-06-21T17:00:00Z' }, NOW, true), false],
  ['cut: today is kept',             isHiddenAsOld({ kickoffUtc: '2026-06-21T19:00:00Z' }, NOW, false), false],
  ['cut: yesterday is kept',         isHiddenAsOld({ kickoffUtc: '2026-06-20T19:00:00Z' }, NOW, false), false],
  ['cut: two days ago is hidden',    isHiddenAsOld({ kickoffUtc: '2026-06-19T19:00:00Z' }, NOW, false), true],
  ['cut: old but live -> kept',      isHiddenAsOld({ kickoffUtc: '2026-06-21T17:00:00Z' }, NOW, false), false],
];

let ok = true;
for (const [name, got, want] of cases) {
  const pass = got === want;
  ok = ok && pass;
  console.log(`${pass ? 'OK ' : 'FAIL'}  ${name}: ${got}` + (pass ? '' : ` (expected ${want})`));
}
process.exit(ok ? 0 : 1);
