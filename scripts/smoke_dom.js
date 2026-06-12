// Headless smoke test: run app.js against a tiny fake DOM to catch runtime
// errors in init/render (scores, standings, tabs). Not a fidelity test — just
// "does it execute without throwing against the real data files".
const path = require('path');
const ROOT = path.dirname(__dirname);

function makeEl(tag = 'div') {
  return {
    tag,
    _children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text || ''; },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { this._children = this._children.filter((x) => x !== c); },
    setAttribute(k, v) { this[k] = v; },
    addEventListener() {},
    click() {},
    value: '',
    checked: false,
    hidden: false,
  };
}

const registry = new Map();
global.window = {};
global.localStorage = {
  _s: {},
  getItem(k) { return k in this._s ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
};
global.document = {
  getElementById(id) {
    if (!registry.has(id)) registry.set(id, makeEl('#' + id));
    return registry.get(id);
  },
  createElement: (tag) => makeEl(tag),
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') this._init = fn; },
  body: makeEl('body'),
};

require(path.join(ROOT, 'data', 'teams.js'));
require(path.join(ROOT, 'data', 'matches.js'));
require(path.join(ROOT, 'data', 'results.js'));
require(path.join(ROOT, 'app.js'));

// Fire DOMContentLoaded -> init()
document._init();

// Assertions on what the render produced
const schedule = registry.get('schedule');
const standings = registry.get('standings');
const updated = registry.get('updated-at');
const kept = registry.get('kept-count');

const dayHeaders = schedule._children.filter((c) => c.tag === 'h2').length;
const standingCards = standings._children.filter((c) => c.tag === 'div').length;

console.log('kept-count text :', kept.textContent);
console.log('updated-at text :', updated.textContent);
console.log('day headers     :', dayHeaders);
console.log('standings cards :', standingCards);

let ok = true;
function check(name, cond) {
  console.log(`${cond ? 'OK ' : 'FAIL'}  ${name}`);
  ok = ok && cond;
}
check('schedule rendered day headers', dayHeaders > 0);
check('standings rendered 12 group cards', standingCards === 12);
check('updated-at populated from RESULTS', /Results updated/.test(updated.textContent));
check('kept-count populated', /matches shown/.test(kept.textContent));

process.exit(ok ? 0 : 1);
