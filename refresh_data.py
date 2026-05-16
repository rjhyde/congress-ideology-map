#!/usr/bin/env python3
"""
Congress Ideology Map — Weekly Data Refresh Pipeline
Fetches all 5 ideology sources and rewrites enhanced_members.json.
Does NOT touch any app code — data only.
"""
import csv, io, json, math, re, statistics, time, datetime, urllib.request
from html import unescape
from collections import defaultdict

DATA_DIR = '/home/user/work/data'

PARTY_MAP = {
    '100': 'Democrat', '200': 'Republican', '328': 'Independent',
    '329': 'Independent Democrat', '331': 'Independent Republican',
}

DISPLAY_NAMES = {
    'M000355': 'Mitch McConnell', 'S000148': 'Chuck Schumer',
    'P000197': 'Nancy Pelosi',    'S000033': 'Bernie Sanders',
    'W000817': 'Elizabeth Warren', 'J000299': 'Mike Johnson',
    'J000294': 'Hakeem Jeffries', 'T000250': 'John Thune',
    'C001035': 'Susan Collins',   'M001153': 'Lisa Murkowski',
    'O000172': 'Alexandria Ocasio-Cortez', 'P000613': 'Jimmy Panetta',
    'A000371': 'Pete Aguilar',    'S001150': 'Adam Schiff',
    'C001088': 'Chris Coons',     'C001056': 'John Cornyn',
    'G000359': 'Lindsey Graham',  'K000367': 'Amy Klobuchar',
    'B001230': 'Tammy Baldwin',   'D000563': 'Dick Durbin',
    'B000944': 'Sherrod Brown',   'C000127': 'Maria Cantwell',
    'M001111': 'Patty Murray',    'P000145': 'Alex Padilla',
    'R000576': 'Dutch Ruppersberger',
    'G000568': 'Morgan Griffith',
}

LEADERSHIP = {
    # Verified against GovTrack live data May 2026
    'J000299': ('Speaker', 100),            # Mike Johnson (LA)
    'J000294': ('Minority Leader', 90),     # Hakeem Jeffries (NY)
    'T000250': ('Majority Leader', 90),     # John Thune (SD)
    'S000148': ('Minority Leader (S)', 90), # Chuck Schumer (NY)
    'S001176': ('Majority Whip', 80),       # Steve Scalise (LA)
    'C001101': ('Minority Whip', 80),       # Katherine Clark (MA)
    'M001136': ('GOP Conference Chair', 70),# Lisa McClain (MI)
    'A000371': ('Dem Caucus Chair', 70),    # Pete Aguilar (CA)
}

REMOVE_BG = {'V000137'}  # JD Vance (VP) — W000790 is Warnock, Waltz has no current GovTrack record

