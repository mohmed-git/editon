#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تصدير CSV بكل الأعمال التي بوسترها (الصورة النهائية) من TMDB (image.tmdb.org).
الأعمدة: work_id, type, title, titleEn(الاسم العربي), year, tmdbId, poster, tmdbPoster, backdrop
"""
import json, os, csv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
OUT = os.path.join(ROOT, 'reports', 'tmdb-poster-works.csv')

d = json.load(open(DETAILS, encoding='utf-8'))
works = d if isinstance(d, list) else list(d.values())

TYPE_AR = {'movie': 'فيلم', 'series': 'مسلسل', 'anime': 'أنمي'}

rows = []
for w in works:
    p = w.get('poster') or ''
    if 'image.tmdb.org' in p:
        rows.append({
            'work_id': w.get('id', ''),
            'النوع': TYPE_AR.get(w.get('type'), w.get('type') or ''),
            'الاسم_الإنجليزي': w.get('title', ''),
            'الاسم_العربي': w.get('titleEn', ''),
            'السنة': w.get('year') or '',
            'tmdbId': w.get('tmdbId') or '',
            'poster_url': p,
            'tmdbPoster_url': w.get('tmdbPoster') or '',
            'backdrop_url': w.get('backdrop') or '',
        })

# ترتيب حسب النوع ثم الاسم
rows.sort(key=lambda r: (r['النوع'], (r['الاسم_الإنجليزي'] or '').lower()))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
cols = ['work_id', 'النوع', 'الاسم_الإنجليزي', 'الاسم_العربي', 'السنة',
        'tmdbId', 'poster_url', 'tmdbPoster_url', 'backdrop_url']
with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:  # utf-8-sig ليفتح بشكل صحيح في Excel
    wr = csv.DictWriter(f, fieldnames=cols)
    wr.writeheader()
    wr.writerows(rows)

# إحصاء حسب النوع
from collections import Counter
c = Counter(r['النوع'] for r in rows)
print(f'✅ صُدِّر {len(rows)} عمل بوسترها من TMDB إلى: reports/tmdb-poster-works.csv')
for t, n in c.most_common():
    print(f'   {t}: {n}')
