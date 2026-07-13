#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
دمج/إزالة الأعمال المكرَّرة حقيقةً (نفس tmdbId + نفس الاسم المطبّع + نفس النوع).
لكل مجموعة مكرَّرة: نُبقي النسخة الأغنى (الأكثر سيرفرات ثم حلقات)، ونحذف الباقي
من الكتالوج المصدر، مع إضافة redirect (301) من المحذوف إلى المُبقى حتى لا تُكسر روابط.

يعمل بأسلوب streaming (ijson) على catalog-merged.json لتفادي استهلاك الذاكرة.
يقرأ الأحقيّة من src/data/details.json (المبني) الذي يحوي totalValidServers/episodeCount.
"""
import json, os, re, ijson
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
SRC = os.path.join(CACHE, 'catalog-merged.json')
BACKUP = os.path.join(CACHE, 'catalog-merged.before-dedupe.json')
REDIR_EXTRA = os.path.join(CACHE, 'dedupe-redirects.json')

def norm(s):
    s = (s or '').lower()
    s = re.sub(r'[^a-z0-9\u0600-\u06FF]', ' ', s)
    s = re.sub(r'\b(the|a|an|movie|film|part|directors|director|cut|s|tv)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def main():
    det = json.load(open(DETAILS, encoding='utf-8'))

    # جمّع حسب (tmdbId, type)
    by = defaultdict(list)
    for wid, w in det.items():
        tid = w.get('tmdbId')
        if tid:
            by[(tid, w.get('type'))].append(wid)

    del_ids = {}         # wid_محذوف -> wid_مُبقى (لعمل redirect)
    groups_log = []
    for (tid, typ), wids in by.items():
        if len(wids) < 2:
            continue
        # داخل نفس tmdbId: جمّع حسب الاسم المطبّع — نفس الاسم = تكرار حقيقي
        nb = defaultdict(list)
        for wid in wids:
            nb[norm(det[wid].get('title'))].append(wid)
        for n, g in nb.items():
            if len(g) < 2:
                continue
            # الأحقيّة: الأكثر سيرفرات ثم حلقات ثم أطول id (أوصف)
            def rich(wid):
                w = det[wid]
                return (w.get('totalValidServers', 0), w.get('episodeCount', 0), len(wid))
            keeper = max(g, key=rich)
            for wid in g:
                if wid != keeper:
                    del_ids[wid] = keeper
            groups_log.append({
                'tmdbId': tid, 'type': typ, 'title': det[keeper].get('title'),
                'keep': keeper, 'removed': [w for w in g if w != keeper],
            })

    print(f'مجموعات تكرار حقيقي: {len(groups_log)}')
    print(f'أعمال ستُحذف: {len(del_ids)}')
    if not del_ids:
        print('لا يوجد تكرار حقيقي — لا تغيير.')
        return

    # نسخة احتياطية
    if not os.path.exists(BACKUP):
        os.rename(SRC, BACKUP)
    else:
        # SRC قد يكون محدَّثاً؛ استخدمه كمصدر واحذف فقط
        os.replace(SRC, BACKUP)

    removed = []
    kept = 0
    with open(BACKUP, 'rb') as fin, open(SRC, 'w', encoding='utf-8') as fout:
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
            kept += 1
        fout.write(']')

    # احفظ خريطة إعادة التوجيه (slug المحذوف -> slug المُبقى) لدمجها في redirects
    json.dump(del_ids, open(REDIR_EXTRA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # تقرير
    report = os.path.join(ROOT, 'reports', 'deduped-works.md')
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, 'w', encoding='utf-8') as f:
        f.write('# الأعمال المكرَّرة المدموجة\n\n')
        f.write(f'**الإجمالي:** {len(del_ids)} نسخة مكررة حُذفت (أُبقيت النسخة الأغنى) مع redirect 301.\n\n')
        for g in sorted(groups_log, key=lambda x: x['type']):
            f.write(f"- **{g['title']}** ({g['type']}) — أُبقي: `{g['keep']}` | حُذف: {', '.join('`'+r+'`' for r in g['removed'])}\n")

    print(f'✅ حُذف: {len(removed)} | متبقٍّ في الكتالوج: {kept}')
    print(f'خريطة redirect: {REDIR_EXTRA}')
    print(f'تقرير: reports/deduped-works.md')

if __name__ == '__main__':
    main()
