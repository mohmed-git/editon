#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
حذف الأعمال المشتبه بها (درجة >= 3) من الكتالوج المصدر — بنهج streaming موفّر للذاكرة.
النسخة الاحتياطية أُنشئت مسبقاً عبر cp (catalog-merged.before-delete.json).
يقرأ العناصر واحداً واحداً بـ ijson ويكتب المُبقى مباشرة، فلا يحمّل الملف كاملاً.
"""
import json, os, ijson

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
SRC = os.path.join(CACHE, 'catalog-merged.before-delete.json')  # المصدر الأصلي
OUT = os.path.join(CACHE, 'catalog-merged.json')                # الوجهة الجديدة

del_ids = set(json.load(open(os.path.join(CACHE, 'delete-ids.json'), encoding='utf-8')))
cands = json.load(open(os.path.join(CACHE, 'inappropriate-candidates.json'), encoding='utf-8'))
del_meta = {c['id']: c for c in cands if c['score'] >= 3}
print(f'معرّفات للحذف: {len(del_ids)}', flush=True)

removed = []
kept_count = 0
with open(SRC, 'rb') as fin, open(OUT, 'w', encoding='utf-8') as fout:
    fout.write('[')
    first = True
    for w in ijson.items(fin, 'item'):
        wid = w.get('work_id')
        if wid in del_ids:
            removed.append(wid)
            continue
        if not first:
            fout.write(',')
        json.dump(w, fout, ensure_ascii=False, separators=(',', ':'))
        first = False
        kept_count += 1
        if kept_count % 2000 == 0:
            print(f'  ... مُبقى {kept_count}', flush=True)
    fout.write(']')

print(f'✅ محذوف: {len(removed)} | متبقٍّ: {kept_count}', flush=True)

# تقرير المحذوفات
TYPE_AR = {'movie': 'فيلم', 'series': 'مسلسل', 'anime': 'أنمي'}
lines = ['# الأعمال المحذوفة (درجة اشتباه ≥ 3)', '',
         f'**الإجمالي:** {len(removed)} عمل حُذف من الكتالوج والموقع.', '',
         '| # | العمل | النوع | السنة | الدرجة | الأسباب |',
         '|---|-------|-------|-------|--------|---------|']
rows = sorted(removed, key=lambda i: -(del_meta.get(i, {}).get('score', 0)))
for i, wid in enumerate(rows, 1):
    m = del_meta.get(wid, {})
    name = m.get('title') or wid
    if m.get('titleAr') and m['titleAr'] != m.get('title'):
        name += f" ({m['titleAr']})"
    reasons = ' ؛ '.join(m.get('reasons', []))
    lines.append(f"| {i} | {name} | {TYPE_AR.get(m.get('type'), '-')} | {m.get('year') or '-'} | {m.get('score','-')} | {reasons} |")
os.makedirs(os.path.join(ROOT, 'reports'), exist_ok=True)
open(os.path.join(ROOT, 'reports', 'deleted-works.md'), 'w', encoding='utf-8').write('\n'.join(lines))
print('تقرير: reports/deleted-works.md', flush=True)
