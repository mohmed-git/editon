#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3.5: دمج كل أعمال الـ franchise في عمل واحد بمواسم متعددة.
المدخل : .import-cache/catalog-deduped.json
المخرج : .import-cache/catalog-merged.json  (عمل واحد لكل franchise)
        + .import-cache/franchise-redirects.json  (old_work_id -> canonical_work_id)
"""
import json, os, re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, '.import-cache')

def has_arabic(s):
    return bool(re.search(r'[\u0600-\u06FF]', s or ''))

def load_site_ids():
    """معرّفات الموقع الحالية لترجيح الـ canonical."""
    try:
        titles = json.load(open(os.path.join(ROOT, 'src', 'data', 'titles.json'), encoding='utf-8'))
        return set(titles.keys())
    except Exception:
        return set()

SITE_IDS = load_site_ids()

def score_work(w):
    """اختيار العمل القانوني: الأقرب للـ franchise_key، الموجود بالموقع، الأنظف slug."""
    s = 0
    wid = w.get('work_id', '')
    fk = w.get('franchise_key', '')
    if wid == fk: s += 100
    if fk and wid.startswith(fk[:15]): s += 30
    if wid in SITE_IDS: s += 50
    if not has_arabic(wid): s += 25   # slugs بدون عربي أنظف
    # الموسم الأول أولى ليكون القانوني
    nums = [se.get('num', 1) for se in w.get('seasons', [])]
    if 1 in nums: s += 15
    if w.get('year'): s += 3
    s += w.get('episodeCount', 0) * 0.01
    return s

def clean_title_en(t):
    """اسم إنجليزي نظيف بدون علامات الموسم للعمل المدموج."""
    t = re.sub(r'\s*(Season\s*\d+|S\d+|\d+(st|nd|rd|th)\s*Season)\s*:?.*$', '', t, flags=re.I)
    t = re.sub(r'\s*:\s*Arise from the Shadow.*$', '', t, flags=re.I)
    return t.strip() or t

def merge_franchise(works):
    """دمج قائمة أعمال (نفس الـ franchise) في عمل واحد بمواسم متعددة."""
    canonical = max(works, key=score_work)
    others = [w for w in works if w['work_id'] != canonical['work_id']]

    # اجمع كل المواسم من كل الأعمال، مفتاح = رقم الموسم الحقيقي
    seasons_by_num = {}
    for w in sorted(works, key=lambda x: (x.get('franchise_entry_no', 99),
                                          min([s.get('num', 1) for s in x.get('seasons', [])] or [1]))):
        for se in w.get('seasons', []):
            num = se.get('num', 1)
            if num not in seasons_by_num:
                seasons_by_num[num] = {'num': num, 'episodes': [], '_src_work': w['work_id']}
            # دمج الحلقات (تجنب تكرار رقم الحلقة)
            existing_eps = {e['num'] for e in seasons_by_num[num]['episodes']}
            for ep in se.get('episodes', []):
                if ep['num'] not in existing_eps:
                    seasons_by_num[num]['episodes'].append(ep)
                    existing_eps.add(ep['num'])

    merged_seasons = [seasons_by_num[n] for n in sorted(seasons_by_num.keys())]
    for s in merged_seasons:
        s['episodes'].sort(key=lambda e: e['num'])

    out = dict(canonical)
    out['seasons'] = merged_seasons
    out['seasonCount'] = len(merged_seasons)
    out['episodeCount'] = sum(len(s['episodes']) for s in merged_seasons)
    out['titleEn'] = clean_title_en(canonical.get('titleEn', ''))
    out['_merged_from'] = [w['work_id'] for w in others]
    return out, {w['work_id']: canonical['work_id'] for w in others}

def main():
    d = json.load(open(os.path.join(CACHE, 'catalog-deduped.json'), encoding='utf-8'))
    fk = defaultdict(list)
    for w in d:
        fk[w.get('franchise_key') or w['work_id']].append(w)

    merged = []
    redirects = {}
    n_merged_franchises = 0
    for k, works in fk.items():
        if len(works) == 1:
            w = dict(works[0])
            w['seasonCount'] = len(w.get('seasons', []))
            w['episodeCount'] = sum(len(s['episodes']) for s in w.get('seasons', []))
            merged.append(w)
        else:
            m, red = merge_franchise(works)
            merged.append(m)
            redirects.update(red)
            n_merged_franchises += 1

    json.dump(merged, open(os.path.join(CACHE, 'catalog-merged.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)
    json.dump(redirects, open(os.path.join(CACHE, 'franchise-redirects.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    print(f'input works        : {len(d)}')
    print(f'output works       : {len(merged)}')
    print(f'franchises merged  : {n_merged_franchises}')
    print(f'redirects (old->new): {len(redirects)}')
    multi = [w for w in merged if w['seasonCount'] > 1]
    print(f'multi-season works : {len(multi)}')
    # فحص Solo Leveling
    sl = [w for w in merged if 'solo leveling' in w.get('titleEn','').lower()]
    for w in sl:
        print('SOLO:', w['work_id'], '| titleEn:', w['titleEn'],
              '| seasons:', [s['num'] for s in w['seasons']],
              '| merged_from:', w.get('_merged_from'))

if __name__ == '__main__':
    main()
