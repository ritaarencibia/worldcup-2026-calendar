/* My World Cup 2026 Calendar — all logic runs in the browser, no backend.
 * Filtering rules mirror spec_v1.md §5. */
'use strict';

// User timezone. CEST in summer == Europe/Oslo (Central European, DST-aware).
const TIME_ZONE = 'Europe/Oslo';

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

const STORAGE_KEY = 'wc2026.prefs.v1';

const TEAMS = window.TEAMS || [];
const MATCHES = window.MATCHES || [];
const TEAM_BY_CODE = new Map(TEAMS.map((t) => [t.code, t]));

// Live data (results + standings + bracket). Optional: if data/results.js is
// missing or failed to load, the page degrades to the plain schedule.
const RESULTS = window.RESULTS || null;
const RESULT_BY_NUMBER = (RESULTS && RESULTS.results) || {};
const STANDINGS = (RESULTS && RESULTS.standings) || {};
const RESOLVED = (RESULTS && RESULTS.resolved) || {};

function resultFor(match) {
  return RESULT_BY_NUMBER[String(match.matchNumber)] || null;
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
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dayHeaderFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

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
  if (match.stage !== 'group') return false; // knockout teams are still TBD
  const favorites = new Set(prefs.favorites);
  return favorites.has(match.home) || favorites.has(match.away);
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
  const visible = MATCHES.filter(isIncluded);

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
    const li = document.createElement('li');
    li.className = 'match' + (finished ? ' match--finished' : '');

    const time = document.createElement('span');
    time.className = 'match-time';
    time.textContent = finished ? 'FT' : lp.time;

    const info = document.createElement('div');
    info.className = 'match-info';
    const title = document.createElement('span');
    title.className = 'match-title';
    title.textContent = matchTitle(match);
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
  el.textContent = `Results updated ${fmt.format(when)} CEST`;
}

function showTab(tab) {
  prefs.tab = tab;
  savePrefs();
  const isMatches = tab !== 'standings';
  document.getElementById('schedule').hidden = !isMatches;
  document.getElementById('standings').hidden = isMatches;
  document.getElementById('tab-matches').classList.toggle('active', isMatches);
  document.getElementById('tab-standings').classList.toggle('active', !isMatches);
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

function downloadICS() {
  const kept = MATCHES.filter(isIncluded);
  const ics = buildICS(kept);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-world-cup-2026.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Wiring ----------------------------------------------------------------
function init() {
  document.getElementById('tz-label').textContent = 'CEST';

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

  document.getElementById('export-ics').addEventListener('click', downloadICS);

  document.getElementById('tab-matches').addEventListener('click', () => showTab('matches'));
  document.getElementById('tab-standings').addEventListener('click', () => showTab('standings'));

  renderFavorites();
  renderSchedule();
  renderStandings();
  renderUpdatedAt();
  showTab(prefs.tab);
}

document.addEventListener('DOMContentLoaded', init);
