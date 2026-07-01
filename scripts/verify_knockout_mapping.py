#!/usr/bin/env python3
"""Offline check: the knockout slot-heading parser maps each of the 32 boxes to
the correct match number. Pairs (slot id -> match number) were observed from the
live knockout-stage article on 2026-06-12; this validates parse_slot + the
matches.json index without needing the network.

Also guards the regression where a PLAYED knockout box drops its slot labels and
'Match NN' text for team names: match_for_teams must still map the box to its
fixture from the teams' group positions alone."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_results import (  # noqa: E402
    parse_slot, code_slots_from_standings, third_tokens_by_letter, match_for_teams,
    propagate_knockout, seed_from_boxes,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data", "matches.json"), encoding="utf-8") as f:
    matches = json.load(f)

ko_index = {
    frozenset((m["home"], m["away"])): m["matchNumber"]
    for m in matches if m["stage"] != "group"
}

# slot heading id -> expected match number (from the live article)
OBSERVED = {
    "Runner-up_Group_A_v_Runner-up_Group_B": 73,
    "Winner_Group_C_v_Runner-up_Group_F": 76,
    "Winner_Group_E_v_3rd_Group_A/B/C/D/F": 74,
    "Winner_Group_F_v_Runner-up_Group_C": 75,
    "Runner-up_Group_E_v_Runner-up_Group_I": 78,
    "Winner_Group_I_v_3rd_Group_C/D/F/G/H": 77,
    "Winner_Group_A_v_3rd_Group_C/E/F/H/I": 79,
    "Winner_Group_L_v_3rd_Group_E/H/I/J/K": 80,
    "Winner_Group_G_v_3rd_Group_A/E/H/I/J": 82,
    "Winner_Group_D_v_3rd_Group_B/E/F/I/J": 81,
    "Winner_Group_H_v_Runner-up_Group_J": 84,
    "Runner-up_Group_K_v_Runner-up_Group_L": 83,
    "Winner_Group_B_v_3rd_Group_E/F/G/I/J": 85,
    "Runner-up_Group_D_v_Runner-up_Group_G": 88,
    "Winner_Group_J_v_Runner-up_Group_H": 86,
    "Winner_Group_K_v_3rd_Group_D/E/I/J/L": 87,
    "Winner_Match_73_v_Winner_Match_75": 90,
    "Winner_Match_74_v_Winner_Match_77": 89,
    "Winner_Match_76_v_Winner_Match_78": 91,
    "Winner_Match_79_v_Winner_Match_80": 92,
    "Winner_Match_83_v_Winner_Match_84": 93,
    "Winner_Match_81_v_Winner_Match_82": 94,
    "Winner_Match_86_v_Winner_Match_88": 95,
    "Winner_Match_85_v_Winner_Match_87": 96,
    "Winner_Match_89_v_Winner_Match_90": 97,
    "Winner_Match_93_v_Winner_Match_94": 98,
    "Winner_Match_91_v_Winner_Match_92": 99,
    "Winner_Match_95_v_Winner_Match_96": 100,
    "Winner_Match_97_v_Winner_Match_98": 101,
    "Winner_Match_99_v_Winner_Match_100": 102,
    "Loser_Match_101_v_Loser_Match_102": 103,
    "Winner_Match_101_v_Winner_Match_102": 104,
}

ok = True
for ident, expected in OBSERVED.items():
    left, _, right = ident.partition("_v_")
    s1, s2 = parse_slot(left), parse_slot(right)
    got = ko_index.get(frozenset((s1, s2))) if s1 and s2 else None
    if got != expected:
        ok = False
        print(f"FAIL  {ident}: slots=({s1},{s2}) -> {got}, expected {expected}")

print(f"checked {len(OBSERVED)} knockout boxes")
print("OK: every knockout slot heading maps to the right match number" if ok else "MISMATCHES FOUND")

# --- Played-box regression guard --------------------------------------------
# Once a knockout match kicks off, Wikipedia replaces both the slot heading id
# and the 'Match NN' text with the team names. match_for_teams must still find
# the fixture from the teams' group finishing positions. Standings below place
# each code at a known position; (home, away) -> expected match number.
STANDINGS = {
    "A": [{"code": "MEX", "pos": 1}, {"code": "RSA", "pos": 2}, {"code": "KOR", "pos": 3}, {"code": "CZE", "pos": 4}],
    "B": [{"code": "SUI", "pos": 1}, {"code": "CAN", "pos": 2}, {"code": "BIH", "pos": 3}, {"code": "QAT", "pos": 4}],
    "C": [{"code": "NED", "pos": 1}, {"code": "SCO", "pos": 2}, {"code": "EGY", "pos": 3}, {"code": "GHA", "pos": 4}],
    "E": [{"code": "GER", "pos": 1}, {"code": "POL", "pos": 2}, {"code": "JPN", "pos": 3}, {"code": "VEN", "pos": 4}],
    "F": [{"code": "ESP", "pos": 1}, {"code": "URY", "pos": 2}, {"code": "TUN", "pos": 3}, {"code": "NZL", "pos": 4}],
}
code_slot = code_slots_from_standings(STANDINGS)
third_by_letter = third_tokens_by_letter(ko_index)

# (home_code, away_code) -> expected match number, for a played (label-less) box.
PLAYED = {
    ("RSA", "CAN"): 73,   # 2A v 2B  -> two runners-up
    ("CAN", "RSA"): 73,   # order-independent
    ("NED", "URY"): 76,   # 1C v 2F
    ("ESP", "SCO"): 75,   # 1F v 2C
    ("GER", "EGY"): 74,   # 1E v 3rd-of-C (EGY is 3C, fixture token is '3ABCDF')
}
for (hc, ac), expected in PLAYED.items():
    got = match_for_teams(hc, ac, ko_index, code_slot, third_by_letter)
    if got != expected:
        ok = False
        print(f"FAIL  played box {hc} v {ac} -> {got}, expected {expected}")
print(f"checked {len(PLAYED)} played (label-less) boxes")

print("OK: played knockout boxes resolve from team positions" if ok else "MISMATCHES FOUND")

# --- Partial-resolution propagation -----------------------------------------
# When a knockout match is won, its winner must fill the matching "W{n}" slot in
# the next round's box right away, even while that box's OTHER feeder is still
# undecided. Match 90 = W73 v W75; match 73 = 2A v 2B; match 75 = 1F v 2C.
ko_matches = {m["matchNumber"]: m for m in matches if m["stage"] != "group"}

# Round of 32 match 73 is finished (home wins); 75 not yet played.
resolved = {"73": {"home": "RSA", "away": "CAN"}}
results = {"73": {"status": "finished", "home": 2, "away": 1}}
propagate_knockout(ko_matches, {}, resolved, results, {})

box90 = resolved.get("90", {})
check = lambda name, cond: (print(f"{'OK ' if cond else 'FAIL'}  {name}"), cond)[1]
ok = check("winner of 73 (RSA) fills its side of box 90", box90.get("home") == "RSA") and ok
ok = check("box 90 other side stays unresolved (W75 undecided)", "away" not in box90) and ok
ok = check("box 90 has no score while half-resolved", "90" not in results) and ok

# Now 75 finishes too (1F wins): box 90 must become fully resolved.
resolved["75"] = {"home": "ESP", "away": "SCO"}
results["75"] = {"status": "finished", "home": 3, "away": 0}
propagate_knockout(ko_matches, {}, resolved, results, {})
box90 = resolved.get("90", {})
ok = check("box 90 fully resolved once both feeders decided",
           box90.get("home") == "RSA" and box90.get("away") == "ESP") and ok
print(f"checked partial-resolution propagation for box 90")

# --- Penalty-shootout winners advance --------------------------------------
# A drawn knockout (here match 78 = 2E v 2I, NED 1-1 MAR) is decided on
# penalties; the shootout winner must still advance. Match 91 = W76 v W78, so
# the winner of 78 fills box 91's W78 (away) side.
resolved = {"78": {"home": "NED", "away": "MAR"}}
results = {}
box_score = {frozenset(("NED", "MAR")): (1, 1)}
box_pen_winner = {frozenset(("NED", "MAR")): "MAR"}
propagate_knockout(ko_matches, {}, resolved, results, box_score, box_pen_winner)

r78 = results.get("78", {})
ok = check("drawn match 78 recorded as finished 1-1", r78.get("home") == 1 and r78.get("away") == 1) and ok
ok = check("match 78 carries penWinner MAR", r78.get("penWinner") == "MAR") and ok
ok = check("penalty winner MAR advances into box 91 (W78 side)",
           resolved.get("91", {}).get("away") == "MAR") and ok
print("checked penalty-shootout propagation for box 78 -> 91")

print("OK: knockout resolution propagates partial + penalty winners" if ok else "MISMATCHES FOUND")

# --- Later-round box must not clobber an R32 pairing ------------------------
# A group winner meeting a 3rd-placed team in the Round of 16 has the same group-
# position signature as an R32 3rd-place fixture, because the R32 token is multi-
# group. Real 2026 case: R32 match 77 = 1I(France) v 3CDFGH(Sweden, 3F); in the
# R16 the winner of 77 (France) meets Paraguay (3D), whose letter D ALSO sits in
# the 3CDFGH token. Both boxes resolve to 77 by position, so the later R16 box
# would overwrite France v Sweden with France v Paraguay (and strand the 3-0
# score) unless seeding skips a team already placed in its R32 slot.
CLOBBER_STANDINGS = {
    "D": [{"code": "USA", "pos": 1}, {"code": "AUS", "pos": 2}, {"code": "PAR", "pos": 3}],
    "E": [{"code": "GER", "pos": 1}, {"code": "POL", "pos": 2}, {"code": "JPN", "pos": 3}],
    "F": [{"code": "NED", "pos": 1}, {"code": "JPN", "pos": 2}, {"code": "SWE", "pos": 3}],
    "I": [{"code": "FRA", "pos": 1}, {"code": "NOR", "pos": 2}, {"code": "SEN", "pos": 3}],
}
cs = code_slots_from_standings(CLOBBER_STANDINGS)
tbl = third_tokens_by_letter(ko_index)
# Document order: Round of 32 boxes first, then the Round of 16 box.
box_teams = [
    ("GER", "PAR"),   # R32 match 74 = 1E v 3ABCDF (Germany v Paraguay)
    ("FRA", "SWE"),   # R32 match 77 = 1I v 3CDFGH (France v Sweden)
    ("PAR", "FRA"),   # R16 match 89 = W74 v W77 — must NOT be seeded as 77
]
seeded = seed_from_boxes(box_teams, ko_index, cs, tbl)
ok = check("R32 match 77 keeps France v Sweden",
           seeded.get("77") == {"home": "FRA", "away": "SWE"}) and ok
ok = check("R32 match 74 keeps Germany v Paraguay",
           seeded.get("74") == {"home": "GER", "away": "PAR"}) and ok
ok = check("R16 France v Paraguay box did not clobber match 77",
           "PAR" not in seeded.get("77", {}).values()) and ok
print("checked later-round box does not clobber an R32 pairing")

sys.exit(0 if ok else 1)
