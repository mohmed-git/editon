#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
يعيد بناء كاش الإثراء الكامل (.import-cache/tmdb-ai/{id}.json) من details.json
للأعمال التي أُلغيت في wrong-enrichments.json.

السبب: النسخة الأولى من verify_all_enrichments كتبت {tmdbId: null} فوق الكاش الكامل
لكنها اعتمدت على أسماء language=ar فقط، فألغت إثراءات صحيحة (اسمها الإنجليزي غاب).
details.json ما زال يحمل البيانات المبنية الكاملة، فنسترجع منها الكاش الكامل ثم
نعيد الفحص بنسخة get_names المصححة (تجلب أيضًا language=en-US).
"""
import json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
WRONG = os.path.join(CACHE, 'wrong-enrichments.json')

det = json.load(open(DETAILS, encoding='utf-8'))
wrong = json.load(open(WRONG, encoding='utf-8'))

restored = 0
missing = 0
for c in wrong:
    wid = c['id']
    w = det.get(wid)
    if not w or not w.get('tmdbId'):
        missing += 1
        continue
    entry = {
        'tmdbId': w.get('tmdbId'),
        'synopsis': w.get('synopsis'),
        'tagline': w.get('tagline'),
        'rating': w.get('rating'),
        'voteCount': w.get('voteCount'),
        'genres': w.get('genres') or [],
        'backdrop': w.get('backdrop'),
        'tmdbPoster': w.get('tmdbPoster'),
        'tmdbTitleAr': w.get('titleEn'),  # الاسم العربي المعرب
        'year': w.get('year'),
        'source': 'restored-from-details',
    }
    json.dump(entry, open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)
    restored += 1

print(f'✅ استُرجع الكاش الكامل لـ {restored} عمل')
print(f'   بلا tmdbId في details (تُركت null): {missing}')
