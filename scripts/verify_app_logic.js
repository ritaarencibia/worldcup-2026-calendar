// Verify the union-of-filters logic (Intl + Europe/Oslo) against expectations.
const path = require('path');

const ROOT = path.dirname(__dirname);
global.window = {};
require(path.join(ROOT, 'data', 'teams.js'));
require(path.join(ROOT, 'data', 'matches.js'));
require(path.join(ROOT, 'data', 'results.js'));
const MATCHES = global.window.MATCHES;
const RESULTS = global.window.RESULTS || null;
const RESOLVED = (RESULTS && RESULTS.resolved) || {};

// Mirror app.js: knockout slots ("2A", "W73") read through to real codes once
// the bracket fills in; group matches already carry real codes.
function resolvedCodes(m) {
  const r = RESOLVED[String(m.matchNumber)];
  return { home: (r && r.home) || m.home, away: (r && r.away) || m.away };
}

const TIME_ZONE = 'Europe/Oslo';
const BIG_TEAMS = new Set(['GER', 'BRA', 'ARG', 'ENG', 'FRA', 'ESP', 'POR']);
const ALWAYS = new Set(['qf', 'sf', 'bronze', 'final']);

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(iso) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(iso))) p[x.type] = x.value;
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute) };
}

function asleep(lp) {
  const m = lp.hour * 60 + lp.minute;
  return m >= 0 && m < 7 * 60;
}

function passMyTeams(m, fav) {
  const c = resolvedCodes(m);
  return fav.has(c.home) || fav.has(c.away);
}
function passGoodHours(m, lp) { return !asleep(lp); }
function passKeyKnockouts(m) { return ALWAYS.has(m.stage); }
function passWeekendRescue(m, lp) {
  const weekend = lp.weekday === 'Sat' || lp.weekday === 'Sun';
  return asleep(lp) && weekend && (BIG_TEAMS.has(m.home) || BIG_TEAMS.has(m.away));
}

function included(m, filters, fav) {
  const anyOn = filters.myTeams || filters.goodHours || filters.keyKnockouts || filters.weekendRescue;
  if (!anyOn) return true;
  const lp = parts(m.kickoffUtc);
  return (
    (filters.myTeams && passMyTeams(m, fav)) ||
    (filters.goodHours && passGoodHours(m, lp)) ||
    (filters.keyKnockouts && passKeyKnockouts(m)) ||
    (filters.weekendRescue && passWeekendRescue(m, lp))
  );
}

function count(filters, fav = new Set()) {
  return MATCHES.filter((m) => included(m, filters, fav)).length;
}

const ALL_ON = { myTeams: true, goodHours: true, keyKnockouts: true, weekendRescue: true };
const NONE = { myTeams: false, goodHours: false, keyKnockouts: false, weekendRescue: false };

const cases = [
  ['All four ON (= old behaviour)', count(ALL_ON), 57],
  ['None ON (show all)', count(NONE), 104],
  ['Only My teams, no favorites', count({ ...NONE, myTeams: true }), 0],
  // ESP: 3 group matches + its resolved Round-of-32 tie (match 84).
  ['Only My teams + ESP favorite (group + resolved KO)', count({ ...NONE, myTeams: true }, new Set(['ESP'])), 4],
  ['Only Key knockouts', count({ ...NONE, keyKnockouts: true }), 8],
];

let ok = true;
for (const [name, got, want] of cases) {
  const pass = got === want;
  ok = ok && pass;
  console.log(`${pass ? 'OK ' : 'FAIL'}  ${name}: ${got}` + (pass ? '' : ` (expected ${want})`));
}

// Good hours alone: every match not starting in the sleep window.
const goodHoursOnly = count({ ...NONE, goodHours: true });
console.log(`info  Only Good hours: ${goodHoursOnly}`);

process.exit(ok ? 0 : 1);
