#!/usr/bin/env python3
"""Generate data/matches.json and data/teams.json for the World Cup 2026 calendar.

Source: the two official PDFs in the repo root. Kick-off times in the PDFs are in
US Eastern Time (ET). The whole tournament (11 Jun - 19 Jul 2026) is on US summer
time (EDT = UTC-4), so UTC = ET + 4h. Conversion to the user's CEST is done in the
browser, not here.
"""
import json
import os
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# --- Teams: 48 nations, grouped A-L -----------------------------------------
# code -> (name, group, flag emoji)
TEAMS = {
    # Group A
    "MEX": ("Mexico", "A", "🇲🇽"),
    "RSA": ("South Africa", "A", "🇿🇦"),
    "KOR": ("Korea Republic", "A", "🇰🇷"),
    "CZE": ("Czechia", "A", "🇨🇿"),
    # Group B
    "CAN": ("Canada", "B", "🇨🇦"),
    "BIH": ("Bosnia and Herzegovina", "B", "🇧🇦"),
    "QAT": ("Qatar", "B", "🇶🇦"),
    "SUI": ("Switzerland", "B", "🇨🇭"),
    # Group C
    "BRA": ("Brazil", "C", "🇧🇷"),
    "MAR": ("Morocco", "C", "🇲🇦"),
    "HAI": ("Haiti", "C", "🇭🇹"),
    "SCO": ("Scotland", "C", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"),
    # Group D
    "USA": ("United States", "D", "🇺🇸"),
    "PAR": ("Paraguay", "D", "🇵🇾"),
    "AUS": ("Australia", "D", "🇦🇺"),
    "TUR": ("Türkiye", "D", "🇹🇷"),
    # Group E
    "GER": ("Germany", "E", "🇩🇪"),
    "CUW": ("Curaçao", "E", "🇨🇼"),
    "CIV": ("Côte d'Ivoire", "E", "🇨🇮"),
    "ECU": ("Ecuador", "E", "🇪🇨"),
    # Group F
    "NED": ("Netherlands", "F", "🇳🇱"),
    "JPN": ("Japan", "F", "🇯🇵"),
    "SWE": ("Sweden", "F", "🇸🇪"),
    "TUN": ("Tunisia", "F", "🇹🇳"),
    # Group G
    "BEL": ("Belgium", "G", "🇧🇪"),
    "EGY": ("Egypt", "G", "🇪🇬"),
    "IRN": ("IR Iran", "G", "🇮🇷"),
    "NZL": ("New Zealand", "G", "🇳🇿"),
    # Group H
    "ESP": ("Spain", "H", "🇪🇸"),
    "CPV": ("Cabo Verde", "H", "🇨🇻"),
    "KSA": ("Saudi Arabia", "H", "🇸🇦"),
    "URU": ("Uruguay", "H", "🇺🇾"),
    # Group I
    "FRA": ("France", "I", "🇫🇷"),
    "SEN": ("Senegal", "I", "🇸🇳"),
    "IRQ": ("Iraq", "I", "🇮🇶"),
    "NOR": ("Norway", "I", "🇳🇴"),
    # Group J
    "ARG": ("Argentina", "J", "🇦🇷"),
    "ALG": ("Algeria", "J", "🇩🇿"),
    "AUT": ("Austria", "J", "🇦🇹"),
    "JOR": ("Jordan", "J", "🇯🇴"),
    # Group K
    "POR": ("Portugal", "K", "🇵🇹"),
    "COD": ("Congo DR", "K", "🇨🇩"),
    "UZB": ("Uzbekistan", "K", "🇺🇿"),
    "COL": ("Colombia", "K", "🇨🇴"),
    # Group L
    "ENG": ("England", "L", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"),
    "CRO": ("Croatia", "L", "🇭🇷"),
    "GHA": ("Ghana", "L", "🇬🇭"),
    "PAN": ("Panama", "L", "🇵🇦"),
}

# Selecciones grandes para la excepción de fin de semana (informativo).
BIG_TEAMS = ["GER", "BRA", "ARG", "ENG", "FRA", "ESP", "POR"]

# --- Venues: name -> (city, country) ----------------------------------------
V = {
    "azteca": ("Estadio Azteca", "Mexico City", "MEX"),
    "akron": ("Estadio Akron", "Guadalajara", "MEX"),
    "bbva": ("Estadio BBVA Bancomer", "Monterrey", "MEX"),
    "bmo": ("BMO Field", "Toronto", "CAN"),
    "bcplace": ("BC Place", "Vancouver", "CAN"),
    "sofi": ("SoFi Stadium", "Inglewood", "USA"),
    "levis": ("Levi's Stadium", "Santa Clara", "USA"),
    "metlife": ("MetLife Stadium", "East Rutherford", "USA"),
    "gillette": ("Gillette Stadium", "Foxborough", "USA"),
    "nrg": ("NRG Stadium", "Houston", "USA"),
    "att": ("AT&T Stadium", "Arlington", "USA"),
    "lincoln": ("Lincoln Financial Field", "Philadelphia", "USA"),
    "mercedes": ("Mercedes-Benz Stadium", "Atlanta", "USA"),
    "lumen": ("Lumen Field", "Seattle", "USA"),
    "hardrock": ("Hard Rock Stadium", "Miami", "USA"),
    "arrowhead": ("Arrowhead Stadium", "Kansas City", "USA"),
}

# --- Group stage matches 1-72 -----------------------------------------------
# (number, home, away, date YYYY-MM-DD, ET time HH:MM, venue key)
GROUP = [
    (1, "MEX", "RSA", "2026-06-11", "15:00", "azteca"),
    (2, "KOR", "CZE", "2026-06-11", "22:00", "akron"),
    (3, "CAN", "BIH", "2026-06-12", "15:00", "bmo"),
    (4, "USA", "PAR", "2026-06-12", "21:00", "sofi"),
    (8, "QAT", "SUI", "2026-06-13", "15:00", "levis"),
    (7, "BRA", "MAR", "2026-06-13", "18:00", "metlife"),
    (5, "HAI", "SCO", "2026-06-13", "21:00", "gillette"),
    (6, "AUS", "TUR", "2026-06-14", "00:00", "bcplace"),
    (10, "GER", "CUW", "2026-06-14", "13:00", "nrg"),
    (11, "NED", "JPN", "2026-06-14", "16:00", "att"),
    (9, "CIV", "ECU", "2026-06-14", "19:00", "lincoln"),
    (12, "SWE", "TUN", "2026-06-14", "22:00", "bbva"),
    (14, "ESP", "CPV", "2026-06-15", "12:00", "mercedes"),
    (16, "BEL", "EGY", "2026-06-15", "15:00", "lumen"),
    (13, "KSA", "URU", "2026-06-15", "18:00", "hardrock"),
    (15, "IRN", "NZL", "2026-06-15", "21:00", "sofi"),
    (17, "FRA", "SEN", "2026-06-16", "15:00", "metlife"),
    (18, "IRQ", "NOR", "2026-06-16", "18:00", "gillette"),
    (19, "ARG", "ALG", "2026-06-16", "21:00", "arrowhead"),
    (20, "AUT", "JOR", "2026-06-17", "00:00", "levis"),
    (23, "POR", "COD", "2026-06-17", "13:00", "nrg"),
    (22, "ENG", "CRO", "2026-06-17", "16:00", "att"),
    (21, "GHA", "PAN", "2026-06-17", "19:00", "bmo"),
    (24, "UZB", "COL", "2026-06-17", "22:00", "azteca"),
    (25, "CZE", "RSA", "2026-06-18", "12:00", "mercedes"),
    (26, "SUI", "BIH", "2026-06-18", "15:00", "sofi"),
    (27, "CAN", "QAT", "2026-06-18", "18:00", "bcplace"),
    (28, "MEX", "KOR", "2026-06-18", "21:00", "akron"),
    (32, "USA", "AUS", "2026-06-19", "15:00", "lumen"),
    (30, "SCO", "MAR", "2026-06-19", "18:00", "gillette"),
    (29, "BRA", "HAI", "2026-06-19", "20:30", "lincoln"),
    (31, "TUR", "PAR", "2026-06-19", "23:00", "levis"),
    (35, "NED", "SWE", "2026-06-20", "13:00", "nrg"),
    (33, "GER", "CIV", "2026-06-20", "16:00", "bmo"),
    (34, "ECU", "CUW", "2026-06-20", "20:00", "arrowhead"),
    (36, "TUN", "JPN", "2026-06-21", "00:00", "bbva"),
    (38, "ESP", "KSA", "2026-06-21", "12:00", "mercedes"),
    (39, "BEL", "IRN", "2026-06-21", "15:00", "sofi"),
    (37, "URU", "CPV", "2026-06-21", "18:00", "hardrock"),
    (40, "NZL", "EGY", "2026-06-21", "21:00", "bcplace"),
    (43, "ARG", "AUT", "2026-06-22", "13:00", "att"),
    (42, "FRA", "IRQ", "2026-06-22", "17:00", "lincoln"),
    (41, "NOR", "SEN", "2026-06-22", "20:00", "metlife"),
    (44, "JOR", "ALG", "2026-06-22", "23:00", "levis"),
    (47, "POR", "UZB", "2026-06-23", "13:00", "nrg"),
    (45, "ENG", "GHA", "2026-06-23", "16:00", "gillette"),
    (46, "PAN", "CRO", "2026-06-23", "19:00", "bmo"),
    (48, "COL", "COD", "2026-06-23", "22:00", "akron"),
    (51, "SUI", "CAN", "2026-06-24", "15:00", "bcplace"),
    (52, "BIH", "QAT", "2026-06-24", "15:00", "lumen"),
    (49, "SCO", "BRA", "2026-06-24", "18:00", "hardrock"),
    (50, "MAR", "HAI", "2026-06-24", "18:00", "mercedes"),
    (53, "CZE", "MEX", "2026-06-24", "21:00", "azteca"),
    (54, "RSA", "KOR", "2026-06-24", "21:00", "bbva"),
    (56, "ECU", "GER", "2026-06-25", "16:00", "metlife"),
    (55, "CUW", "CIV", "2026-06-25", "16:00", "lincoln"),
    (58, "TUN", "NED", "2026-06-25", "19:00", "arrowhead"),
    (57, "JPN", "SWE", "2026-06-25", "19:00", "att"),
    (59, "TUR", "USA", "2026-06-25", "22:00", "sofi"),
    (60, "PAR", "AUS", "2026-06-25", "22:00", "levis"),
    (61, "NOR", "FRA", "2026-06-26", "15:00", "gillette"),
    (62, "SEN", "IRQ", "2026-06-26", "15:00", "bmo"),
    (66, "URU", "ESP", "2026-06-26", "20:00", "akron"),
    (65, "CPV", "KSA", "2026-06-26", "20:00", "nrg"),
    (64, "NZL", "BEL", "2026-06-26", "23:00", "bcplace"),
    (63, "EGY", "IRN", "2026-06-26", "23:00", "lumen"),
    (67, "PAN", "ENG", "2026-06-27", "17:00", "metlife"),
    (68, "CRO", "GHA", "2026-06-27", "17:00", "lincoln"),
    (71, "COL", "POR", "2026-06-27", "19:30", "hardrock"),
    (72, "COD", "UZB", "2026-06-27", "19:30", "mercedes"),
    (70, "JOR", "ARG", "2026-06-27", "23:00", "att"),
    (69, "ALG", "AUT", "2026-06-27", "23:00", "arrowhead"),
]

# --- Knockout matches 73-104 ------------------------------------------------
# (number, stage, home label, away label, date, ET time, venue key)
KNOCKOUT = [
    (73, "r32", "2A", "2B", "2026-06-28", "15:00", "sofi"),
    (76, "r32", "1C", "2F", "2026-06-29", "13:00", "nrg"),
    (74, "r32", "1E", "3ABCDF", "2026-06-29", "16:30", "gillette"),
    (75, "r32", "1F", "2C", "2026-06-29", "21:00", "bbva"),
    (78, "r32", "2E", "2I", "2026-06-30", "13:00", "att"),
    (77, "r32", "1I", "3CDFGH", "2026-06-30", "17:00", "metlife"),
    (79, "r32", "1A", "3CEFHI", "2026-06-30", "21:00", "azteca"),
    (80, "r32", "1L", "3EHIJK", "2026-07-01", "12:00", "mercedes"),
    (82, "r32", "1G", "3AEHIJ", "2026-07-01", "16:00", "lumen"),
    (81, "r32", "1D", "3BEFIJ", "2026-07-01", "20:00", "levis"),
    (84, "r32", "1H", "2J", "2026-07-02", "15:00", "sofi"),
    (83, "r32", "2K", "2L", "2026-07-02", "19:00", "bmo"),
    (85, "r32", "1B", "3EFGIJ", "2026-07-02", "23:00", "bcplace"),
    (88, "r32", "2D", "2G", "2026-07-03", "14:00", "att"),
    (86, "r32", "1J", "2H", "2026-07-03", "18:00", "hardrock"),
    (87, "r32", "1K", "3DEIJL", "2026-07-03", "21:30", "arrowhead"),
    (90, "r16", "W73", "W75", "2026-07-04", "13:00", "nrg"),
    (89, "r16", "W74", "W77", "2026-07-04", "17:00", "lincoln"),
    (91, "r16", "W76", "W78", "2026-07-05", "16:00", "metlife"),
    (92, "r16", "W79", "W80", "2026-07-05", "20:00", "azteca"),
    (93, "r16", "W83", "W84", "2026-07-06", "15:00", "att"),
    (94, "r16", "W81", "W82", "2026-07-06", "20:00", "lumen"),
    (95, "r16", "W86", "W88", "2026-07-07", "12:00", "mercedes"),
    (96, "r16", "W85", "W87", "2026-07-07", "16:00", "bcplace"),
    (97, "qf", "W89", "W90", "2026-07-09", "16:00", "gillette"),
    (98, "qf", "W93", "W94", "2026-07-10", "15:00", "sofi"),
    (99, "qf", "W91", "W92", "2026-07-11", "17:00", "hardrock"),
    (100, "qf", "W95", "W96", "2026-07-11", "21:00", "arrowhead"),
    (101, "sf", "W97", "W98", "2026-07-14", "15:00", "att"),
    (102, "sf", "W99", "W100", "2026-07-15", "15:00", "mercedes"),
    (103, "bronze", "L101", "L102", "2026-07-18", "17:00", "hardrock"),
    (104, "final", "W101", "W102", "2026-07-19", "15:00", "metlife"),
]

ET_TO_UTC = timedelta(hours=4)  # EDT = UTC-4 during the tournament


def kickoff_utc(date_str, et_time):
    local = datetime.strptime(f"{date_str} {et_time}", "%Y-%m-%d %H:%M")
    return (local + ET_TO_UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def venue_fields(key):
    name, city, country = V[key]
    return name, city, country


def build_matches():
    matches = []
    for number, home, away, date_str, et_time, vkey in GROUP:
        name, city, country = venue_fields(vkey)
        matches.append({
            "matchNumber": number,
            "stage": "group",
            "group": TEAMS[home][1],
            "kickoffUtc": kickoff_utc(date_str, et_time),
            "home": home,
            "away": away,
            "homeLabel": TEAMS[home][0],
            "awayLabel": TEAMS[away][0],
            "venue": name,
            "city": city,
            "country": country,
        })
    for number, stage, home, away, date_str, et_time, vkey in KNOCKOUT:
        name, city, country = venue_fields(vkey)
        matches.append({
            "matchNumber": number,
            "stage": stage,
            "group": None,
            "kickoffUtc": kickoff_utc(date_str, et_time),
            "home": home,
            "away": away,
            "homeLabel": home,
            "awayLabel": away,
            "venue": name,
            "city": city,
            "country": country,
        })
    matches.sort(key=lambda m: (m["kickoffUtc"], m["matchNumber"]))
    return matches


def build_teams():
    teams = []
    for code, (name, group, flag) in TEAMS.items():
        teams.append({
            "code": code,
            "name": name,
            "group": group,
            "flag": flag,
            "isBigTeam": code in BIG_TEAMS,
        })
    teams.sort(key=lambda t: t["name"])
    return teams


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    matches = build_matches()
    teams = build_teams()

    assert len(matches) == 104, f"expected 104 matches, got {len(matches)}"
    assert len(teams) == 48, f"expected 48 teams, got {len(teams)}"
    numbers = sorted(m["matchNumber"] for m in matches)
    assert numbers == list(range(1, 105)), "match numbers must be 1..104 with no gaps"
    m1 = next(m for m in matches if m["matchNumber"] == 1)
    assert m1["kickoffUtc"] == "2026-06-11T19:00:00Z", m1["kickoffUtc"]

    with open(os.path.join(DATA_DIR, "matches.json"), "w", encoding="utf-8") as f:
        json.dump(matches, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(os.path.join(DATA_DIR, "teams.json"), "w", encoding="utf-8") as f:
        json.dump(teams, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # JS copies so the page works when opened directly via file:// (no fetch/CORS).
    matches_js = json.dumps(matches, ensure_ascii=False, indent=2)
    teams_js = json.dumps(teams, ensure_ascii=False, indent=2)
    with open(os.path.join(DATA_DIR, "matches.js"), "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/generate_data.py - do not edit by hand.\n")
        f.write(f"window.MATCHES = {matches_js};\n")
    with open(os.path.join(DATA_DIR, "teams.js"), "w", encoding="utf-8") as f:
        f.write("// Auto-generated by scripts/generate_data.py - do not edit by hand.\n")
        f.write(f"window.TEAMS = {teams_js};\n")

    print(f"Wrote {len(matches)} matches and {len(teams)} teams to {DATA_DIR}")


if __name__ == "__main__":
    main()
