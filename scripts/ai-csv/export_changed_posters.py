#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
يصدّر CSV شامل لكل الأعمال التي عُدّلت صورتها (صُحّحت / حُذفت / أُلغي إثراؤها /
جُرِّدت من صورة متشاركة) عبر كل الدفعات، مع سبب التعديل والحالة النهائية.

المصادر:
- wrong-enrichments.json      : إثراء خاطئ بسبب تشابه الأسماء (الدفعة 13)
- shared-tmdbid-fixed.json    : أعمال تشاركت tmdbId (re-match / clear) (الدفعة 14)
- dedupe-redirects.json       : أعمال مكرّرة حقيقية حُذفت (الدفعة 12)
الحالة النهائية للصورة تُقرأ من details.json المبني.
"""
import json, os, csv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
OUT = os.path.join(ROOT, 'reports', 'changed-posters.csv')

det = json.load(open(DETAILS, encoding='utf-8'))

def load(p, default):
    p = os.path.join(CACHE, p)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else default

wrong = load('wrong-enrichments.json', [])
shared = load('shared-tmdbid-fixed.json', [])
dedupe = load('dedupe-redirects.json', {})

rows = []  # (work_id, name, year, type, reason, old_tmdbId, new_tmdbId, final_poster, final_status)

def poster_state(wid):
    w = det.get(wid)
    if not w:
        return ('', 'محذوف نهائياً')
    p = w.get('poster')
    if not p:
        return ('', 'بلا صورة (placeholder)')
    src = 'TMDB' if 'image.tmdb.org' in p else 'CSV'
    return (p, f'صورة من {src}')

seen = set()

# 1) إثراء خاطئ بسبب تشابه الأسماء
for c in wrong:
    wid = c['id']
    if wid in seen: continue
    seen.add(wid)
    w = det.get(wid, {})
    fp, fs = poster_state(wid)
    rows.append([wid, c.get('title') or w.get('title'), w.get('year'), w.get('type'),
                 'مطابقة خاطئة (تشابه أسماء) - أُلغي الإثراء',
                 c.get('wrong_tmdbId'), '', fp, fs])

# 2) tmdbId متشارك (re-match أو clear)
for c in shared:
    wid = c['id']
    if wid in seen: continue
    seen.add(wid)
    w = det.get(wid, {})
    fp, fs = poster_state(wid)
    if c['action'] == 're-matched':
        reason = 'tmdbId متشارك - أُعيدت المطابقة للنتيجة الصحيحة'
    else:
        reason = 'tmdbId متشارك - أُلغي الإثراء (لا نتيجة موثوقة)'
    rows.append([wid, c.get('title') or w.get('title'), c.get('year') or w.get('year'), w.get('type'),
                 reason, c.get('old_tmdbId'), c.get('new_tmdbId') or '', fp, fs])

# 3) أعمال مكرّرة حقيقية حُذفت (redirect إلى المُبقى)
for deleted, kept in (dedupe.items() if isinstance(dedupe, dict) else []):
    if deleted in seen: continue
    seen.add(deleted)
    rows.append([deleted, deleted, '', '', f'عمل مكرّر - حُذف ووُجّه (301) إلى: {kept}',
                 '', '', '', 'محذوف نهائياً'])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f)
    wr.writerow(['work_id', 'الاسم', 'السنة', 'النوع', 'سبب_التعديل',
                 'tmdbId_القديم', 'tmdbId_الجديد', 'الصورة_النهائية', 'الحالة_النهائية'])
    for r in sorted(rows, key=lambda x: (x[3] or '', x[1] or '')):
        wr.writerow(r)

# إحصائيات
from collections import Counter
reasons = Counter(r[4].split(' - ')[0] for r in rows)
print(f'✅ صُدِّر {len(rows)} عمل عُدّلت صورته إلى: reports/changed-posters.csv')
for k, v in reasons.items():
    print(f'   {k}: {v}')
