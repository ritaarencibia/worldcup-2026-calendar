#!/usr/bin/env python3
"""Fetch live World Cup 2026 results + group standings from Wikipedia and write
data/results.js (and results.json).

Source: Wikipedia REST HTML API for the 12 per-group articles
(`2026 FIFA World Cup Group A` … `Group L`). Parsing is deterministic
(BeautifulSoup over rendered HTML) — no LLM in the pipeline.

Defensive by design: if any group fails to parse a valid 4-team standings table,
the run aborts WITHOUT overwriting the existing data/results.js, so the site keeps
serving the last good snapshot instead of going blank.

Knockout resolution is best-effort: it reads the knockout-stage article and emits
`resolved` (knockout matchNumber -> real team codes) for any match whose slots are
already filled, plus knockout scores. Until the group stage ends (25 Jun 2026)
those slots are placeholders, so `resolved` stays empty. Knockout parsing failures
never abort the results/standings update.
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

SCORE_RE = re.compile(r"(\d+)\s*[–\-−]\s*(\d+)")
KNOCKOUT_TITLE = "2026_FIFA_World_Cup_knockout_stage"


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
    m = SCORE_RE.search(text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def parse_slot(text):
    """Map a knockout slot label to our placeholder token.

    'Winner Group E'        -> '1E'
    'Runner-up Group F'     -> '2F'
    '3rd Group A/B/C/D/F'   -> '3ABCDF'   (letters sorted, matching matches.json)
    'Winner Match 73'       -> 'W73'
    'Loser Match 101'       -> 'L101'
    """
    t = re.sub(r"\s+", " ", (text or "").replace("_", " ")).strip().lower()
    m = re.match(r"winner match (\d+)", t)
    if m:
        return "W" + m.group(1)
    m = re.match(r"loser match (\d+)", t)
    if m:
        return "L" + m.group(1)
    m = re.match(r"winner group ([a-l])", t)
    if m:
        return "1" + m.group(1).upper()
    m = re.match(r"runners?-?up group ([a-l])", t)
    if m:
        return "2" + m.group(1).upper()
    if "3rd" in t or "third" in t:
        tail = t.split("group", 1)[-1]
        letters = re.findall(r"[a-l]", tail)
        if letters:
            return "3" + "".join(sorted(c.upper() for c in letters))
    return None


def cell_team_name(cell):
    """Prefer the linked country name; fall back to cleaned cell text."""
    a = cell.find("a")
    if a and a.get_text(strip=True):
        return a.get_text(strip=True)
    return cell.get_text(" ", strip=True)


def code_slots_from_standings(standings):
    """Map each team code to its group-slot token from the final standings:
    1st -> '1A', 2nd -> '2A', 3rd -> '3A'. Only positions 1-3 matter for the
    knockout placeholders. Groups that haven't finished simply contribute
    nothing, so their slots stay unresolved."""
    out = {}
    for letter, rows in standings.items():
        for row in rows:
            if row["pos"] in (1, 2, 3):
                out[row["code"]] = f"{row['pos']}{letter}"
    return out


def third_tokens_by_letter(ko_index):
    """Map a single group letter to the multi-group 3rd-place tokens that a
    fixture actually uses, e.g. 'A' -> {'3ABCDF', '3AEHIJ', '3CEFHI'...}. A
    third-placed team carries a single-group token ('3A'); this lets us widen it
    to the '3ABCDF'-style token its fixture is keyed by."""
    out = {}
    for pair in ko_index:
        for tok in pair:
            if tok.startswith("3") and len(tok) > 2:
                for ch in tok[1:]:
                    out.setdefault(ch, set()).add(tok)
    return out


def match_for_teams(hc, ac, ko_index, code_slot, third_by_letter):
    """Match number for a knockout box showing two REAL teams, derived purely
    from their group finishing positions. This is robust to Wikipedia swapping
    the slot labels ('Runner-up Group A') and the 'Match NN' text for the team
    names the instant a match kicks off — which used to drop a played match back
    to its placeholder (e.g. 73 -> '2A v 2B'). Returns None when a side isn't a
    group 1st/2nd/3rd (both sides are knockout winners) or the pair is no
    fixture."""
    sh, sa = code_slot.get(hc), code_slot.get(ac)
    if not (sh and sa):
        return None
    # 1st/2nd tokens are used verbatim; widen a single-group 3rd token to the
    # multi-group token a fixture is actually keyed by.
    cand_h = {sh} | (third_by_letter.get(sh[1], set()) if sh[0] == "3" else set())
    cand_a = {sa} | (third_by_letter.get(sa[1], set()) if sa[0] == "3" else set())
    for x in cand_h:
        for y in cand_a:
            num = ko_index.get(frozenset((x, y)))
            if num:
                return num
    return None


def winner_code(num, resolved, results):
    """Real code of the team that won knockout match `num`, or None if it isn't
    decided yet. Reads the resolved teams plus the scored result, so it works for
    extra time / penalties only when the recorded score already separates them."""
    rc = resolved.get(str(num))
    r = results.get(str(num))
    if rc and r and r.get("status") == "finished" and r["home"] != r["away"]:
        return rc["home"] if r["home"] > r["away"] else rc["away"]
    return None


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

    # --- Knockout stage: resolved matchups + scores ----------------------------
    # Resolution is deterministic wherever possible — group slots come from the
    # standings, winners propagate from earlier rounds — and the scraped bracket
    # is consulted only for what determinism can't give us: the 3rd-place teams'
    # identities and the actual scores. Crucially, a box is matched to its fixture
    # by the TEAMS it shows, never by the "Match NN" label or slot heading id:
    # Wikipedia drops both the moment a match kicks off, which previously made a
    # just-played match vanish back to its placeholder (e.g. 73 -> "2A v 2B").
    resolved = {}
    ko_index = {
        frozenset((m["home"], m["away"])): m["matchNumber"]
        for m in matches if m["stage"] != "group"
    }
    ko_matches = {m["matchNumber"]: m for m in matches if m["stage"] != "group"}
    code_slot = code_slots_from_standings(standings)
    slot_code = {slot: code for code, slot in code_slot.items()}
    third_by_letter = third_tokens_by_letter(ko_index)

    # Scrape the bracket only for the 3rd-place teams and the scores. Keyed by the
    # pair of real teams a box shows, so nothing depends on the fragile heading.
    box_score = {}   # frozenset(home, away code) -> (home_goals, away_goals)
    box_teams = []   # [(home_code, away_code)] for every box with two real teams
    try:
        time.sleep(1.0)
        ko_soup = BeautifulSoup(fetch_html(KNOCKOUT_TITLE), "html.parser")
        boxes = ko_soup.select(".footballbox")
        for fb in boxes:
            home_el = fb.find(class_="fhome")
            away_el = fb.find(class_="faway")
            hc = name_to_code.get(normalize(cell_team_name(home_el))) if home_el else None
            ac = name_to_code.get(normalize(cell_team_name(away_el))) if away_el else None
            if not (hc and ac):
                continue  # still a placeholder box ("Runners-up Group A") -> skip
            box_teams.append((hc, ac))
            score_el = fb.find(class_="fscore")
            goals = parse_score(score_el.get_text(" ", strip=True)) if score_el else None
            if goals:
                box_score[frozenset((hc, ac))] = goals
        print(f"Knockout: {len(boxes)} boxes, {len(box_teams)} with real teams, "
              f"{len(box_score)} scored")
    except Exception as exc:
        warnings.append(f"knockout fetch/parse failed: {exc} (bracket left to standings)")

    # Seed the 3rd-place fixtures (and any group fixture) straight from the boxes:
    # match_for_teams reads both teams off the box, so the 3rd-place side it can't
    # be computed from standings is captured here.
    for hc, ac in box_teams:
        num = match_for_teams(hc, ac, ko_index, code_slot, third_by_letter)
        if num:
            resolved[str(num)] = {"home": hc, "away": ac}

    def resolve_label(label):
        """Real code for a placeholder slot, or None if not decided yet."""
        m = re.fullmatch(r"W(\d+)", label or "")
        if m:
            return winner_code(int(m.group(1)), resolved, results)
        return slot_code.get(label)  # '1A'/'2B' -> code; '3ABCDF'-style -> None

    # Fill every computable fixture and propagate winners to a fixpoint: group
    # slots from the standings, "W{n}" slots from the winner of match n. Scores
    # are attached by the team pair, so a match resolved here still gets its
    # result, and a fresh result can unlock the next round on the following pass.
    changed = True
    while changed:
        changed = False
        for num, m in ko_matches.items():
            key = str(num)
            if key not in resolved:
                hc = resolve_label(m["home"])
                ac = resolve_label(m["away"])
                if hc and ac:
                    resolved[key] = {"home": hc, "away": ac}
                    changed = True
            rc = resolved.get(key)
            if rc and key not in results:
                goals = box_score.get(frozenset((rc["home"], rc["away"])))
                if goals:
                    results[key] = {"status": "finished",
                                    "home": goals[0], "away": goals[1]}
                    changed = True

    for w in warnings:
        print(f"WARN  {w}", file=sys.stderr)

    if errors:
        for e in errors:
            print(f"ERROR {e}", file=sys.stderr)
        print("Aborting without overwriting data/results.js (keeping last good).",
              file=sys.stderr)
        sys.exit(1)

    content = {
        "results": results,
        "standings": standings,
        "resolved": resolved,  # knockout matchNumber -> real team codes (fills from 25 Jun)
    }

    finished = len(results)
    print(f"Parsed {finished} finished match(es), {len(standings)} group tables.")
    for num in sorted(results, key=int)[:6]:
        m = next(mm for mm in matches if str(mm["matchNumber"]) == num)
        r = results[num]
        print(f"   #{num}: {m['homeLabel']} {r['home']}-{r['away']} {m['awayLabel']}")

    # Only rewrite when the real data changed, so the timestamp alone never
    # triggers a commit/redeploy. updatedAt = "last time results changed".
    json_path = os.path.join(DATA_DIR, "results.json")
    if os.path.exists(json_path):
        try:
            old = json.load(open(json_path, encoding="utf-8"))
            old_content = {k: old.get(k, {}) for k in ("results", "standings", "resolved")}
            if old_content == content:
                print("No content change; data files left untouched.")
                return
        except Exception:
            pass  # unreadable/old format -> fall through and rewrite

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        **content,
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(body + "\n")
    with open(os.path.join(DATA_DIR, "results.js"), "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/fetch_results.py - do not edit by hand.\n")
        f.write(f"window.RESULTS = {body};\n")
    print(f"Wrote data/results.* (updatedAt {payload['updatedAt']}).")


if __name__ == "__main__":
    main()
