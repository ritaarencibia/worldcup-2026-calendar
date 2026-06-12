#!/usr/bin/env python3
"""Quick preview of the §5 inclusion rules against the generated data.

Mirrors the spec pseudocode so we can sanity-check how many matches survive.
CEST = UTC + 2 for the whole tournament.
"""
import json
import os
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIG = {"GER", "BRA", "ARG", "ENG", "FRA", "ESP", "POR"}
UTC_TO_CEST = timedelta(hours=2)


def cest(m):
    dt = datetime.strptime(m["kickoffUtc"], "%Y-%m-%dT%H:%M:%SZ")
    return dt + UTC_TO_CEST


def included(m, favorites):
    c = cest(m)
    asleep = 0 <= c.hour < 7
    stage = m["stage"]
    if stage in ("qf", "sf", "bronze", "final"):
        return True
    if stage in ("r32", "r16"):
        return not asleep
    # group stage
    if not asleep:
        return True
    if {m["home"], m["away"]} & favorites:
        return True
    weekend = c.weekday() in (5, 6)  # Sat, Sun
    if weekend and ({m["home"], m["away"]} & BIG):
        return True
    return False


def main():
    with open(os.path.join(ROOT, "data", "matches.json"), encoding="utf-8") as f:
        matches = json.load(f)

    favorites = set()  # empty: worst case
    kept = [m for m in matches if included(m, favorites)]
    print(f"With NO favorites: {len(kept)}/{len(matches)} matches kept")

    group = [m for m in matches if m["stage"] == "group"]
    group_kept = [m for m in group if included(m, favorites)]
    print(f"  Group stage: {len(group_kept)}/{len(group)} kept")

    # How many group matches start in the sleep window at all
    asleep = [m for m in group if 0 <= cest(m).hour < 7]
    print(f"  Group matches starting 00:00-07:00 CEST: {len(asleep)}")

    print("\nSample of dropped group matches (no favorites):")
    for m in group:
        if not included(m, favorites):
            c = cest(m)
            print(f"  #{m['matchNumber']:>3} {m['homeLabel']:>14} v {m['awayLabel']:<14} "
                  f"{c.strftime('%a %d %b %H:%M')} CEST")

    # Example: add Spain as favorite
    favorites = {"ESP"}
    kept2 = [m for m in matches if included(m, favorites)]
    print(f"\nWith favorite ESP: {len(kept2)}/{len(matches)} matches kept "
          f"(+{len(kept2) - len(kept)})")


if __name__ == "__main__":
    main()
