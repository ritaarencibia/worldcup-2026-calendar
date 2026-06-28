/* My World Cup 2026 Calendar — all logic runs in the browser, no backend.
 * Filtering rules mirror spec_v1.md §5. */
'use strict';

// Big nations for the weekend exception (spec §5 rule 3).
const BIG_TEAMS = new Set(['GER', 'BRA', 'ARG', 'ENG', 'FRA', 'ESP', 'POR']);

const STAGE_LABELS = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  bronze: 'Third-place play-off',
  final: 'Final',
};
const ALWAYS_KNOCKOUT = new Set(['qf', 'sf', 'bronze', 'final']);
const TBD_KNOCKOUT = new Set(['r32', 'r16']);

// How long after kickoff a match is treated as "in play" for the LIVE badge.
// Generous on purpose: knockouts can run to extra time and penalties.
const LIVE_DURATION_MS = 2.5 * 60 * 60 * 1000;

const STORAGE_KEY = 'wc2026.prefs.v1';

const TEAMS = window.TEAMS || [];
const MATCHES = window.MATCHES || [];
const TEAM_BY_CODE = new Map(TEAMS.map((t) => [t.code, t]));
const MATCH_BY_NUMBER = new Map(MATCHES.map((m) => [m.matchNumber, m]));

// Live data (results + standings + bracket). Optional: if data/results.js is
// missing or failed to load, the page degrades to the plain schedule.
const RESULTS = window.RESULTS || null;
const RESULT_BY_NUMBER = (RESULTS && RESULTS.results) || {};
const STANDINGS = (RESULTS && RESULTS.standings) || {};
const RESOLVED = (RESULTS && RESULTS.resolved) || {};

function resultFor(match) {
  return RESULT_BY_NUMBER[String(match.matchNumber)] || null;
}

// "In play right now", judged purely from the browser clock — no scraping, no
// backend. A match is live from kickoff until LIVE_DURATION_MS later, unless the
// scraped data already marks it finished.
function isLive(match) {
  const r = resultFor(match);
  if (r && r.status === 'finished') return false;
  const start = new Date(match.kickoffUtc).getTime();
  const now = Date.now();
  return now >= start && now < start + LIVE_DURATION_MS;
}

// Knockout slots ("1A", "W74") resolve to real team codes once known; group
// matches already carry real codes. Returns the codes to display for this match.
function resolvedCodes(match) {
  const r = RESOLVED[String(match.matchNumber)];
  return {
    home: (r && r.home) || match.home,
    away: (r && r.away) || match.away,
  };
}

// ---- Preferences (persisted in localStorage) -------------------------------
// Four independent filters combined as a UNION: a match is shown if it passes
// ANY enabled filter. With none enabled, every match is shown.
const defaultFilters = {
  myTeams: true,        // followed team plays (group stage), any time
  goodHours: true,      // starts outside the sleep window
  keyKnockouts: true,   // QF / SF / final / third-place, always
  weekendRescue: true,  // Sat/Sun night with a big team
};
const defaultPrefs = {
  favorites: [],
  filters: { ...defaultFilters },
  sleepStart: '00:00',
  sleepEnd: '07:00',
  tab: 'matches',
  hideOld: true,        // hide matches before yesterday (a cut, not a union filter)
  prefsOpen: false,     // preferences panel collapsed by default
  timeZone: 'Europe/Oslo', // display timezone for all kick-off times
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultPrefs };
    const parsed = JSON.parse(raw);
    return {
      ...defaultPrefs,
      ...parsed,
      filters: { ...defaultFilters, ...(parsed.filters || {}) },
    };
  } catch (e) {
    return { ...defaultPrefs };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    /* storage may be unavailable; ignore */
  }
}

const prefs = loadPrefs();

// ---- Timezone helpers ------------------------------------------------------
// The display timezone is user-selectable (default Europe/Oslo). Every
// wall-clock string goes through these two formatters, which are rebuilt
// whenever the zone changes so the schedule, day headers, bracket and the
// "updated" line all move together.
let TIME_ZONE = prefs.timeZone || 'Europe/Oslo';
let partsFmt;
let dayHeaderFmt;

function buildFormatters() {
  partsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  dayHeaderFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long',
  });
}
buildFormatters();

