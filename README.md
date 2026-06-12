# My World Cup 2026 Calendar

A small static web page that shows the **2026 FIFA World Cup** matches in **your own
timezone (CEST)** and helps you keep only the ones you can actually watch — then export
them to your calendar.

No backend, no accounts, no tracking. Everything runs in the browser; results are
refreshed by a scheduled script.

## Features

- **Schedule** with every match in CEST (`Europe/Oslo`), grouped by day.
- **Combinable filters** (a match shows if it passes *any* ticked filter; untick all to see
  everything):
  - ⭐ **My teams** — teams you follow, at any time.
  - 🌙 **Good hours** — matches outside your sleep window.
  - 🏆 **Key knockouts** — quarter-finals, semis, final, third-place.
  - 🎉 **Weekend big-team rescue** — Sat/Sun nights with a big nation.
- **Team typeahead**: type `Fr` → France; accent/case tolerant.
- **Live results & standings**: scores on finished matches, plus the 12 group tables.
- **Export**: download an `.ics` (2h events) or add a match to Google Calendar.
- Preferences (followed teams, filters, sleep window) persist in `localStorage`.

## How it works

```
data/matches.js   — the 104 fixtures (static, generated from the official schedule)
data/teams.js     — the 48 nations
data/results.js   — scores + standings, refreshed from Wikipedia
index.html/app.js — the page; loads the data files and renders everything
```

The page works by opening `index.html` directly, or served by any static host.

### Data pipeline

`scripts/fetch_results.py` reads the per-group Wikipedia articles
(`2026 FIFA World Cup Group A … L`) via the public REST HTML API, parses the standings
tables and match scores deterministically (BeautifulSoup — no LLM), and writes
`data/results.js` / `data/results.json`. If parsing fails it aborts **without** overwriting
the existing data, so the site keeps serving the last good snapshot.

A GitHub Actions workflow (`.github/workflows/update-results.yml`) runs it 3×/day
(23:00 / 03:00 / 09:00 CEST) and commits any changes; GitHub Pages then redeploys.

### Run the fetcher locally

```bash
pip install -r requirements.txt
python scripts/fetch_results.py
```

### Regenerate the static fixtures (rarely needed)

```bash
python scripts/generate_data.py
```

## Attribution

Match results and group standings are derived from **Wikipedia**
(2026 FIFA World Cup articles), licensed **CC BY-SA**.

## License

Personal project. Code under MIT.