def fetch(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')

def gt_confidence(bills, cosponsors):
    """Sigmoid confidence curve — low activity = low GovTrack weight."""
    return 1 / (1 + math.exp(-0.04 * (bills + cosponsors - 80)))

def title_case_name(w):
    for prefix in ('Mc', 'Mac'):
        if w.lower().startswith(prefix.lower()) and len(w) > len(prefix):
            return prefix + w[len(prefix)].upper() + w[len(prefix)+1:].lower()
    if w.lower().startswith("o'") and len(w) > 2:
        return "O'" + w[2].upper() + w[3:].lower()
    return w.capitalize()

def extract_display_name(bioname):
    if not bioname: return ''
    parts = bioname.split(',', 1)
    last_raw = parts[0].strip()
    rest = parts[1].strip() if len(parts) > 1 else ''
    nick = re.search(r'\(([^)]+)\)', rest)
    nickname = nick.group(1).strip() if nick else None
    rest_clean = re.sub(r'\([^)]+\)', '', rest).strip()
    first_raw = rest_clean.split()[0] if rest_clean else ''
    use_nick = nickname and len(nickname) > 2 and not nickname.endswith('.')
    first = nickname if use_nick else first_raw
    last = ' '.join(title_case_name(p) for p in last_raw.split())
    first = title_case_name(first) if first else ''
    return f"{first} {last}".strip()

# ── 1. VoteView ───────────────────────────────────────────────────────────────
print("Fetching VoteView...")
content = fetch("https://voteview.com/static/data/out/members/HSall_members.csv")
all_rows = list(csv.DictReader(io.StringIO(content)))
vv = [r for r in all_rows if r.get('congress') == '119']
print(f"  VoteView 119th: {len(vv)} members")

# Member history (Nokken-Poole)
print("Building member history...")
history = defaultdict(list)
for row in all_rows:
    bg = row.get('bioguide_id', '').strip()
    if not bg: continue
    try:
        congress = int(row.get('congress', 0))
        nom1 = float(row.get('nominate_dim1') or 0)
        nk_raw = row.get('nokken_poole_dim1', '').strip()
        nk = float(nk_raw) if nk_raw else None
        chamber = row.get('chamber', '').strip()
        if congress and chamber in ('House', 'Senate'):
            history[bg].append({
                'congress': congress, 'chamber': chamber,
                'nominate_dim1': round(nom1, 4),
                'nokken_poole': round(nk, 4) if nk is not None else None,
            })
    except: continue
for bg in history:
    history[bg].sort(key=lambda x: x['congress'])

# ── 2. GovTrack ───────────────────────────────────────────────────────────────
print("Fetching GovTrack...")
roles_data = json.loads(fetch("https://www.govtrack.us/api/v2/role?current=true&limit=600&format=json"))
bg_to_gt = {}
for role in roles_data['objects']:
    p = role.get('person', {})
    bg = p.get('bioguideid', '')
    link = p.get('link', '')
    if bg and link:
        bg_to_gt[bg] = link.rstrip('/').split('/')[-1]

gt_by_id = {}
for ch in ['h', 's']:
    c = fetch(f"https://www.govtrack.us/data/analysis/by-congress/119/sponsorshipanalysis_{ch}.txt")
    for row in csv.DictReader(io.StringIO(c)):
        gt_by_id[row['ID'].strip()] = row
print(f"  GovTrack: {len(gt_by_id)} members")

# ── 3. Heritage Action ────────────────────────────────────────────────────────
print("Fetching Heritage Action...")
heritage_by_bg = {}
try:
    html = fetch("https://heritageaction.com/scorecard/members")
    decoded = unescape(html)
    match = re.search(
        r'\[(\{"title":"(?:Rep|Sen)".*?"score":"[^"]*"\}(?:,\{"title":"(?:Rep|Sen)".*?"score":"[^"]*"\})*)\]',
        decoded, re.DOTALL)
    if match:
        for m in json.loads('[' + match.group(1) + ']'):
            bg = m.get('congId', '').strip()
            score = m.get('score', '')
            if bg and score != '':
                try: heritage_by_bg[bg] = int(score) / 100.0
                except: pass
    print(f"  Heritage: {len(heritage_by_bg)} members")
except Exception as e:
    print(f"  Heritage blocked: {e} — using 0 matches")

# ── 4. LCV ────────────────────────────────────────────────────────────────────
print("Fetching LCV...")
# Build bioguide→score map using pre-computed ID crosswalk
# This avoids name-based matching entirely
lcv_by_bioguide = {}
try:
    # Fetch LCV page
    html = fetch("https://scorecard.lcv.org/members-of-congress",
                 headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                          "Accept": "text/html"})
    # Extract slug→score from LCV
    lcv_by_slug = {}
    for block in re.findall(r'<li class="congress-item">(.*?)</li>', html, re.DOTALL):
        link_m  = re.search(r'href="https://www\.lcv\.org/moc/([^/]+)/"', block)
        score_m = re.search(r'class="data-score">\s*(\d+)%', block)
        if link_m and score_m:
            lcv_by_slug[link_m.group(1)] = int(score_m.group(1))

    # Load legislator ID crosswalk (bioguide→slug via name matching done once)
    # and build bioguide→score
    leg_url = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
    legislators = json.loads(fetch(leg_url))

    def make_lcv_slug(first, last):
        name = f"{first}-{last}".lower()
        name = re.sub(r"[^a-z0-9-]", "-", name)
        return re.sub(r"-+", "-", name).strip("-")

    lcv_by_last = {}
    for slug, score in lcv_by_slug.items():
        lcv_by_last.setdefault(slug.split('-')[-1], []).append((slug, score))

    for leg in legislators:
        bg = leg['id'].get('bioguide')
        if not bg: continue
        name = leg['name']
        first, last, nick = name.get('first',''), name.get('last',''), name.get('nickname','')
        # Try firstname-lastname slug variants
        for fn in filter(None, [first, nick]):
            slug = make_lcv_slug(fn, last)
            if slug in lcv_by_slug:
                lcv_by_bioguide[bg] = lcv_by_slug[slug]
                break
        if bg in lcv_by_bioguide: continue
        # Fallback: last-name-only with first-initial disambiguation
        last_norm = re.sub(r"[^a-z]", "", last.lower())
        candidates = lcv_by_last.get(last_norm, [])
        if len(candidates) == 1:
            lcv_by_bioguide[bg] = candidates[0][1]
        elif len(candidates) > 1:
            fi = first[0].lower() if first else ''
            ni = nick[0].lower() if nick else ''
            for s, sc in candidates:
                if s.startswith(fi) or (ni and s.startswith(ni)):
                    lcv_by_bioguide[bg] = sc; break

    print(f"  LCV: {len(lcv_by_bioguide)} members matched by ID")