// Short name of the current zone at a given instant, e.g. "CEST", "GMT-5",
// "JST" — used for the header hint and the "Results updated …" line.
function tzLabel(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, timeZoneName: 'short', hour: '2-digit',
    }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName');
    return name ? name.value : TIME_ZONE;
  } catch (e) {
    return TIME_ZONE;
  }
}

/** Wall-clock fields of an instant in the user's timezone. */
function localParts(isoUtc) {
  const date = new Date(isoUtc);
  const parts = {};
  for (const p of partsFmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    date,
    weekday: parts.weekday, // 'Mon'..'Sun'
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function parseHHMM(str) {
  const [h, m] = (str || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

// ---- Filtering (spec §5) ---------------------------------------------------
function inSleepWindow(lp) {
  const start = parseHHMM(prefs.sleepStart);
  const end = parseHHMM(prefs.sleepEnd);
  const minutes = lp.hour * 60 + lp.minute;
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end; // normal window
  return minutes >= start || minutes < end; // window crossing midnight
}

// Independent filter predicates (spec §5). Each answers "does this match
// qualify under this single filter?".
function passMyTeams(match) {
  const favorites = new Set(prefs.favorites);
  // Group matches already carry real codes; knockout slots ("2A", "W73")
  // resolve to real codes once the bracket fills in, so a followed team's
  // knockout matches are kept the moment its opponent is known.
  const codes = resolvedCodes(match);
  return favorites.has(codes.home) || favorites.has(codes.away);
}

function passGoodHours(match, lp) {
  return !inSleepWindow(lp);
}

function passKeyKnockouts(match) {
  return ALWAYS_KNOCKOUT.has(match.stage);
}

function passWeekendRescue(match, lp) {
  const weekend = lp.weekday === 'Sat' || lp.weekday === 'Sun';
  return (
    inSleepWindow(lp) &&
    weekend &&
    (BIG_TEAMS.has(match.home) || BIG_TEAMS.has(match.away))
  );
}

function isIncluded(match) {
  if (isLive(match)) return true; // a match that's on right now always shows
  const f = prefs.filters;
  const anyOn = f.myTeams || f.goodHours || f.keyKnockouts || f.weekendRescue;
  if (!anyOn) return true; // nothing ticked -> show every match

  const lp = localParts(match.kickoffUtc);
  return (
    (f.myTeams && passMyTeams(match)) ||
    (f.goodHours && passGoodHours(match, lp)) ||
    (f.keyKnockouts && passKeyKnockouts(match)) ||
    (f.weekendRescue && passWeekendRescue(match, lp))
  );
}

// ---- "Hide old matches" cut ------------------------------------------------
// Distinct from the union filters above: this is a SUBTRACTION applied to the
// whole list, not another "show if…" option. We keep yesterday and everything
// upcoming, dropping anything older (a live match is never dropped).
function recentCutoffKey() {
  // Start of "yesterday" in the user's timezone, as a YYYY-MM-DD key.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return localParts(yesterday.toISOString()).dateKey;
}

function isHiddenAsOld(match, cutoffKey) {
  if (!cutoffKey) return false; // toggle off -> nothing is too old
  if (isLive(match)) return false;
  return localParts(match.kickoffUtc).dateKey < cutoffKey; // keys sort lexically
}

// The single source of truth for what the schedule and the "Export all" share.
function visibleMatches() {
  const cutoffKey = prefs.hideOld ? recentCutoffKey() : null;
  return MATCHES.filter((m) => isIncluded(m) && !isHiddenAsOld(m, cutoffKey));
}

// ---- Rendering -------------------------------------------------------------
function teamDisplay(code, fallbackLabel) {
  const team = TEAM_BY_CODE.get(code);
  if (team) return `${team.flag} ${team.name}`;
  return fallbackLabel; // unresolved knockout placeholder like "1A" / "W74"
}

function matchTitle(match) {
  const codes = resolvedCodes(match);
  const home = teamDisplay(codes.home, match.homeLabel);
  const away = teamDisplay(codes.away, match.awayLabel);
  const r = resultFor(match);
  const join = r && r.status === 'finished' ? `${r.home}–${r.away}` : 'vs';
  return `${home} ${join} ${away}`;
}

function calLink(label, href) {
  const a = document.createElement('a');
  a.className = 'cal-link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}

function renderSchedule() {
  const visible = visibleMatches();

  document.getElementById('kept-count').textContent =
    `${visible.length} of ${MATCHES.length} matches shown`;

  const container = document.getElementById('schedule');
  container.innerHTML = '';

  if (visible.length === 0) {
    container.innerHTML = '<p class="empty">No matches match your filters.</p>';
    return;
  }

  let currentKey = null;
  let dayList = null;
  for (const match of visible) {
    const lp = localParts(match.kickoffUtc);
    if (lp.dateKey !== currentKey) {
      currentKey = lp.dateKey;
      const h2 = document.createElement('h2');
      h2.className = 'day-header';
      h2.textContent = dayHeaderFmt.format(lp.date);
      container.appendChild(h2);
      dayList = document.createElement('ul');
      dayList.className = 'match-list';
      container.appendChild(dayList);
    }

    const finished = resultFor(match) && resultFor(match).status === 'finished';
    const live = isLive(match);
    const li = document.createElement('li');
    li.className =
      'match' + (finished ? ' match--finished' : '') + (live ? ' match--live' : '');

    const time = document.createElement('span');
    time.className = 'match-time';
    time.textContent = finished ? 'FT' : lp.time;

    const info = document.createElement('div');
    info.className = 'match-info';
    const title = document.createElement('span');
    title.className = 'match-title';
    title.textContent = matchTitle(match);
    if (live) {
      const badge = document.createElement('span');
      badge.className = 'live-badge'; // CSS margin handles the gap from the title
      badge.textContent = '🔴 LIVE';
      title.appendChild(badge);
    }
    const meta = document.createElement('span');
    meta.className = 'match-meta';
    const stage = STAGE_LABELS[match.stage] + (match.group ? ` ${match.group}` : '');
    meta.textContent = `${stage} · ${match.venue}, ${match.city}`;
    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'match-actions';
    actions.appendChild(calLink('+ Google', googleCalendarUrl(match)));
    actions.appendChild(calLink('+ Outlook', outlookCalendarUrl(match)));
    const icsBtn = document.createElement('button');
    icsBtn.type = 'button';
    icsBtn.className = 'cal-link';
    icsBtn.textContent = '⬇ .ics';
    icsBtn.title = 'Download this match (.ics)';
    icsBtn.addEventListener('click', () => downloadMatchICS(match));
    actions.appendChild(icsBtn);

    li.appendChild(time);
    li.appendChild(info);
    li.appendChild(actions);
    dayList.appendChild(li);
  }
}

const STANDING_COLS = [
  ['pld', 'Pld'], ['w', 'W'], ['d', 'D'], ['l', 'L'],
  ['gf', 'GF'], ['ga', 'GA'], ['gd', 'GD'], ['pts', 'Pts'],
];

function renderStandings() {
  const container = document.getElementById('standings');
  container.innerHTML = '';

  const groups = Object.keys(STANDINGS).sort();
  if (groups.length === 0) {
    container.innerHTML =
      '<p class="empty">Standings will appear here once the first matches are played.</p>';
    return;
  }

  for (const letter of groups) {
    const rows = STANDINGS[letter];
    if (!rows || rows.length === 0) continue;

    const card = document.createElement('div');
    card.className = 'standings-card';
    const h3 = document.createElement('h3');
    h3.className = 'standings-title';
    h3.textContent = `Group ${letter}`;
    card.appendChild(h3);

    const table = document.createElement('table');
    table.className = 'standings-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.innerHTML = '<th class="col-pos">#</th><th class="col-team">Team</th>' +
      STANDING_COLS.map(([, label]) => `<th>${label}</th>`).join('');
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const team = TEAM_BY_CODE.get(row.code);
      const tr = document.createElement('tr');
      // top two qualify directly; 3rd may qualify as a best third-placed team
      if (row.pos <= 2) tr.className = 'qualify';
      else if (row.pos === 3) tr.className = 'maybe';

      const teamCell = team ? `${team.flag} ${team.name}` : row.code;
      tr.innerHTML =
        `<td class="col-pos">${row.pos}</td>` +
        `<td class="col-team">${teamCell}</td>` +
        STANDING_COLS.map(([key]) => {
          const v = row[key];
          const text = key === 'gd' && v > 0 ? `+${v}` : v;
          return `<td>${text}</td>`;
        }).join('');
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);
  }
}

// ---- Bracket (knockout tree) ----------------------------------------------
// The crossings are derived purely from the placeholder labels already in the
// data: a Round-of-16 box whose home slot is "W73" is fed by match 73. So the
// whole tree shape is known from day one — long before any team is decided —
// and `resolved` simply fills real teams in as the rounds are played.
const KO_ROUNDS = ['final', 'sf', 'qf', 'r16', 'r32']; // walk root -> leaves

// Match number feeding a winner slot ("W73" -> 73), or null for a group
// placeholder ("2A") that has no upstream match.
function feederNumber(label) {
  const m = /^W(\d+)$/.exec(label || '');
  return m ? Number(m[1]) : null;
}

// Top-to-bottom order of each round so that the two feeders of every box sit
// directly above/below it. Built by walking down from the final: the children
// of box N are listed as [feeder(home), feeder(away)], which keeps each pair
// adjacent and lets space-around centre every box between its two feeders.
function bracketOrder() {
  const order = { final: [104] };
  let cur = order.final;
  for (const stage of ['sf', 'qf', 'r16', 'r32']) {
    const next = [];
    for (const num of cur) {
      const m = MATCH_BY_NUMBER.get(num);
      next.push(feederNumber(m.home), feederNumber(m.away));
    }
    order[stage] = next;
    cur = next;
  }
  return order;
}

// Winner of a knockout box as a real team code, or null if not decided yet.
// Robust against extra time / penalties: rather than judging the score, we read
// which team the downstream box inherited into the matching "W{n}" slot. The
// final has no downstream box, so there alone we fall back to the score.
function knockoutWinner(match) {
  const label = `W${match.matchNumber}`;
  for (const d of MATCHES) {
    if (d.home === label) {
      const code = resolvedCodes(d).home;
      return code === label ? null : code;
    }
    if (d.away === label) {
      const code = resolvedCodes(d).away;
      return code === label ? null : code;
    }
  }
  const r = resultFor(match);
  if (r && r.status === 'finished' && r.home !== r.away) {
    const codes = resolvedCodes(match);
    return r.home > r.away ? codes.home : codes.away;
  }
  return null;
}

function bracketTeamRow(code, fallbackLabel, score, isWinner, isFav) {
  const row = document.createElement('div');
  row.className =
    'bn-team' + (isWinner ? ' bn-team--win' : '') + (isFav ? ' bn-team--fav' : '');
  const name = document.createElement('span');
  name.className = 'bn-name';
  const team = TEAM_BY_CODE.get(code);
  name.textContent = team ? `${team.flag} ${team.name}` : fallbackLabel;
  row.appendChild(name);
  if (score !== null) {
    const s = document.createElement('span');
    s.className = 'bn-score';
    s.textContent = score;
    row.appendChild(s);
  }
  return row;
}

function bracketBox(match) {
  const codes = resolvedCodes(match);
  const r = resultFor(match);
  const finished = !!(r && r.status === 'finished');
  const winner = knockoutWinner(match);
  const favorites = new Set(prefs.favorites);

  const box = document.createElement('div');
  box.className = 'bn-box' + (isLive(match) ? ' bn-box--live' : '');

  const head = document.createElement('div');
  head.className = 'bn-head';
  const lp = localParts(match.kickoffUtc);
  head.textContent = finished ? 'FT' : `${lp.day}/${lp.month} · ${lp.time}`;
  if (isLive(match)) head.textContent = '🔴 LIVE';
  box.appendChild(head);

  box.appendChild(
    bracketTeamRow(codes.home, match.homeLabel, finished ? r.home : null,
      winner === codes.home, favorites.has(codes.home)));
  box.appendChild(
    bracketTeamRow(codes.away, match.awayLabel, finished ? r.away : null,
      winner === codes.away, favorites.has(codes.away)));
  return box;
}

function bracketColumn(numbers) {
  const col = document.createElement('div');
  col.className = 'bracket-col';
  for (const num of numbers) col.appendChild(bracketBox(MATCH_BY_NUMBER.get(num)));
  return col;
}

// A column of elbow connectors sitting between two rounds. One elbow per box in
// the round to the right; space-around lines each elbow up with its box, and
// flex:1 sizes each elbow so its vertical bar exactly spans the two feeders.
function bracketLinks(count) {
  const col = document.createElement('div');
  col.className = 'bracket-links';
  for (let i = 0; i < count; i += 1) {
    const link = document.createElement('div');
    link.className = 'bracket-link';
    col.appendChild(link);
  }
  return col;
}

function renderBracket() {
  const container = document.getElementById('bracket');
  container.innerHTML = '';
  if (!MATCH_BY_NUMBER.has(104)) {
    container.innerHTML = '<p class="empty">Bracket data unavailable.</p>';
    return;
  }
  const order = bracketOrder();

  // Round labels, left (Round of 32) to right (Final), aligned over each column.
  const labels = document.createElement('div');
  labels.className = 'bracket-rounds';
  for (const stage of [...KO_ROUNDS].reverse()) {
    const span = document.createElement('span');
    span.className = 'bracket-round-label';
    span.textContent = STAGE_LABELS[stage];
    labels.appendChild(span);
  }
  container.appendChild(labels);

  // Columns left->right with a connector column between each pair of rounds.
  const tree = document.createElement('div');
  tree.className = 'bracket-tree';
  const cols = ['r32', 'r16', 'qf', 'sf', 'final'];
  cols.forEach((stage, i) => {
    tree.appendChild(bracketColumn(order[stage]));
    if (i < cols.length - 1) tree.appendChild(bracketLinks(order[cols[i + 1]].length));
  });
  container.appendChild(tree);

  // Third-place play-off lives outside the winners' tree, shown on its own.
  const bronze = MATCH_BY_NUMBER.get(103);
  if (bronze) {
    const wrap = document.createElement('div');
    wrap.className = 'bracket-bronze';
    const label = document.createElement('span');
    label.className = 'bracket-round-label';
    label.textContent = STAGE_LABELS.bronze;
    wrap.appendChild(label);
    wrap.appendChild(bracketBox(bronze));
    container.appendChild(wrap);
  }
}

function renderUpdatedAt() {
  const el = document.getElementById('updated-at');
  if (!el) return;
  if (!RESULTS || !RESULTS.updatedAt) {
    el.textContent = '';
    return;
  }
  const when = new Date(RESULTS.updatedAt);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  el.textContent = `Results updated ${fmt.format(when)} ${tzLabel(when)}`;
}

const TABS = {
  matches: { panel: 'schedule', button: 'tab-matches' },
  standings: { panel: 'standings', button: 'tab-standings' },
  bracket: { panel: 'bracket', button: 'tab-bracket' },
};

function showTab(tab) {
  const active = TABS[tab] ? tab : 'matches';
  prefs.tab = active;
  savePrefs();
  for (const [name, { panel, button }] of Object.entries(TABS)) {
    document.getElementById(panel).hidden = name !== active;
    document.getElementById(button).classList.toggle('active', name === active);
  }
}

// ---- Favorites (typeahead) -------------------------------------------------
function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase();
}

function searchTeams(query) {
  const q = normalize(query.trim());
  if (!q) return [];
  const followed = new Set(prefs.favorites);
  const matchesQuery = TEAMS.filter((t) => !followed.has(t.code) && normalize(t.name).includes(q));
  // prefix matches first, then the rest, alphabetically within each bucket.
  matchesQuery.sort((a, b) => {
    const ap = normalize(a.name).startsWith(q) ? 0 : 1;
    const bp = normalize(b.name).startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return matchesQuery.slice(0, 8);
}

function renderSuggestions(query) {
  const box = document.getElementById('suggestions');
  const results = searchTeams(query);
  box.innerHTML = '';
  if (results.length === 0) {
    box.hidden = true;
    return;
  }
  for (const team of results) {
    const li = document.createElement('li');
    li.className = 'suggestion';
    li.setAttribute('role', 'option');
    li.dataset.code = team.code;
    li.textContent = `${team.flag} ${team.name}  ·  Group ${team.group}`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus / fire before blur
      addFavorite(team.code);
    });
    box.appendChild(li);
  }
  box.hidden = false;
}

function addFavorite(code) {
  if (!prefs.favorites.includes(code)) {
    prefs.favorites.push(code);
    savePrefs();
    renderFavorites();
    renderSchedule();
  }
  const input = document.getElementById('team-search');
  input.value = '';
  document.getElementById('suggestions').hidden = true;
  input.focus();
}

function removeFavorite(code) {
  prefs.favorites = prefs.favorites.filter((c) => c !== code);
  savePrefs();
  renderFavorites();
  renderSchedule();
}

function renderFavorites() {
  const list = document.getElementById('favorites');
  list.innerHTML = '';
  for (const code of prefs.favorites) {
    const team = TEAM_BY_CODE.get(code);
    if (!team) continue;
    const li = document.createElement('li');
    li.className = 'chip';
    const label = document.createElement('span');
    label.textContent = `${team.flag} ${team.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.setAttribute('aria-label', `Remove ${team.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => removeFavorite(code));
    li.appendChild(label);
    li.appendChild(remove);
    list.appendChild(li);
  }
}

// ---- Calendar export -------------------------------------------------------
function toICSStamp(date) {
  // YYYYMMDDTHHMMSSZ in UTC
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function isoZ(date) {
  // YYYY-MM-DDTHH:MM:SSZ in UTC (for the Outlook deep link)
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function eventTimes(match) {
  const start = new Date(match.kickoffUtc);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2h (spec D2)
  return { start, end };
}

function googleCalendarUrl(match) {
  const { start, end } = eventTimes(match);
  const text = `🏆 ${matchTitle(match)}`;
  const stage = STAGE_LABELS[match.stage] + (match.group ? ` ${match.group}` : '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text,
    dates: `${toICSStamp(start)}/${toICSStamp(end)}`,
    location: `${match.venue}, ${match.city}`,
    details: `${stage} · FIFA World Cup 2026 (match ${match.matchNumber})`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookCalendarUrl(match) {
  // Microsoft 365 / work Outlook web compose deep link.
  const { start, end } = eventTimes(match);
  const stage = STAGE_LABELS[match.stage] + (match.group ? ` ${match.group}` : '');
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `🏆 ${matchTitle(match)}`,
    startdt: isoZ(start),
    enddt: isoZ(end),
    location: `${match.venue}, ${match.city}`,
    body: `${stage} · FIFA World Cup 2026 (match ${match.matchNumber})`,
  });
  return `https://outlook.office.com/calendar/deeplink/compose?${params.toString()}`;
}

function buildICS(matches) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//worldcup-calendar//EN',
    'CALSCALE:GREGORIAN',
  ];
  const stamp = toICSStamp(new Date());
  for (const match of matches) {
    const { start, end } = eventTimes(match);
    const stage = STAGE_LABELS[match.stage] + (match.group ? ` ${match.group}` : '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:wc2026-${match.matchNumber}@worldcup-calendar`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toICSStamp(start)}`,
      `DTEND:${toICSStamp(end)}`,
      `SUMMARY:${icsEscape('🏆 ' + matchTitle(match))}`,
      `LOCATION:${icsEscape(match.venue + ', ' + match.city)}`,
      `DESCRIPTION:${icsEscape(stage + ' · FIFA World Cup 2026 (match ' + match.matchNumber + ')')}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function icsEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function downloadICSFile(matches, filename) {
  const blob = new Blob([buildICS(matches)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadAllICS() {
  downloadICSFile(visibleMatches(), 'my-world-cup-2026.ics');
}

function downloadMatchICS(match) {
  downloadICSFile([match], `wc2026-match-${match.matchNumber}.ics`);
}

// ---- Timezone picker -------------------------------------------------------
// A short, host-and-Europe-focused list; the viewer's own device zone is added
// on top when it isn't already covered, so anyone gets a sensible default.
const TIMEZONES = [
  ['Europe/Oslo', 'Central Europe — Oslo, Madrid, Berlin'],
  ['Europe/London', 'UK & Portugal — London, Lisbon'],
  ['America/New_York', 'US/Canada East — New York, Toronto'],
  ['America/Chicago', 'US Central — Chicago, Dallas'],
  ['America/Mexico_City', 'Mexico — Mexico City, Monterrey'],
  ['America/Denver', 'US Mountain — Denver'],
  ['America/Los_Angeles', 'US/Canada West — LA, Vancouver, Seattle'],
  ['America/Sao_Paulo', 'Brazil — São Paulo'],
  ['America/Argentina/Buenos_Aires', 'Argentina — Buenos Aires'],
  ['Africa/Johannesburg', 'South Africa — Johannesburg'],
  ['Asia/Tokyo', 'Japan & Korea — Tokyo, Seoul'],
  ['Australia/Sydney', 'Australia East — Sydney'],
  ['UTC', 'UTC'],
];

function populateTimezones() {
  const sel = document.getElementById('timezone-select');
  if (!sel) return;
  sel.innerHTML = '';
  let detected = '';
  try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  const list = [...TIMEZONES];
  if (detected && !list.some(([zone]) => zone === detected)) {
    list.unshift([detected, `My device — ${detected}`]);
  }
  for (const [zone, label] of list) {
    const opt = document.createElement('option');
    opt.value = zone;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = TIME_ZONE;
}

function applyTimeZone(zone) {
  prefs.timeZone = zone || 'Europe/Oslo';
  TIME_ZONE = prefs.timeZone;
  buildFormatters();
  savePrefs();
  document.getElementById('tz-label').textContent = tzLabel();
  renderSchedule();
  renderBracket();
  renderUpdatedAt();
}

// ---- Offline / installable (PWA) -------------------------------------------
// Register the service worker only over http(s) — it can't run on file:// and
// isn't needed there. Failures are non-fatal: the page works without it.
function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof location === 'undefined' || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

// ---- Wiring ----------------------------------------------------------------
function init() {
  document.getElementById('tz-label').textContent = tzLabel();

  populateTimezones();
  const tzSelect = document.getElementById('timezone-select');
  tzSelect.addEventListener('change', () => applyTimeZone(tzSelect.value));

  const search = document.getElementById('team-search');
  search.addEventListener('input', () => renderSuggestions(search.value));
  search.addEventListener('focus', () => {
    if (search.value) renderSuggestions(search.value);
  });
  search.addEventListener('blur', () => {
    setTimeout(() => (document.getElementById('suggestions').hidden = true), 120);
  });

  const filterInputs = {
    myTeams: 'filter-myteams',
    goodHours: 'filter-goodhours',
    keyKnockouts: 'filter-knockouts',
    weekendRescue: 'filter-weekend',
  };
  for (const [key, id] of Object.entries(filterInputs)) {
    const input = document.getElementById(id);
    input.checked = !!prefs.filters[key];
    input.addEventListener('change', () => {
      prefs.filters[key] = input.checked;
      savePrefs();
      renderSchedule();
    });
  }

  const prefsPanel = document.getElementById('prefs');
  prefsPanel.open = !!prefs.prefsOpen;
  prefsPanel.addEventListener('toggle', () => {
    prefs.prefsOpen = prefsPanel.open;
    savePrefs();
  });

  const hideOld = document.getElementById('filter-hideold');
  hideOld.checked = !!prefs.hideOld;
  hideOld.addEventListener('change', () => {
    prefs.hideOld = hideOld.checked;
    savePrefs();
    renderSchedule();
  });

  const sleepStart = document.getElementById('sleep-start');
  const sleepEnd = document.getElementById('sleep-end');
  sleepStart.value = prefs.sleepStart;
  sleepEnd.value = prefs.sleepEnd;
  sleepStart.addEventListener('change', () => {
    prefs.sleepStart = sleepStart.value || '00:00';
    savePrefs();
    renderSchedule();
  });
  sleepEnd.addEventListener('change', () => {
    prefs.sleepEnd = sleepEnd.value || '07:00';
    savePrefs();
    renderSchedule();
  });

  document.getElementById('export-ics').addEventListener('click', downloadAllICS);

  document.getElementById('tab-matches').addEventListener('click', () => showTab('matches'));
  document.getElementById('tab-standings').addEventListener('click', () => showTab('standings'));
  document.getElementById('tab-bracket').addEventListener('click', () => showTab('bracket'));

  renderFavorites();
  renderSchedule();
  renderStandings();
  renderBracket();
  renderUpdatedAt();
  showTab(prefs.tab);

  // Re-render once a minute so the LIVE badge appears/clears as kickoffs pass
  // and matches end — the only moving part on this otherwise static page.
  setInterval(() => {
    renderSchedule();
    renderBracket();
  }, 60 * 1000);

  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
