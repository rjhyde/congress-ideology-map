# Congress Ideology Map — 119th Congress

Interactive visualization of the political ideology of every member of the 119th US Congress (2025–2027).

**Live app:** https://0lfmebplu5-8050.hosted.obvious.ai

## What it shows

- **X position** — ideology score (liberal ← → conservative)
- **Dot size** — Power Index (institutional influence: leadership role, bills, cosponsors, fundraising, seniority)
- **Opacity** — Source Consistency (how much the 5 data sources agree on placement)
- **Outline color** — Party (blue = Democrat, red = Republican, purple = Independent)
- **Dashed outline** — Non-voting delegates

## Data Sources

| Source | What it measures | Weight |
|---|---|---|
| VoteView DW-NOMINATE | Roll-call vote patterns (UCLA) | 40% |
| GovTrack Ideology | Bill sponsorship network | up to 35% (confidence-scaled) |
| Heritage Action | Conservative org scorecard | 2.7% Dems / 17.3% Reps (adaptive) |
| LCV Environmental | Pro-environment voting record | 13.6% Dems / 2.8% Reps (adaptive) |
| FEC Campaign Finance | Fundraising patterns | 8% (when available) |

GovTrack's weight is scaled by a sigmoid confidence curve based on legislative activity — members with thin co-sponsorship records (freshmen, leadership) get lower GovTrack weight so their voting record dominates.

## Stack

- **Backend:** Python / Flask / Gunicorn
- **Frontend:** D3.js v7
- **Data pipeline:** `refresh_data.py` — runs weekly every Monday 6am PT

## Project structure

```
congress-app/
├── app.py              # Flask routes
├── wsgi.py             # Gunicorn entry point
├── config.py           # Paths and env config
├── lib/
│   └── data.py         # Data loading + hot-reload sentinel
├── templates/
│   └── index.html      # HTML shell
├── static/
│   ├── css/style.css
│   └── js/app.js       # D3 visualization + all UI logic
├── requirements.txt
└── refresh_data.py     # Weekly data pipeline (run from /home/user/work/)
```

## Running locally

```bash
pip install flask gunicorn
# Place enhanced_members.json in /home/user/work/data/
cd congress-app
gunicorn wsgi:app --bind 0.0.0.0:8050
```

## Weekly refresh

`refresh_data.py` fetches all 5 sources, recomputes scores, and writes `.refresh_done` — Flask hot-reloads on the next request with no restart needed.
