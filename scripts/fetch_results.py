#!/usr/bin/env python3
"""Fetch live World Cup 2026 results + group standings from Wikipedia and write
data/results.js (and results.json).

Source: Wikipedia REST HTML API for the 12 per-group articles
(`2026 FIFA World Cup Group A` … `Group L`). Parsing is deterministic
(BeautifulSoup over rendered HTML) — no LLM in the pipeline.

Defensive by design: if any group fails to parse a valid 4-team standings table,
the run aborts WITHOUT overwriting the existing data/results.js, so the site keeps
serving the last good snapshot instead of going blank.

Knockout bracket resolution is intentionally NOT done here yet: until the group
stage ends (25 Jun 2026) the knockout article only has placeholders, so there is
nothing real to parse or test. `bracket` is emitted as {} for now.
"""
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
GROUPS = list("ABCDEFGHIJKL")

REST_URL = "https://en.wikipedia.org/w/rest.php/v1/page/{title}/html"
HEADERS = {
    "User-Agent": "worldcup-calendar/0.1 (personal project; contact via repo issues)"
}

# Wikipedia names that differ from our teams.json names -> our team code.
NAME_ALIASES = {
    "south korea": "KOR",
    "czech republic": "CZE",
    "ivory coast": "CIV",
    "cote d'ivoire": "CIV",
    "cape verde": "CPV",
    "dr congo": "COD",
    "democratic republic of the congo": "COD",
    "iran": "IRN",
    "turkey": "TUR",
    "turkiye": "TUR",
    "united states": "USA",
}

SCORE_RE = re.compile(r"^\s*(\d+)\s*[–\-−]\s*(\d+)\s*$")


