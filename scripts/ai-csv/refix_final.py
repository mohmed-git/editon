#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
التصحيح النهائي (بلا استدعاء API، يعتمد على catalog + details):
المبدأ: عملان يشتركان نفس tmdbId:
  - إن كان أحدهما امتداداً للآخر (نفس السلسلة: base_title متطابق، أو أحدهما بادئة الآخر،
    أو نفس franchise) → مرتبطان فعلاً، أبقِ الإثراء (طبيعي أن يشترك الفيلم/OVA صورة السلسلة).
  - إن كانا مختلفين جذرياً (Ash فيلم رعب vs Avatar) → أعمال منفصلة أخذت match خاطئاً.
    نحتفظ بالإثراء للأقرب اسماً/سنةً، ونلغيه للبقية (تعود لصورة الموقع الأصلية).
يستعيد الإثراء الأصلي من details.json (لم يُعد بناؤه بعد).
"""
import json, os, re
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')

def strip_prefix(t):
    return re.sub(r'^\s*(فيلم|اوفا|أوفا|اونا|أونا|الحلقة الخاصة|ova|ona|movie|special)\s+', '', (t or ''), flags=re.I).strip()

def norm(t):
    t = strip_prefix(t)
    t = t.lower()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    t = re.sub(r'\b(the|a|an|movie|film|season|part|ova|ona|special|and|of|no|wo|ga|wa|ni|s|kai|hen|episode|ep)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def base_key(t):
    """المفتاح الجوهري: أول 2-3 كلمات مميزة."""
    n = norm(t)
    return ' '.join(n.split()[:3])

def related(a, b):
    """هل العملان من نفس السلسلة؟"""
    na, nb = norm(a), norm(b)
    if not na or not nb: return False
    if na == nb: return True
    if na.startswith(nb) or nb.startswith(na): return True
    ta, tb = set(na.split()), set(nb.split())
    # تقاطع كبير في الكلمات المميزة
    if len(ta & tb) >= 2 and len(ta & tb) / min(len(ta), len(tb)) >= 0.6:
        return True
    # نفس أول كلمتين مميزتين
    if base_key(a) == base_key(b) and len(base_key(a).split()) >= 2:
        return True
    return False

def restore_enrich(w):
    return {
        'tmdbId': w['tmdbId'], 'synopsis': w.get('synopsis',''), 'tagline': w.get('tagline',''),
        'rating': w.get('rating'), 'voteCount': w.get('voteCount',0),
        'genres': w.get('genres',[]), 'backdrop': w.get('backdrop'),
        'tmdbPoster': w.get('tmdbPoster'),
        'tmdbTitleAr': w['titleEn'] if re.search(r'[\u0600-\u06FF]', w.get('titleEn','')) else '',
        'year': w.get('year'), 'source': 'refix-final-keep',
    }

def main():
    details = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))
    by_tmdb = defaultdict(list)
    for w in details.values():
        if w.get('tmdbId'):
            by_tmdb[w['tmdbId']].append(w)

    keep=clear=single=0
    groups_split=0
    for tid, ws in by_tmdb.items():
        if len(ws) == 1:
            # عمل وحيد بهذا المعرف → أعد كتابته كما هو (استعادة أصلية)
            w = ws[0]
            json.dump(restore_enrich(w), open(os.path.join(NEWCACHE, w['id']+'.json'),'w',encoding='utf-8'), ensure_ascii=False)
            single += 1
            continue
        # مجموعة تشترك المعرف: قسّمها لعناقيد "مترابطة"
        clusters = []  # كل عنصر: list of works
        for w in ws:
            placed = False
            for cl in clusters:
                if any(related(w['title'], x['title']) or related(w.get('originalTitle',''), x.get('originalTitle','')) for x in cl):
                    cl.append(w); placed = True; break
            if not placed:
                clusters.append([w])

        if len(clusters) == 1:
            # كلها مترابطة (نفس السلسلة) → أبقِ الإثراء للجميع
            for w in ws:
                json.dump(restore_enrich(w), open(os.path.join(NEWCACHE, w['id']+'.json'),'w',encoding='utf-8'), ensure_ascii=False)
                keep += 1
        else:
            # عناقيد متعددة = أعمال مختلفة أخذت نفس المعرف خطأً.
            groups_split += 1
            # اختر العنقود الأحق بالمعرف: الأكبر، ثم الأكثر أصواتاً
            clusters.sort(key=lambda cl: (len(cl), sum(x.get('voteCount',0) for x in cl)), reverse=True)
            winner = clusters[0]
            for w in winner:
                json.dump(restore_enrich(w), open(os.path.join(NEWCACHE, w['id']+'.json'),'w',encoding='utf-8'), ensure_ascii=False)
                keep += 1
            for cl in clusters[1:]:
                for w in cl:
                    json.dump({'tmdbId': None, 'source': 'refix-final-cleared'},
                              open(os.path.join(NEWCACHE, w['id']+'.json'),'w',encoding='utf-8'), ensure_ascii=False)
                    clear += 1

    print(f'✅ انتهى')
    print(f'  عمل وحيد بالمعرف (استعادة): {single}')
    print(f'  مجموعات فُصلت (أعمال مختلفة): {groups_split}')
    print(f'  أُبقي الإثراء: {keep}')
    print(f'  أُلغي (سيعود لصورة الموقع): {clear}')

if __name__ == '__main__':
    main()