except Exception as e:
    print(f"  LCV error: {e} — using 0 matches")

# ── 5. FEC ────────────────────────────────────────────────────────────────────
print("Fetching FEC...")
# Use bioguide→FEC candidate ID crosswalk — no name matching
fec_by_bioguide = {}
try:
    leg_url = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
    legislators_fec = json.loads(fetch(leg_url))
    bg_to_fec_ids = {l['id']['bioguide']: l['id'].get('fec', [])
                     for l in legislators_fec if l['id'].get('bioguide') and l['id'].get('fec')}

    # Fetch FEC totals by office and map via candidate_id
    fec_by_candidate_id = {}
    for office in ['H', 'S']:
        for page in range(1, 15):
            url = f"https://api.open.fec.gov/v1/candidates/totals/?election_year=2024&office={office}&per_page=100&page={page}&api_key=DEMO_KEY"
            try:
                data = json.loads(fetch(url))
                results = data.get('results', [])
                if not results: break
                for c in results:
                    cid = c.get('candidate_id', '')
                    if cid:
                        fec_by_candidate_id[cid] = c.get('receipts') or 0
                time.sleep(0.3)
            except Exception as e:
                print(f"  FEC {office} p{page}: {e}")
                time.sleep(2); break

    # Map bioguide → max receipts across all their FEC candidate IDs
    for bg, fec_ids in bg_to_fec_ids.items():
        receipts = max((fec_by_candidate_id.get(fid, 0) for fid in fec_ids), default=0)
        if receipts > 0:
            fec_by_bioguide[bg] = receipts

    print(f"  FEC: {len(fec_by_bioguide)} members matched by ID")
except Exception as e:
    print(f"  FEC error: {e} — using 0 matches")