def normalize(name):
    """Lowercase, strip accents, drop non-alphanumerics except apostrophes/spaces."""
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.lower().strip()
    n = re.sub(r"\(h\)", "", n)          # host marker
    n = re.sub(r"\[[^\]]*\]", "", n)     # footnote refs like [a]
    n = re.sub(r"[^a-z0-9' ]", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def build_name_to_code(teams):
    table = {}
    for t in teams:
        table[normalize(t["name"])] = t["code"]
    table.update(NAME_ALIASES)
    return table


def resolve_team(name, name_to_code, warnings):
    code = name_to_code.get(normalize(name))
    if code is None:
        warnings.append(f"unknown team name from Wikipedia: {name!r}")
    return code


def fetch_html(title, max_retries=4):
    """GET with polite backoff. Retries on 429 / 5xx, honouring Retry-After."""
    url = REST_URL.format(title=title)
    delay = 2.0
    for attempt in range(max_retries):
        resp = requests.get(url, headers=HEADERS, timeout=30)
        if resp.status_code == 200:
            return resp.text
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
            wait = float(resp.headers.get("Retry-After", delay))
            print(f"INFO  {title}: HTTP {resp.status_code}, retrying in {wait:.0f}s",
                  file=sys.stderr)
            time.sleep(wait)
            delay *= 2
            continue
        resp.raise_for_status()
    raise RuntimeError(f"giving up on {title} after {max_retries} attempts")


def parse_score(text):
    m = SCORE_RE.match(text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def cell_team_name(cell):
    """Prefer the linked country name; fall back to cleaned cell text."""
    a = cell.find("a")
    if a and a.get_text(strip=True):
        return a.get_text(strip=True)
    return cell.get_text(" ", strip=True)


def parse_standings(soup):
    """Return list of standing dicts for the group, or None if not found."""
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header = [th.get_text(strip=True) for th in rows[0].find_all(["th", "td"])]
        if "Pld" not in header or "Pts" not in header:
            continue
        idx = {key: header.index(key) for key in ("Pld", "W", "D", "L", "GF", "GA", "Pts")}
        out = []
        for r in rows[1:]:
            cells = r.find_all(["th", "td"])
            if len(cells) <= idx["Pts"]:
                continue
            def num(key):
                return int(re.sub(r"[^0-9]", "", cells[idx[key]].get_text()) or "0")
            out.append({
                "team_name": cell_team_name(cells[1]),
                "pld": num("Pld"), "w": num("W"), "d": num("D"), "l": num("L"),
                "gf": num("GF"), "ga": num("GA"), "pts": num("Pts"),
            })
        return out
    return None


def parse_matches(soup):
    """Return list of (home_name, away_name, home_goals, away_goals) for played matches."""
    played = []
    for fb in soup.select(".footballbox"):
        home = fb.find(class_="fhome")
        away = fb.find(class_="faway")
        score = fb.find(class_="fscore")
        if not (home and away and score):
            continue
        goals = parse_score(score.get_text(" ", strip=True))
        if goals is None:
            continue  # scheduled / not played yet
        played.append((
            cell_team_name(home), cell_team_name(away), goals[0], goals[1],
        ))
    return played


def main():
    with open(os.path.join(DATA_DIR, "teams.json"), encoding="utf-8") as f:
        teams = json.load(f)
    with open(os.path.join(DATA_DIR, "matches.json"), encoding="utf-8") as f:
        matches = json.load(f)

    name_to_code = build_name_to_code(teams)
    code_to_team = {t["code"]: t for t in teams}

    # index group-stage matches by (group, frozenset of the two codes)
    match_index = {}
    for m in matches:
        if m["stage"] == "group":
            match_index[(m["group"], frozenset((m["home"], m["away"])))] = m

    warnings = []
    errors = []
    results = {}
    standings = {}

    for i, letter in enumerate(GROUPS):
        if i:
            time.sleep(1.0)  # be polite: ~1 req/sec
        title = f"2026_FIFA_World_Cup_Group_{letter}"
        try:
            soup = BeautifulSoup(fetch_html(title), "html.parser")
        except Exception as exc:  # network / HTTP
            errors.append(f"Group {letter}: fetch failed: {exc}")
            continue

        table = parse_standings(soup)
        if not table or len(table) != 4:
            errors.append(f"Group {letter}: expected 4 standings rows, got "
                          f"{0 if not table else len(table)}")
            continue

        rows_out = []
        for pos, row in enumerate(table, start=1):
            code = resolve_team(row["team_name"], name_to_code, warnings)
            if code is None:
                errors.append(f"Group {letter}: unresolved team {row['team_name']!r}")
                continue
            rows_out.append({
                "code": code, "pos": pos,
                "pld": row["pld"], "w": row["w"], "d": row["d"], "l": row["l"],
                "gf": row["gf"], "ga": row["ga"], "gd": row["gf"] - row["ga"],
                "pts": row["pts"],
            })
        standings[letter] = rows_out

        for home_name, away_name, hg, ag in parse_matches(soup):
            hc = resolve_team(home_name, name_to_code, warnings)
            ac = resolve_team(away_name, name_to_code, warnings)
            if hc is None or ac is None:
                continue
            m = match_index.get((letter, frozenset((hc, ac))))
            if not m:
                warnings.append(f"Group {letter}: no fixture for {hc} vs {ac}")
                continue
            # orient goals to OUR home/away
            if m["home"] == hc:
                home_goals, away_goals = hg, ag
            else:
                home_goals, away_goals = ag, hg
            results[str(m["matchNumber"])] = {
                "status": "finished", "home": home_goals, "away": away_goals,
            }

    for w in warnings:
        print(f"WARN  {w}", file=sys.stderr)

    if errors:
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
        print("Aborting without overwriting data/results.js (keeping last good).",
              file=sys.stderr)
        sys.exit(1)

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "results": results,
        "standings": standings,
        "bracket": {},  # filled once the group stage ends (see module docstring)
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(os.path.join(DATA_DIR, "results.json"), "w", encoding="utf-8") as f:
        f.write(body + "\n")
    with open(os.path.join(DATA_DIR, "results.js"), "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/fetch_results.py - do not edit by hand.\n")
        f.write(f"window.RESULTS = {body};\n")

    finished = len(results)
    print(f"OK: {finished} finished match(es), {len(standings)} group tables, "
          f"updatedAt {payload['updatedAt']}")
    # tiny visible summary
    for num in sorted(results, key=int)[:6]:
        m = next(mm for mm in matches if str(mm["matchNumber"]) == num)
        r = results[num]
        print(f"   #{num}: {m['homeLabel']} {r['home']}-{r['away']} {m['awayLabel']}")


if __name__ == "__main__":
    main()
