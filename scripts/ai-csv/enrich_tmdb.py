#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
المرحلة 2: إثراء الكتالوج من TMDB.
- يعيد استخدام الـ cache الموجود (.import-cache/tmdb, tmdb-movies) قدر الإمكان.
- يستدعي TMDB API للأعمال الناقصة (بالاسم الإنجليزي + السنة).
- يجلب: القصة، التقييم، backdrop، الأنواع، الاسم الرسمي (عربي/إنجليزي).
- يصلح الصور المكررة (أعمال مختلفة بنفس الصورة).
المدخل: .import-cache/catalog-deduped.json
المخرج: .import-cache/catalog-enriched.json
يعمل تدريجياً ويحفظ cache جديد في .import-cache/tmdb-ai/
"""
import json, os, re, time, sys, urllib.parse, urllib.request
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
IN = os.path.join(CACHE, 'catalog-light.json')
OUT = os.path.join(CACHE, 'catalog-enriched.json')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
os.makedirs(NEWCACHE, exist_ok=True)

def token():
    if os.environ.get('TMDB_TOKEN'): return os.environ['TMDB_TOKEN']
    try:
        t = open(os.path.join(ROOT, '.dev.vars')).read()
        m = re.search(r'TMDB_TOKEN\s*=\s*"?([^"\n]+)"?', t)
        if m: return m.group(1).strip()
    except: pass
    return None

TOKEN = token()
IMG = 'https://image.tmdb.org/t/p/w500'
BACK = 'https://image.tmdb.org/t/p/w1280'

def api(path, params):
    url = 'https://api.themoviedb.org/3' + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + TOKEN, 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None

def safe_slug(s):
    return re.sub(r'[^a-z0-9\-]+', '-', (s or '').lower()).strip('-')[:80]

# --------- تحميل الـ cache القديم بفهرسة مرنة ---------
def load_old_cache():
    idx_by_slug = {}
    for folder in ['tmdb', 'tmdb-movies']:
        p = os.path.join(CACHE, folder)
        if not os.path.isdir(p): continue
        for fn in os.listdir(p):
            if not fn.endswith('.json'): continue
            slug = fn[:-5]
            idx_by_slug[slug] = os.path.join(p, fn)
    return idx_by_slug

OLD = load_old_cache()

def normalize_query(t):
    t = re.sub(r'\([^)]*\)', ' ', t or '')
    t = re.sub(r'\bseason\s*\d+\b|\bs\d+\b|\bpart\s*\d+\b', ' ', t, flags=re.I)
    return re.sub(r'\s{2,}', ' ', t).strip()

def genres_ar_from(g):
    return g if isinstance(g, list) else []

def search_tmdb(query, year, is_tv):
    if not query: return None
    kind = 'tv' if is_tv else 'movie'
    params = {'query': query, 'language': 'ar', 'include_adult': 'false'}
    if year:
        params['first_air_date_year' if is_tv else 'year'] = year
    d = api(f'/search/{kind}', params)
    if not d or not d.get('results'):
        # جرّب بدون سنة
        params.pop('first_air_date_year', None); params.pop('year', None)
        d = api(f'/search/{kind}', params)
    if not d or not d.get('results'):
        return None
    return d['results'][0]

def details_tmdb(tmdb_id, is_tv):
    kind = 'tv' if is_tv else 'movie'
    return api(f'/{kind}/{tmdb_id}', {'language': 'ar'})

def enrich_one(w):
    """يرجّع dict إثراء أو None."""
    is_tv = w['category'] in ('series', 'anime') or w['entry_type'] in ('series', 'anime')
    # هل movie فعلاً؟
    if w['category'] == 'movie' or w['entryKind'] == 'movie':
        is_tv = False

    # 1) جرّب cache قديم بالـ work_id
    wid = w['work_id']
    hit = None
    for cand in [wid, safe_slug(w['titleEn']), safe_slug(w['base_title'])]:
        if cand in OLD:
            try:
                hit = json.load(open(OLD[cand]))
                break
            except: pass

    # 2) cache جديد
    ncache = os.path.join(NEWCACHE, wid + '.json')
    if os.path.exists(ncache):
        try:
            return json.load(open(ncache))
        except: pass

    result = None
    # احترم الـ cache السالب من الملف القديم (notFound) لتجنّب استدعاء API مكرر
    if hit and (hit.get('notFound') or hit.get('found') is False):
        result = {'tmdbId': None, 'source': 'cache-notfound'}
        json.dump(result, open(ncache, 'w', encoding='utf-8'), ensure_ascii=False)
        return result
    if hit and hit.get('found', True) and (hit.get('tmdbId') or hit.get('overview') or hit.get('synopsis')):
        # استعمل الـ cache القديم
        result = {
            'tmdbId': hit.get('tmdbId'),
            'synopsis': hit.get('overview') or hit.get('synopsis') or '',
            'tagline': hit.get('tagline', ''),
            'rating': hit.get('rating'),
            'voteCount': hit.get('voteCount', 0),
            'genres': genres_ar_from(hit.get('genres')),
            'backdrop': hit.get('backdrop') or None,
            'tmdbPoster': hit.get('poster') or None,
            'tmdbTitleAr': hit.get('title') if re.search(r'[\u0600-\u06FF]', hit.get('title','')) else '',
            'year': hit.get('year') or w.get('year'),
            'source': 'cache',
        }
    else:
        # 3) استدعاء API
        q = normalize_query(w['titleEn']) or normalize_query(w['base_title'])
        res = search_tmdb(q, w.get('year'), is_tv)
        if not res and is_tv:
            res = search_tmdb(q, w.get('year'), False)  # جرّب فيلم
        if res:
            tmdb_id = res.get('id')
            det = details_tmdb(tmdb_id, is_tv) or {}
            name_ar = det.get('name') or det.get('title') or ''
            result = {
                'tmdbId': tmdb_id,
                'synopsis': det.get('overview') or res.get('overview') or '',
                'tagline': det.get('tagline', ''),
                'rating': det.get('vote_average') or res.get('vote_average'),
                'voteCount': det.get('vote_count') or res.get('vote_count', 0),
                'genres': [g['name'] for g in det.get('genres', [])],
                'backdrop': (BACK + det['backdrop_path']) if det.get('backdrop_path') else None,
                'tmdbPoster': (IMG + det['poster_path']) if det.get('poster_path') else None,
                'tmdbTitleAr': name_ar if re.search(r'[\u0600-\u06FF]', name_ar) else '',
                'year': w.get('year'),
                'source': 'api',
            }
        else:
            result = {'tmdbId': None, 'source': 'notfound'}

    json.dump(result, open(ncache, 'w', encoding='utf-8'), ensure_ascii=False)
    return result

def main():
    if not TOKEN:
        print('❌ لا يوجد TMDB_TOKEN'); sys.exit(1)
    works = json.load(open(IN))
    start = int(os.environ.get('START', 0))
    end = int(os.environ.get('END', len(works)))
    print(f'إثراء الأعمال [{start}:{end}] من {len(works)}', flush=True)
    api_calls = 0
    for i in range(start, min(end, len(works))):
        w = works[i]
        r = enrich_one(w)
        if r and r.get('source') == 'api':
            api_calls += 1
        if (i - start + 1) % 200 == 0:
            print(f'  … {i-start+1} عمل (استدعاءات API: {api_calls})', flush=True)
    print(f'✅ انتهى النطاق. استدعاءات API جديدة: {api_calls}', flush=True)

if __name__ == '__main__':
    main()