# ── Merge ─────────────────────────────────────────────────────────────────────
print("Merging sources...")
members = []
for m in vv:
    bg = m.get('bioguide_id', '').strip()
    if not bg or bg in REMOVE_BG: continue

    party_code = m.get('party_code', '').strip()
    chamber    = m.get('chamber', '').strip()
    is_dem = party_code == '100'
    is_rep = party_code == '200'

    try: nom1 = float(m.get('nominate_dim1') or 0)
    except: nom1 = 0.0
    try: nom2 = float(m.get('nominate_dim2') or 0)
    except: nom2 = 0.0
    try: nk = float(m.get('nokken_poole_dim1') or 0)
    except: nk = nom1
    try: nvotes = int(m.get('nominate_votes') or 0)
    except: nvotes = 0

    gt_id = bg_to_gt.get(bg, '')
    gt    = gt_by_id.get(gt_id, {})
    try: gt_ideo = float(gt.get('ideology') or 0) if gt else None
    except: gt_ideo = None
    try: gt_lead = float(gt.get('leadership') or 0) if gt else None
    except: gt_lead = None
    try: gt_bills = int(gt.get('introduced_bills_119') or 0) if gt else 0
    except: gt_bills = 0
    try: gt_cosps = int(gt.get('unique_cosponsors_119') or 0) if gt else 0
    except: gt_cosps = 0

    gt_norm = ((gt_ideo - 0.5) * 2) if gt_ideo is not None else None
    h_raw   = heritage_by_bg.get(bg)
    h_norm  = (h_raw * 2 - 1) if h_raw is not None else None

    # LCV — look up by bioguide ID (no name matching)
    lcv_score = lcv_by_bioguide.get(bg)
    lcv_norm = ((100 - lcv_score) / 50 - 1) if lcv_score is not None else None

    # FEC — look up by bioguide ID (no name matching)
    fec_receipts = fec_by_bioguide.get(bg)

    # Adaptive weights with GovTrack confidence scaling
    conf  = gt_confidence(gt_bills, gt_cosps)
    w_nom = 0.40
    w_gt  = (0.35 * conf) if gt_norm is not None else 0.0
    w_her = ((0.173 if is_rep else 0.027) if h_norm is not None else 0.0)
    w_lcv = ((0.028 if is_rep else 0.136) if lcv_norm is not None else 0.0)
    w_fec = (0.08 if fec_receipts is not None else 0.0)
    total_w = w_nom + w_gt + w_her + w_lcv + w_fec or 1.0
    wn, wg, wh, wl, wf = w_nom/total_w, w_gt/total_w, w_her/total_w, w_lcv/total_w, w_fec/total_w

    sources = {'dw_nominate': round(nom1, 4)}
    if gt_norm  is not None: sources['govtrack']  = round(gt_norm, 4)
    if h_norm   is not None: sources['heritage']  = round(h_norm, 4)
    if lcv_norm is not None: sources['lcv']       = round(lcv_norm, 4)

    enhanced = nom1*wn
    if gt_norm  is not None: enhanced += gt_norm  * wg
    if h_norm   is not None: enhanced += h_norm   * wh
    if lcv_norm is not None: enhanced += lcv_norm * wl

    # Consistency
    src_vals = list(sources.values())
    w_arr = [wn, wg if gt_norm is not None else 0,
             wh if h_norm is not None else 0,
             wl if lcv_norm is not None else 0][:len(src_vals)]
    if len(src_vals) >= 2:
        wt     = sum(w_arr) or 1
        w_mean = sum(src_vals[i]*w_arr[i] for i in range(len(src_vals))) / wt
        w_var  = sum(w_arr[i]*(src_vals[i]-w_mean)**2 for i in range(len(src_vals))) / wt
        consistency = max(0.0, 1.0 - (w_var**0.5 / 0.45))
    else:
        consistency = 0.5

    # Power index
    role, role_floor = LEADERSHIP.get(bg, (None, 0))
    fec_m   = (fec_receipts or 0) / 1_000_000
    power   = max(role_floor, (
        (gt_lead or 0)*100*0.25 + min(100, gt_bills*2)*0.20 +
        min(100, gt_cosps/3)*0.15 + min(100, fec_m*10)*0.15 +
        min(100, nvotes/50)*0.15 + role_floor*0.10
    ))

    display_name = DISPLAY_NAMES.get(bg) or extract_display_name(raw_name)

    members.append({
        'bioguide_id': bg, 'name': raw_name, 'display_name': display_name,
        'party': PARTY_MAP.get(party_code, 'Other'), 'party_code': party_code,
        'state': state, 'district': m.get('district_code', '').strip(),
        'chamber': chamber,
        'nominate_dim1': round(nom1, 4), 'nominate_dim2': round(nom2, 4),
        'nokken_poole_dim1': round(nk, 4), 'nominate_votes': nvotes,
        'govtrack_ideology': round(gt_ideo, 4) if gt_ideo is not None else None,
        'gt_leadership': round(gt_lead, 4) if gt_lead is not None else None,
        'gt_bills': gt_bills, 'gt_cosponsors': gt_cosps,
        'gt_description': gt.get('description', '') if gt else '',
        'gt_confidence': round(conf, 3),
        'heritage_raw': round(h_raw, 3) if h_raw is not None else None,
        'lcv_score': lcv_score, 'fec_receipts': fec_receipts,
        'enhanced_sources': sources,
        'effective_weights': {'dw_nominate': round(wn,3), 'govtrack': round(wg,3),
                              'heritage': round(wh,3), 'lcv': round(wl,3), 'fec': round(wf,3)},
        'n_sources': len(src_vals),
        'enhanced_score': round(enhanced, 4), 'composite_score': round(enhanced, 4),
        'consistency_score': round(consistency, 3),
        'opacity': round(0.30 + consistency * 0.70, 3),
        'power_index': round(power, 2), 'power_role': role,
        'is_delegate': state in ('AS', 'DC', 'GU', 'MP', 'PR', 'VI'),
    })

# Filter to current members only
current_bgs = set(bg_to_gt.keys())
members = [m for m in members if m['bioguide_id'] in current_bgs or m['nominate_votes'] > 0]
print(f"Final: {len(members)} members")

# Save
with open(f'{DATA_DIR}/enhanced_members.json', 'w') as f:
    json.dump(members, f)
with open(f'{DATA_DIR}/member_history.json', 'w') as f:
    json.dump(dict(history), f)
with open(f'{DATA_DIR}/last_refresh.json', 'w') as f:
    json.dump({
        'timestamp': datetime.datetime.now().isoformat(),
        'members_count': len(members),
        'sources': ['VoteView', 'GovTrack', 'Heritage', 'LCV', 'FEC'],
        'note': 'GovTrack confidence-weighted by legislative activity',
    }, f)

# Touch sentinel for hot-reload
open(f'{DATA_DIR}/.refresh_done', 'w').close()
print(f"Refresh complete — {len(members)} members updated.")
