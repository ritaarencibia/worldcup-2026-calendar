// Headless render check for the bracket tab: run app.js against a fake DOM and
// assert renderBracket built the expected tree (5 round labels, 31 winners'-tree
// boxes + 1 bronze box, 15 connector elbows) without throwing.
const path = require('path');
const ROOT = path.dirname(__dirname);

function makeEl(tag = 'div') {
  return {
    tag, _children: [], style: {}, dataset: {},
    classList: { _c: new Set(), add(c) { this._c.add(c); }, remove(c) { this._c.delete(c); },
      toggle() {}, contains(c) { return this._c.has(c); } },
    set className(v) { this._cls = v; }, get className() { return this._cls || ''; },
    set innerHTML(v) { this._html = v; this._children = []; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { this._children = this._children.filter((x) => x !== c); },
    setAttribute(k, v) { this[k] = v; }, addEventListener() {}, click() {},
    value: '', checked: false, hidden: false,
  };
}

const registry = new Map();
global.window = {};
global.localStorage = { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } };
global.document = {
  getElementById(id) { if (!registry.has(id)) registry.set(id, makeEl('#' + id)); return registry.get(id); },
  createElement: (tag) => makeEl(tag),
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') this._init = fn; },
  body: makeEl('body'),
};

require(path.join(ROOT, 'data', 'teams.js'));
require(path.join(ROOT, 'data', 'matches.js'));
require(path.join(ROOT, 'data', 'results.js'));
require(path.join(ROOT, 'app.js'));
document._init();

const bracket = registry.get('bracket');
const all = [];
(function walk(el) { for (const c of el._children) { all.push(c); walk(c); } })(bracket);
const byCls = (cls) => all.filter((e) => (e.className || '').split(' ').includes(cls));

const labels = byCls('bracket-round-label').length;
const boxes = byCls('bn-box').length;
const links = byCls('bracket-link').length;
console.log('round labels :', labels, '(5 rounds + 1 bronze label = 6)');
console.log('bn-box       :', boxes, '(31 tree + 1 bronze)');
console.log('bracket-link :', links, '(8+4+2+1)');

let ok = true;
const check = (n, c) => { console.log(`${c ? 'OK ' : 'FAIL'}  ${n}`); ok = ok && c; };
check('6 round labels (5 rounds + bronze)', labels === 6);
check('32 boxes (31 tree + bronze)', boxes === 32);
check('15 connector elbows', links === 15);
process.exit(ok ? 0 : 1);
