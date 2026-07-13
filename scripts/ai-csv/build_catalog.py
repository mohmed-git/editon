#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
المرحلة 1: قراءة catalog-ai.csv وبناء كتالوج خام مجمّع.
franchise موحّد -> مواسم -> حلقات -> سيرفرات (مع دمج المكرر وتنظيف العناوين)
المخرج: .import-cache/catalog-raw.json
"""
import csv, json, re, sys, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CSV_PATH = os.environ.get('CSV_PATH', '/home/user/uploaded_files/cinemaplus-catalog-ai.csv')
CACHE_DIR = os.path.join(ROOT, '.import-cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# ---------------- تنظيف العناوين ----------------
NOISE = [
    r'مترجم\s*اون\s*لاين', r'مشاهدة\s*وتحميل', r'اون\s*لاين',
    r'مترجم', r'مدبلج', r'مشاهدة', r'تحميل', r'بجودة\s*عالية',
    r'جودة\s*عالية', r'كامل[ةه]?',
]
NOISE_RE = re.compile('|'.join(NOISE), re.I)

PREFIXES = [
    (re.compile(r'^\s*الحلقة\s*الخاصة\s*', re.I), 'special'),
    (re.compile(r'^\s*اوفا\s*', re.I), 'ova'),
    (re.compile(r'^\s*أوفا\s*', re.I), 'ova'),
    (re.compile(r'^\s*اونا\s*', re.I), 'ona'),
    (re.compile(r'^\s*أونا\s*', re.I), 'ona'),
    (re.compile(r'^\s*فيلم\s*', re.I), 'movie'),
    (re.compile(r'^\s*ova\s*', re.I), 'ova'),
    (re.compile(r'^\s*ona\s*', re.I), 'ona'),
    (re.compile(r'^\s*movie\s*', re.I), 'movie'),
    (re.compile(r'^\s*special\s*', re.I), 'special'),
]
AR = re.compile(r'[\u0600-\u06FF]')
YEAR_RE = re.compile(r'\b(19\d{2}|20[0-3]\d)\b')

def strip_noise(t):
    return re.sub(r'\s{2,}', ' ', NOISE_RE.sub(' ', t)).strip()

def extract_prefix(t):
    kind = None
    s = t.strip()
    changed = True
    while changed:
        changed = False
        for re_, k in PREFIXES:
            if re_.match(s):
                if not kind: kind = k
                s = re_.sub('', s).strip()
                changed = True
                break
    return kind, s

def split_ar_en(text):
    ar, en = [], []
    for w in text.split():
        (ar if AR.search(w) else en).append(w)
    j = lambda x: re.sub(r'^[\s,\-–_]+|[\s,\-–_]+$', '', ' '.join(x)).strip()
    return j(ar), j(en)

def prefer_common(en):
    if not en: return en
    i = en.find('(')
    if i > 0:
        before = re.sub(r'[:：\-–]\s*$', '', en[:i].strip()).strip()
        if len(before) >= 2:
            return before
    return re.sub(r'\s{2,}', ' ', re.sub(r'\([^)]*\)', ' ', en)).strip()

def clean_title(full, base=''):
    full = (full or '').strip()
    kind, after = extract_prefix(full)
    ym = YEAR_RE.search(after)
    year = int(ym.group(1)) if ym else None
    cleaned = strip_noise(after)
    cleaned = re.sub(r'\s{2,}', ' ', YEAR_RE.sub(' ', cleaned)).strip()
    ar, en = split_ar_en(cleaned)
    ar, en = strip_noise(ar), strip_noise(en)
    en = prefer_common(en)
    en = re.sub(r'\s{2,}', ' ', en.replace('（','').replace('）','')).strip()
    ar = re.sub(r'\s{2,}', ' ', ar.replace('（','').replace('）','')).strip()
    if not en and not ar and base:
        b_ar, b_en = split_ar_en(strip_noise(base))
        en = prefer_common(b_en); ar = b_ar
    return {'titleEn': en, 'titleAr': ar, 'year': year, 'entryKind': kind}

# ---------------- تطبيع الـ franchise ----------------
def normalize_base(base, titleEn):
    t = (titleEn or base or '').lower()
    t = re.sub(r'\([^)]*\)', ' ', t)
    t = re.sub(r'\bseason\s*\d+\b', ' ', t)
    t = re.sub(r'\b\d+(st|nd|rd|th)\s*season\b', ' ', t)
    t = re.sub(r'\bs\d+\b', ' ', t)
    t = re.sub(r'\bpart\s*\d+\b', ' ', t)
    t = re.sub(r'الموسم\s*\S+', ' ', t)
    t = re.sub(r'الجزء\s*\S+', ' ', t)
    t = re.sub(r'[^a-z0-9\u0600-\u06FF]+', ' ', t)
    return re.sub(r'\s{2,}', ' ', t).strip()

MANUAL_MERGE = {
    'solo leveling': 'solo-leveling',
    'solo leveling arise from the shadow': 'solo-leveling',
    'ore dake level up na ken': 'solo-leveling',
    'ore dake level up na ken arise from the shadow': 'solo-leveling',
}

def valid_url(u):
    return bool(u) and isinstance(u, str) and u.strip().lower().startswith(('http://','https://')) and len(u.strip()) >= 12

def main():
    print('📖 قراءة CSV:', CSV_PATH, flush=True)
    works = {}   # work_id -> work dict
    order = []   # للحفاظ على الترتيب
    row_count = 0

    with open(CSV_PATH, 'r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.reader(fh)
        header = next(reader)
        col = {h: i for i, h in enumerate(header)}
        srv_cols = []
        for s in range(1, 25):
            lk, uk = f'server_{s}_label', f'server_{s}_url'
            if lk in col and uk in col:
                srv_cols.append((col[lk], col[uk]))

        gi = lambda f, name: f[col[name]] if col.get(name) is not None and col[name] < len(f) else ''

        for f in reader:
            if len(f) < 21:
                continue
            row_count += 1
            wid = gi(f, 'work_id')
            if not wid:
                continue
            if wid not in works:
                full = gi(f, 'full_title'); base = gi(f, 'base_title')
                c = clean_title(full, base)
                yr = gi(f, 'year')
                try: yr = int(yr) if yr else None
                except: yr = None
                works[wid] = {
                    'work_id': wid,
                    'franchise_key': gi(f, 'franchise_key'),
                    'base_title': base, 'full_title': full,
                    'entry_type': gi(f, 'entry_type'),
                    'franchise_entry_no': int(gi(f, 'franchise_entry_no') or 1),
                    'category': gi(f, 'category'),
                    'category_label': gi(f, 'category_label'),
                    'subcategory': gi(f, 'subcategory'),
                    'subcategory_label': gi(f, 'subcategory_label'),
                    'is_new': gi(f, 'is_new') == '1',
                    'year': yr or c['year'],
                    'poster': gi(f, 'poster'),
                    'titleEn': c['titleEn'], 'titleAr': c['titleAr'],
                    'entryKind': c['entryKind'] or gi(f, 'entry_type'),
                    'seasons': {},
                }
                order.append(wid)
            w = works[wid]
            try: sN = int(gi(f, 'season_number') or 1)
            except: sN = 1
            try: eN = int(gi(f, 'episode_number') or 1)
            except: eN = 1
            seasons = w['seasons']
            if sN not in seasons: seasons[sN] = {}
            if eN not in seasons[sN]:
                seasons[sN][eN] = {'title': gi(f, 'episode_title'), 'servers': [], '_urls': set()}
            ep = seasons[sN][eN]
            for (lc, uc) in srv_cols:
                if uc >= len(f): break
                url = f[uc]
                if not valid_url(url): continue
                if url in ep['_urls']: continue
                ep['_urls'].add(url)
                lbl = f[lc] if lc < len(f) and f[lc] else f'سيرفر {len(ep["servers"])+1}'
                ep['servers'].append({'name': lbl, 'url': url})
            if row_count % 20000 == 0:
                print(f'  … {row_count} صف، {len(works)} عمل', flush=True)

    print(f'✅ قُرئ {row_count} صف، {len(works)} عمل فريد', flush=True)

    # ---- دمج الـ franchise ----
    # اجمع franchise_key -> (norm الأطول, category)
    fk_norm, fk_cat = {}, {}
    for wid in order:
        w = works[wid]
        fk = w['franchise_key']
        nb = normalize_base(w['base_title'], w['titleEn'])
        if fk not in fk_norm or len(nb) > len(fk_norm[fk]):
            fk_norm[fk] = nb
        fk_cat.setdefault(fk, w['category'])

    norm_to_fks = {}
    for fk, nb in fk_norm.items():
        if len(nb) < 3: continue
        key = nb + '||' + (fk_cat.get(fk) or '')
        norm_to_fks.setdefault(key, []).append(fk)

    merge = {}
    for key, fks in norm_to_fks.items():
        if len(fks) <= 1: continue
        canonical = sorted(fks, key=len)[0]
        for fk in fks:
            merge[fk] = canonical

    # دمج يدوي
    manual_canon = {}
    for wid in order:
        w = works[wid]
        nb = normalize_base(w['base_title'], w['titleEn'])
        if nb in MANUAL_MERGE:
            tgt = MANUAL_MERGE[nb]
            manual_canon.setdefault(tgt, w['franchise_key'])
    for wid in order:
        w = works[wid]
        nb = normalize_base(w['base_title'], w['titleEn'])
        if nb in MANUAL_MERGE:
            tgt = MANUAL_MERGE[nb]
            if tgt in manual_canon:
                merge[w['franchise_key']] = manual_canon[tgt]

    merged = 0
    for wid in order:
        w = works[wid]
        canon = merge.get(w['franchise_key'])
        if canon and canon != w['franchise_key']:
            w['franchise_key'] = canon
            merged += 1
    print(f'🔗 دُمجت {merged} أعمال في franchises موحّدة', flush=True)
    print(f'📦 عدد الـ franchises بعد الدمج: {len(set(works[w]["franchise_key"] for w in order))}', flush=True)

    # ---- بناء المخرج ----
    out = []
    for wid in order:
        w = works[wid]
        season_nums = sorted(w['seasons'].keys())
        ep_count = 0
        seasons = []
        for sn in season_nums:
            ep_nums = sorted(w['seasons'][sn].keys())
            episodes = []
            for en in ep_nums:
                r = w['seasons'][sn][en]
                ep_count += 1
                episodes.append({'num': en, 'title': r['title'], 'servers': r['servers']})
            seasons.append({'num': sn, 'episodes': episodes})
        out.append({
            'work_id': w['work_id'], 'franchise_key': w['franchise_key'],
            'full_title': w['full_title'], 'base_title': w['base_title'],
            'titleEn': w['titleEn'], 'titleAr': w['titleAr'],
            'entry_type': w['entry_type'], 'entryKind': w['entryKind'],
            'franchise_entry_no': w['franchise_entry_no'],
            'category': w['category'], 'category_label': w['category_label'],
            'subcategory': w['subcategory'], 'subcategory_label': w['subcategory_label'],
            'is_new': w['is_new'], 'year': w['year'], 'poster': w['poster'],
            'seasons': seasons, 'episodeCount': ep_count, 'seasonCount': len(seasons),
        })

    outpath = os.path.join(CACHE_DIR, 'catalog-raw.json')
    with open(outpath, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'💾 حُفظ catalog-raw.json ({len(out)} عمل)', flush=True)

if __name__ == '__main__':
    main()
