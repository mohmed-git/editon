#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# إثراء الأعمال بطاقم التمثيل (cast) + صنّاع العمل (creators) + مدة العرض (runtime)
# ----------------------------------------------------------------------------
# البيانات الحالية في details.json تفتقد cast/creators/runtime (كلها فارغة).
# نجلبها من TMDB لكل عمل مُثرى (له tmdbId) ونحدّث details.json + cache منفصل.
#   - الأفلام: /movie/{id}/credits + /movie/{id} (runtime)
#   - المسلسلات/الأنمي: /tv/{id}/credits + /tv/{id} (created_by, episode_run_time)
# نخزّن صور الممثلين (profile_path) لعرضها في صفحة العمل.
# cache: .import-cache/tmdb-credits/{tmdbId}-{type}.json  (لتفادي إعادة الجلب)
# ============================================================================
import os, sys, json, time, urllib.request, urllib.parse, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
CREDCACHE = os.path.join(CACHE, 'tmdb-credits')
os.makedirs(CREDCACHE, exist_ok=True)
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')

PROFILE = 'https://image.tmdb.org/t/p/w185'  # صور الممثلين (حجم مناسب للبطاقات)

def token():
    if os.environ.get('TMDB_TOKEN'): return os.environ['TMDB_TOKEN']
    try:
        t = open(os.path.join(ROOT, '.dev.vars')).read()
        m = re.search(r'TMDB_TOKEN\s*=\s*"?([^"\n]+)"?', t)
        if m: return m.group(1).strip()
    except Exception: pass
    return None

TOKEN = token()
if not TOKEN:
    print('❌ لا يوجد TMDB_TOKEN'); sys.exit(1)

def api(path, params=None):
    url = 'https://api.themoviedb.org/3' + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + TOKEN, 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.2 * (attempt + 1))
    return None

def fetch_credits(tmdb_id, is_tv):
    """يعيد dict: {cast:[{name,character,profile}], creators:[str], runtime:int|None}"""
    kind = 'tv' if is_tv else 'movie'
    # التفاصيل (runtime / created_by / episode_run_time)
    det = api(f'/{kind}/{tmdb_id}', {'language': 'ar'})
    cred = api(f'/{kind}/{tmdb_id}/credits', {'language': 'ar'})
    if not cred and not det:
        return None
    out = {'cast': [], 'creators': [], 'runtime': None}

    # طاقم التمثيل (أول 15، مرتّبين حسب order)
    cast_list = (cred or {}).get('cast', []) or []
    cast_list = sorted(cast_list, key=lambda c: c.get('order', 999))[:15]
    for c in cast_list:
        nm = (c.get('name') or '').strip()
        if not nm:
            continue
        prof = c.get('profile_path')
        out['cast'].append({
            'name': nm,
            'character': (c.get('character') or '').strip(),
            'profile': (PROFILE + prof) if prof else None,
        })

    # صنّاع العمل
    if det:
        if is_tv:
            for cb in det.get('created_by', []) or []:
                nm = (cb.get('name') or '').strip()
                if nm: out['creators'].append(nm)
            # runtime للمسلسلات: متوسط مدة الحلقة
            ert = det.get('episode_run_time') or []
            if ert:
                out['runtime'] = int(ert[0])
        else:
            out['runtime'] = det.get('runtime') or None

    # المخرج للأفلام (من طاقم العمل crew)
    if not is_tv and cred:
        for cw in cred.get('crew', []) or []:
            if cw.get('job') == 'Director':
                nm = (cw.get('name') or '').strip()
                if nm and nm not in out['creators']:
                    out['creators'].append(nm)

    return out

def main():
    details = json.load(open(DETAILS, encoding='utf-8'))
    targets = [(id, v) for id, v in details.items() if v.get('tmdbId')]
    total = len(targets)
    print(f'▶ أعمال مُثراة (لها tmdbId): {total}')

    stats = {'from_cache': 0, 'api': 0, 'updated': 0, 'no_data': 0}
    for i, (id, v) in enumerate(targets):
        tmdb_id = v['tmdbId']
        is_tv = v['type'] != 'movie'
        cache_file = os.path.join(CREDCACHE, f'{tmdb_id}-{"tv" if is_tv else "movie"}.json')

        if os.path.exists(cache_file):
            try:
                data = json.load(open(cache_file, encoding='utf-8'))
                stats['from_cache'] += 1
            except Exception:
                data = None
        else:
            data = fetch_credits(tmdb_id, is_tv)
            stats['api'] += 1
            if data is not None:
                json.dump(data, open(cache_file, 'w', encoding='utf-8'), ensure_ascii=False)
            time.sleep(0.02)  # لطف مع API

        if not data:
            stats['no_data'] += 1
            continue

        # تحديث details
        cast = data.get('cast') or []
        creators = data.get('creators') or []
        runtime = data.get('runtime')
        changed = False
        if cast and v.get('cast') != cast:
            v['cast'] = cast; changed = True
        if creators and v.get('creators') != creators:
            v['creators'] = creators; changed = True
        if runtime and v.get('runtime') != runtime:
            v['runtime'] = runtime; changed = True
        if changed:
            stats['updated'] += 1

        if (i + 1) % 500 == 0:
            print(f'  … {i+1}/{total}  (cache={stats["from_cache"]} api={stats["api"]} updated={stats["updated"]})', flush=True)
            # حفظ دوري (أمان ضد الانقطاع)
            json.dump(details, open(DETAILS, 'w', encoding='utf-8'), ensure_ascii=False)

    json.dump(details, open(DETAILS, 'w', encoding='utf-8'), ensure_ascii=False)
    print('✅ انتهى إثراء الطاقم')
    print(f'   محدّثة: {stats["updated"]} | من الكاش: {stats["from_cache"]} | استدعاءات API: {stats["api"]} | بلا بيانات: {stats["no_data"]}')

if __name__ == '__main__':
    main()
