#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تصحيح ذكي: يستعيد الإثراء الأصلي من details.json للأعمال التي أُلغيت بالخطأ،
ويبقي الإلغاء فقط للحالات الحقيقية (أسماء قصيرة عامة أخذت فيلماً مشهوراً خاطئاً).

منطق القرار لكل عمل مشبوه (يشترك tmdbId مع اسم مختلف):
  - احسب مطابقة اسم العمل الأصلي (originalTitle/title) مع الاسم الرسمي في TMDB.
  - نتحقق عبر details API للـ tmdbId الحالي: هل original_name/original_title يطابق؟
  - إن طابق (>=0.4) → صحيح، أبقِه.
  - إن لم يطابق → ابحث بدقة؛ إن وُجد بديل جيد استبدله، وإلا ألغِ.
"""
import json, os, re, time, urllib.parse, urllib.request
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
            time.sleep(1.0)
    return None

def norm(t):
    t = (t or '').lower()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    t = re.sub(r'\b(the|a|an|movie|film|season|part|and|of|no|wo|ga|wa|ni|s)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def sim(a, b):
    ta, tb = set(norm(a).split()), set(norm(b).split())
    if not ta or not tb: return 0.0
    return len(ta & tb) / len(ta | tb)

def clean_query(t):
    t = re.sub(r'\([^)]*\)', '', t or '')
    return re.sub(r'\s+', ' ', t).strip()

def details_of(tmdb_id, is_tv):
    kind = 'tv' if is_tv else 'movie'
    return api(f'/{kind}/{tmdb_id}', {'language': 'ar'}) or {}

def result_from_det(work, tmdb_id, det, r=None):
    r = r or {}
    name_ar = det.get('name') or det.get('title') or ''
    return {
        'tmdbId': tmdb_id,
        'synopsis': det.get('overview') or r.get('overview') or '',
        'tagline': det.get('tagline', ''),
        'rating': det.get('vote_average') or r.get('vote_average'),
        'voteCount': det.get('vote_count') or r.get('vote_count', 0),
        'genres': [g['name'] for g in det.get('genres', [])],
        'backdrop': (BACK + det['backdrop_path']) if det.get('backdrop_path') else None,
        'tmdbPoster': (IMG + det['poster_path']) if det.get('poster_path') else None,
        'tmdbTitleAr': name_ar if re.search(r'[\u0600-\u06FF]', name_ar) else '',
        'year': work.get('year'),
        'source': 'refix2',
    }

def search_best(work):
    title = work['title']; orig = work.get('originalTitle') or title
    year = work.get('year'); is_tv = work['type'] in ('series', 'anime')
    kind = 'tv' if is_tv else 'movie'
    best = None; best_sc = 0.0
    for q in {title, clean_query(title), clean_query(orig)}:
        q = q.strip()
        if not q: continue
        params = {'query': q, 'language': 'ar', 'include_adult': 'false'}
        d = api(f'/search/{kind}', params)
        if not d or not d.get('results'): continue
        for r in d['results'][:6]:
            nm = r.get('name') or r.get('title') or ''
            on = r.get('original_name') or r.get('original_title') or ''
            sc = max(sim(title, nm), sim(title, on), sim(orig, nm), sim(orig, on), sim(q, nm), sim(q, on))
            ry = (r.get('first_air_date') or r.get('release_date') or '')[:4]
            if year and ry == str(year): sc += 0.2
            if sc > best_sc: best_sc = sc; best = r
    return best, best_sc

def main():
    details = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))
    by_tmdb = defaultdict(list)
    for w in details.values():
        if w.get('tmdbId'):
            by_tmdb[w['tmdbId']].append(w)

    def base_norm(t):
        return re.sub(r'\b(season|part|movie|ova|ona|\d+)\b', ' ', norm(t)).strip()

    suspects = []
    for tid, ws in by_tmdb.items():
        if len(ws) < 2: continue
        if len(set(base_norm(w['title']) for w in ws)) > 1:
            suspects.append((tid, ws))

    print(f'مشبوهة: {len(suspects)} مجموعة | {sum(len(w) for _,w in suspects)} عمل', flush=True)

    keep=fix=clear=0; checked=0
    for tid, ws in suspects:
        det_cur = None
        for w in ws:
            checked += 1
            is_tv = w['type'] in ('series', 'anime')
            ncache = os.path.join(NEWCACHE, w['id'] + '.json')
            # 1) تحقق: هل tmdbId الحالي يطابق اسم العمل فعلاً؟
            if det_cur is None:
                det_cur = details_of(tid, is_tv)
            cur_name = det_cur.get('original_name') or det_cur.get('original_title') or det_cur.get('name') or det_cur.get('title') or ''
            cur_ar = det_cur.get('name') or det_cur.get('title') or ''
            match_cur = max(sim(w['title'], cur_name), sim(w.get('originalTitle',''), cur_name),
                            sim(w['title'], cur_ar))
            if match_cur >= 0.34:
                # المطابقة الحالية مقبولة → أبقِ الإثراء الأصلي كما في details
                res = {
                    'tmdbId': w['tmdbId'], 'synopsis': w.get('synopsis',''), 'tagline': w.get('tagline',''),
                    'rating': w.get('rating'), 'voteCount': w.get('voteCount',0),
                    'genres': w.get('genres',[]), 'backdrop': w.get('backdrop'),
                    'tmdbPoster': w.get('tmdbPoster'), 'tmdbTitleAr': w['titleEn'] if re.search(r'[\u0600-\u06FF]',w.get('titleEn','')) else '',
                    'year': w.get('year'), 'source': 'refix2-keep',
                }
                json.dump(res, open(ncache,'w',encoding='utf-8'), ensure_ascii=False)
                keep += 1
                continue
            # 2) لا يطابق → ابحث عن بديل دقيق
            r, sc = search_best(w)
            if r and sc >= 0.5 and r['id'] != tid:
                det2 = details_of(r['id'], is_tv)
                json.dump(result_from_det(w, r['id'], det2, r), open(ncache,'w',encoding='utf-8'), ensure_ascii=False)
                fix += 1
            elif r and sc >= 0.5 and r['id'] == tid:
                # البحث أكّد نفس المعرف
                json.dump(result_from_det(w, tid, det_cur), open(ncache,'w',encoding='utf-8'), ensure_ascii=False)
                keep += 1
            else:
                json.dump({'tmdbId': None, 'source': 'refix2-cleared'}, open(ncache,'w',encoding='utf-8'), ensure_ascii=False)
                clear += 1
        if checked % 100 < len(ws):
            print(f'  … {checked} | keep {keep} fix {fix} clear {clear}', flush=True)

    print(f'\n✅ انتهى: فُحص {checked} | أُبقي {keep} | صُحّح {fix} | أُلغي {clear}')

if __name__ == '__main__':
    main()
