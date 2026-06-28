// Offline check for the bracket view: the derived crossing tree must reach all
// 31 winners'-tree boxes (16+8+4+2+1) with feeder pairs adjacent, and the
// winner derived for each Round-of-32 box must agree with the team that the
// Round-of-16 box actually inherited from the live `resolved` map.
const path = require('path');
const ROOT = path.dirname(__dirname);

global.window = {};
require(path.join(ROOT, 'data', 'matches.js'));
require(path.join(ROOT, 'data', 'results.js'));

const MATCHES = global.window.MATCHES;
const RESULTS = global.window.RESULTS;
const RESOLVED = (RESULTS && RESULTS.resolved) || {};
const byNum = new Map(MATCHES.map((m) => [m.matchNumber, m]));

const resolvedCodes = (m) => {
  const r = RESOLVED[String(m.matchNumber)];
  return { home: (r && r.home) || m.home, away: (r && r.away) || m.away };
};
const feeder = (label) => {
  const m = /^W(\d+)$/.exec(label || '');
  return m ? Number(m[1]) : null;
};

// Mirror app.js bracketOrder()
const order = { final: [104] };
let cur = order.final;
for (const stage of ['sf', 'qf', 'r16', 'r32']) {
  const next = [];
  for (const num of cur) {
    const m = byNum.get(num);
    next.push(feeder(m.home), feeder(m.away));
  }
  order[stage] = next;
  cur = next;
}

let ok = true;
const check = (name, cond) => { console.log(`${cond ? 'OK ' : 'FAIL'}  ${name}`); ok = ok && cond; };

const expect = { final: 1, sf: 2, qf: 4, r16: 8, r32: 16 };
for (const [stage, n] of Object.entries(expect)) {
  const list = order[stage];
  check(`${stage}: ${n} boxes, all real & unique`,
    list.length === n && new Set(list).size === n && list.every((x) => byNum.has(x)));
}

// r32 set must be exactly matches 73..88
const r32 = [...order.r32].sort((a, b) => a - b);
check('r32 covers matches 73-88',
  r32.length === 16 && r32[0] === 73 && r32[15] === 88);

// Winner derivation (same logic as app.js knockoutWinner) for r32 -> r16 inherit
const knockoutWinner = (match) => {
  const label = `W${match.matchNumber}`;
  for (const d of MATCHES) {
    if (d.home === label) { const c = resolvedCodes(d).home; return c === label ? null : c; }
    if (d.away === label) { const c = resolvedCodes(d).away; return c === label ? null : c; }
  }
  return null;
};
let derived = 0;
for (const num of order.r32) {
  const w = knockoutWinner(byNum.get(num));
  if (w) {
    derived += 1;
    const codes = resolvedCodes(byNum.get(num));
    check(`match ${num} winner ${w} is one of its teams`,
      w === codes.home || w === codes.away);
  }
}
console.log(`derived winners for ${derived}/16 r32 boxes from resolved map`);

process.exit(ok ? 0 : 1);
