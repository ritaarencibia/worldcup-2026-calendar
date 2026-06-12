#!/usr/bin/env python3
"""Offline check: the knockout slot-heading parser maps each of the 32 boxes to
the correct match number. Pairs (slot id -> match number) were observed from the
live knockout-stage article on 2026-06-12; this validates parse_slot + the
matches.json index without needing the network."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_results import parse_slot  # noqa: E402

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
sys.exit(0 if ok else 1)
