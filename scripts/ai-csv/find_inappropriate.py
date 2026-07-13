#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Issue 4: توليد قائمة بالأعمال المشتبه في احتوائها ميولاً جنسية/غير لائقة
(أفلام/مسلسلات/أنمي، خصوصاً الآسيوية) — لمراجعة المستخدم، دون حذف تلقائي.

المصادر:
  1) كلمات TMDB (keywords): أقوى إشارة — bdsm, sex, erotica, nudity, softcore ...
  2) علم TMDB adult
  3) كلمات في العنوان/القصة (عربي/إنجليزي)

المخرجات:
  .import-cache/inappropriate-candidates.json  (تفصيلي مع الأسباب والدرجة)
  reports/inappropriate-works.md               (تقرير مقروء للمستخدم)
"""
import json, os, time, urllib.request, re
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
KWCACHE = os.path.join(CACHE, 'tmdb-keywords.json')
OUT_JSON = os.path.join(CACHE, 'inappropriate-candidates.json')
OUT_MD = os.path.join(ROOT, 'reports', 'inappropriate-works.md')

TOKEN = None
for line in open(os.path.join(ROOT, '.dev.vars'), encoding='utf-8'):
    if line.startswith('TMDB_TOKEN'):
        TOKEN = line.split('=', 1)[1].strip().strip('"')
        break
assert TOKEN

def api(path):
    url = f'https://api.themoviedb.org/3/{path}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}', 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.0 * (attempt + 1))
    return None

# ---------- قواميس الإشارات ----------
# كلمات TMDB القوية (وزن عالٍ)
KW_STRONG = {
    'sex', 'erotic', 'erotica', 'erotique', 'eroticism', 'bdsm', 'softcore',
    'hardcore', 'nudity', 'full frontal nudity', 'female nudity', 'male nudity',
    'sexual', 'sexuality', 'pornography', 'porn', 'sexploitation', 'nymphomaniac',
    'orgy', 'threesome', 'sex scene', 'explicit sex', 'sex addiction',
    'sadomasochism', 'fetish', 'incest', 'lust', 'seduction', 'prostitution',
    'escort', 'brothel', 'strip club', 'stripper', 'sex worker', 'affair',
    'hentai', 'ecchi', 'harem', 'fan service', 'sexual assault', 'sexual abuse',
    'aphrodisiac', 'voyeurism', 'swinger', 'polyamory', 'sugar daddy',
}
# كلمات متوسطة (سياق قد يكون لائقاً أو لا)
KW_MEDIUM = {
    'sensual', 'seductive', 'passion', 'romance and sex', 'love triangle',
    'adultery', 'infidelity', 'one night stand', 'sexual tension', 'forbidden love',
    'mature', 'provocative',
}
# كلمات في العناوين (إنجليزي)
TITLE_KW = [
    'sex', 'erotic', 'seduction', 'seduce', 'nude', 'naked', 'lust', 'desire',
    'affair', 'mistress', 'pleasure', 'intimate', 'temptation', 'obsession',
    'forbidden', 'sensual', 'passion', 'lover', '365 days', 'fifty shades',
    'sugar', 'escort', 'call girl', 'playboy', 'stripper',
]
# كلمات عربية في العنوان/القصة
TITLE_KW_AR = [
    'إغواء', 'اغراء', 'إغراء', 'شهوة', 'رغبة', 'عشيقة', 'خيانة زوجية',
    'ممنوع', 'محرم', 'إثارة جنسية', 'جسد',
]
# دول آسيوية (رفع الحساسية للأفلام الآسيوية كما طلب المستخدم)
ASIAN_HINTS = ['كوري', 'ياباني', 'صيني', 'تايلاندي', 'korea', 'japan', 'china', 'thai']

def main():
    details = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))

    kw_cache = {}
    if os.path.exists(KWCACHE):
        kw_cache = json.load(open(KWCACHE, encoding='utf-8'))

    works = [(wid, w) for wid, w in details.items() if w.get('tmdbId')]
    print(f'فحص {len(works)} عمل عبر كلمات TMDB ...')

    candidates = []
    api_calls = 0
    for i, (wid, w) in enumerate(works, 1):
        tid = w['tmdbId']
        typ = w['type']
        is_tv = typ in ('series', 'anime')
        kind = 'tv' if is_tv else 'movie'
        ckey = f'{kind}:{tid}'

        if ckey in kw_cache:
            info = kw_cache[ckey]
        else:
            kw_data = api(f'{kind}/{tid}/keywords')
            api_calls += 1
            kws = []
            if kw_data:
                kws = [k['name'].lower() for k in (kw_data.get('keywords') or kw_data.get('results') or [])]
            info = {'keywords': kws}
            kw_cache[ckey] = info
            if i % 50 == 0:
                json.dump(kw_cache, open(KWCACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'  ... {i}/{len(works)} | {api_calls} استعلام')
            time.sleep(0.05)

        kws = set(info.get('keywords', []))
        reasons = []
        score = 0

        # 1) كلمات TMDB قوية
        hit_strong = kws & KW_STRONG
        if hit_strong:
            score += 3 * len(hit_strong)
            reasons.append('كلمات TMDB قوية: ' + ', '.join(sorted(hit_strong)))
        # 2) كلمات متوسطة
        hit_med = kws & KW_MEDIUM
        if hit_med:
            score += 1 * len(hit_med)
            reasons.append('كلمات TMDB متوسطة: ' + ', '.join(sorted(hit_med)))
        # 3) عنوان إنجليزي
        title = (w.get('title') or '').lower()
        th = [k for k in TITLE_KW if k in title]
        if th:
            score += 2 * len(th)
            reasons.append('كلمات في العنوان: ' + ', '.join(th))
        # 4) عنوان/قصة عربية
        text_ar = (w.get('titleEn') or '') + ' ' + (w.get('synopsis') or '')
        tha = [k for k in TITLE_KW_AR if k in text_ar]
        if tha:
            score += 2 * len(tha)
            reasons.append('كلمات عربية: ' + ', '.join(tha))

        if score <= 0:
            continue

        # رفع الحساسية للأعمال الآسيوية
        blob = (w.get('titleEn','') + ' ' + w.get('synopsis','')).lower()
        asian = any(h in blob for h in ASIAN_HINTS)
        if asian:
            score += 1

        candidates.append({
            'id': wid, 'title': w.get('title'), 'titleAr': w.get('titleEn'),
            'type': typ, 'year': w.get('year'), 'tmdbId': tid,
            'genres': w.get('genres', []),
            'score': score, 'asian': asian,
            'reasons': reasons,
            'url': f'/title/{wid}',
        })

    json.dump(kw_cache, open(KWCACHE, 'w', encoding='utf-8'), ensure_ascii=False)

    # ترتيب حسب الدرجة
    candidates.sort(key=lambda c: -c['score'])

    # تصنيف: مؤكّد (score>=6) / محتمل (3-5) / اشتباه (1-2)
    def tier(s):
        return 'مؤكّد' if s >= 6 else ('محتمل' if s >= 3 else 'اشتباه')

    json.dump(candidates, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # تقرير Markdown
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    tiers = {'مؤكّد': [], 'محتمل': [], 'اشتباه': []}
    for c in candidates:
        tiers[tier(c['score'])].append(c)

    lines = []
    lines.append('# قائمة الأعمال المشتبه بها (محتوى جنسي/غير لائق)')
    lines.append('')
    lines.append('> قائمة **للمراجعة فقط** — لم يُحذف أي عمل. الأعمال مرتّبة حسب قوة الاشتباه.')
    lines.append('> المصدر: كلمات TMDB (keywords) + تحليل العنوان/القصة. الأعمال الآسيوية مُعلّمة (🌏).')
    lines.append('')
    lines.append(f'**الإجمالي:** {len(candidates)} عمل — '
                 f'مؤكّد: {len(tiers["مؤكّد"])}، محتمل: {len(tiers["محتمل"])}، اشتباه: {len(tiers["اشتباه"])}')
    lines.append('')
    TYPE_AR = {'movie': 'فيلم', 'series': 'مسلسل', 'anime': 'أنمي'}
    for tname in ['مؤكّد', 'محتمل', 'اشتباه']:
        arr = tiers[tname]
        if not arr:
            continue
        lines.append(f'## {tname} ({len(arr)})')
        lines.append('')
        lines.append('| # | العمل | النوع | السنة | الدرجة | الأسباب |')
        lines.append('|---|-------|-------|-------|--------|---------|')
        for idx, c in enumerate(arr, 1):
            asian = ' 🌏' if c['asian'] else ''
            name = f"{c['title']}{asian}"
            if c.get('titleAr') and c['titleAr'] != c['title']:
                name += f" ({c['titleAr']})"
            reasons = ' ؛ '.join(c['reasons'])
            lines.append(f"| {idx} | {name} | {TYPE_AR.get(c['type'], c['type'])} | {c['year'] or '-'} | {c['score']} | {reasons} |")
        lines.append('')
    open(OUT_MD, 'w', encoding='utf-8').write('\n'.join(lines))

    print()
    print('✅ انتهى')
    print(f'  استعلامات API: {api_calls}')
    print(f'  إجمالي المرشحين: {len(candidates)}')
    print(f'    مؤكّد (≥6): {len(tiers["مؤكّد"])}')
    print(f'    محتمل (3-5): {len(tiers["محتمل"])}')
    print(f'    اشتباه (1-2): {len(tiers["اشتباه"])}')
    print(f'  تقرير: reports/inappropriate-works.md')
    print(f'  بيانات: .import-cache/inappropriate-candidates.json')

if __name__ == '__main__':
    main()
