#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
إصلاح الأعمال التي أخذت tmdbId خاطئاً (نفس المعرف لأعمال مختلفة).
المنطق:
  1) اجمع الأعمال حسب tmdbId.
  2) لكل مجموعة >1 عمل: أعد التحقق من TMDB بمطابقة صارمة (الاسم + السنة).
     - العمل الذي يطابق فعلاً يحتفظ بالإثراء.
     - العمل الذي لا يطابق: أعد بحثاً دقيقاً؛ إن فشل ألغِ الإثراء (صورة الموقع، بلا tmdbId).
  3) اكتب تصحيحات إلى .import-cache/tmdb-ai/{work_id}.json (يستبدل الخاطئ).
يستدعي TMDB فقط للأعمال المشبوهة (سريع).
"""
import json, os, re, time, sys, urllib.parse, urllib.request
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
IMG = 'https://image.tmdb.org/t/p/w500'
BACK = 'https://image.tmdb.org/t/p/w1280'

def token():
    if os.environ.get('TMDB_TOKEN'): return os.environ['TMDB_TOKEN']
    t = open(os.path.join(ROOT, '.dev.vars')).read()
    m = re.search(r'TMDB_TOKEN\s*=\s*"?([^"\n]+)"?', t)
    return m.group(1).strip() if m else None
TOKEN = token()

def api(path, params):
    url = 'https://api.themoviedb.org/3' + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN, 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception:
            if attempt == 2: return None
            time.sleep(1.0 * (attempt + 1))
    return None

def norm(t):
    """تطبيع للمقارنة: أحرف صغيرة، إزالة الرموز والكلمات الشائعة."""
    t = (t or '').lower()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    t = re.sub(r'\b(the|a|an|movie|film|season|part|and|of|no|wo|ga|wa|ni)\b', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def tokens(t):
    return set(norm(t).split())

def similar(a, b):
    """نسبة تشابه بسيطة بالكلمات (Jaccard)."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb: return 0.0
    return len(ta & tb) / len(ta | tb)

def clean_query(t):
    t = re.sub(r'\([^)]*\)', '', t or '')
    t = re.sub(r'[:\-–].*$', '', t).strip()  # قبل النقطتين/الشرطة
    return t.strip() or (t or '')

def search_strict(work):
    """بحث دقيق: يعيد أفضل نتيجة تطابق الاسم فعلاً، وإلا None."""
    title = work['title']
    year = work.get('year')
    is_tv = work['type'] in ('series', 'anime')
    kind = 'tv' if is_tv else 'movie'
    queries = [title, clean_query(title)]
    best = None; best_score = 0.0
    for q in queries:
        q = q.strip()
        if not q: continue
        for with_year in ([True, False] if year else [False]):
            params = {'query': q, 'language': 'ar', 'include_adult': 'false'}
            if with_year and year:
                params['first_air_date_year' if is_tv else 'year'] = year
            d = api(f'/search/{kind}', params)
            if not d or not d.get('results'): continue
            for r in d['results'][:5]:
                name = r.get('name') or r.get('title') or ''
                orig = r.get('original_name') or r.get('original_title') or ''
                sc = max(similar(title, name), similar(title, orig), similar(q, name), similar(q, orig))
                # مكافأة تطابق السنة
                ry = (r.get('first_air_date') or r.get('release_date') or '')[:4]
                if year and ry == str(year): sc += 0.15
                if sc > best_score:
                    best_score = sc; best = r
        if best_score >= 0.9:
            break
    return best, best_score

def build_result(work, r):
    is_tv = work['type'] in ('series', 'anime')
    kind = 'tv' if is_tv else 'movie'
    det = api(f'/{kind}/{r["id"]}', {'language': 'ar'}) or {}
    name_ar = det.get('name') or det.get('title') or ''
    return {
        'tmdbId': r['id'],
        'synopsis': det.get('overview') or r.get('overview') or '',
        'tagline': det.get('tagline', ''),
        'rating': det.get('vote_average') or r.get('vote_average'),
        'voteCount': det.get('vote_count') or r.get('vote_count', 0),
        'genres': [g['name'] for g in det.get('genres', [])],
        'backdrop': (BACK + det['backdrop_path']) if det.get('backdrop_path') else None,
        'tmdbPoster': (IMG + det['poster_path']) if det.get('poster_path') else None,
        'tmdbTitleAr': name_ar if re.search(r'[\u0600-\u06FF]', name_ar) else '',
        'year': work.get('year'),
        'source': 'api-refix',
    }

def main():
    details = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))
    # اجمع حسب tmdbId
    by_tmdb = defaultdict(list)
    for w in details.values():
        if w.get('tmdbId'):
            by_tmdb[w['tmdbId']].append(w)

    # المجموعات المشبوهة: نفس tmdbId لأعمال بأسماء أساسية مختلفة
    def base_norm(t):
        return re.sub(r'\b(season|part|movie|\d+)\b', ' ', norm(t)).strip()
    suspects = []
    for tid, ws in by_tmdb.items():
        if len(ws) < 2: continue
        bases = set(base_norm(w['title']) for w in ws)
        if len(bases) > 1:
            suspects.append((tid, ws))

    print(f'مجموعات مشبوهة: {len(suspects)}  |  أعمال متأثرة: {sum(len(w) for _,w in suspects)}', flush=True)

    fixed = 0; cleared = 0; kept = 0; checked = 0
    for tid, ws in suspects:
        # رتّب: العمل الذي يطابق اسمه TMDB الأصلي يحتفظ بالمعرف
        for w in ws:
            checked += 1
            r, score = search_strict(w)
            ncache = os.path.join(NEWCACHE, w['id'] + '.json')
            if r and score >= 0.55:
                if r['id'] == tid:
                    kept += 1
                    continue  # المطابقة صحيحة، لا تغيير
                # وجدنا مطابقة أدق مختلفة
                res = build_result(w, r)
                json.dump(res, open(ncache, 'w', encoding='utf-8'), ensure_ascii=False)
                fixed += 1
            else:
                # لا مطابقة موثوقة → ألغِ الإثراء (استخدم صورة الموقع الأصلية)
                res = {'tmdbId': None, 'source': 'refix-cleared'}
                json.dump(res, open(ncache, 'w', encoding='utf-8'), ensure_ascii=False)
                cleared += 1
        if checked % 100 < len(ws):
            print(f'  … فُحص {checked} | صُحّح {fixed} | أُلغي {cleared} | ثابت {kept}', flush=True)

    print(f'\n✅ انتهى: فُحص {checked} | صُحّح {fixed} | أُلغي {cleared} | ثابت {kept}')

if __name__ == '__main__':
    main()
