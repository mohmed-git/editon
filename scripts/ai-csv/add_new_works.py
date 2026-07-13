#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# إضافة الأعمال الجديدة من topcinemaa إلى الكتالوج + إثراؤها من TMDB.
# ----------------------------------------------------------------------------
# القواعد (حسب طلب المستخدم):
#  - نضيف كل الأعمال الجديدة، لكن فقط إن كانت "أعمالاً حقيقية" (مؤكَّدة على TMDB).
#  - نستخرج الصورة/القصة/التقييم/الطاقم من TMDB مثل الإثراءات السابقة.
#
# المدخلات:
#  .import-cache/topcinema-new-works.json     (الأعمال الجديدة + سيرفراتها)
# المخرجات:
#  .import-cache/catalog-merged.json          (تُضاف إليه الأعمال الحقيقية)
#  .import-cache/tmdb-ai/{work_id}.json        (إثراء لكل عمل — يلتقطه build_site_data)
#  .import-cache/tmdb-credits/{tmdbId}-{tv|movie}.json (الطاقم)
#  .import-cache/newworks-tmdb-cache.json      (كاش نتائج البحث — للاستئناف)
#  .import-cache/newworks-report.json          (تقرير)
#
# قابل للاستئناف: يتخطّى الأعمال التي كُتب لها work_id في الكتالوج مسبقاً.
# ============================================================================
import os, sys, json, time, re, unicodedata, urllib.request, urllib.parse, difflib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_new_titles import parse_title  # noqa

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
CATALOG = os.path.join(CACHE, 'catalog-merged.json')
NEW_WORKS = os.path.join(CACHE, 'topcinema-new-works.json')
AI_DIR = os.path.join(CACHE, 'tmdb-ai')
CRED_DIR = os.path.join(CACHE, 'tmdb-credits')
SEARCH_CACHE = os.path.join(CACHE, 'newworks-tmdb-cache.json')
REPORT = os.path.join(CACHE, 'newworks-report.json')
os.makedirs(AI_DIR, exist_ok=True)
os.makedirs(CRED_DIR, exist_ok=True)

POSTER = 'https://image.tmdb.org/t/p/w500'
BACKDROP = 'https://image.tmdb.org/t/p/w1280'
PROFILE = 'https://image.tmdb.org/t/p/w185'

KIND_MAP = {'مسلسل': 'series', 'فيلم': 'movie', 'انمي': 'anime', 'أنمي': 'anime'}
CAT_LABEL = {'movie': 'فيلم', 'series': 'مسلسل', 'anime': 'أنمي'}


def token():
    if os.environ.get('TMDB_TOKEN'):
        return os.environ['TMDB_TOKEN']
    try:
        t = open(os.path.join(ROOT, '.dev.vars')).read()
        m = re.search(r'TMDB_TOKEN\s*=\s*"?([^"\n]+)"?', t)
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    return None


TOKEN = token()
if not TOKEN:
    print('❌ لا يوجد TMDB_TOKEN')
    sys.exit(1)


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
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == 2:
                return None
            time.sleep(1.0 * (attempt + 1))
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.0 * (attempt + 1))
    return None


def norm(s):
    s = (s or '').strip().lower()
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def slugify(s):
    s = (s or '').strip().lower()
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'[^\w\-\u0600-\u06FF]', '', s)
    s = re.sub(r'-{2,}', '-', s).strip('-')
    return s or 'x'


def similar(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    seq = difflib.SequenceMatcher(None, na, nb).ratio()
    # تشابه على مستوى الكلمات (يتحمّل اختلاف الترتيب/كلمات زائدة)
    sa, sb = set(na.split()), set(nb.split())
    if sa and sb:
        jacc = len(sa & sb) / len(sa | sb)
        # احتواء كامل لاسم أحدهما داخل الآخر مؤشّر قوي
        contain = 1.0 if (sa <= sb or sb <= sa) else 0.0
        return max(seq, jacc, contain * 0.9)
    return seq


def tmdb_search(eng, typ, year):
    """يبحث في TMDB ويعيد أفضل تطابق (dict نتيجة) أو None إن لم يكن عملاً حقيقياً."""
    if not eng:
        return None
    is_tv = typ in ('series', 'anime')
    endpoint = '/search/tv' if is_tv else '/search/movie'
    params = {'query': eng, 'language': 'ar', 'include_adult': 'false'}
    if year and not is_tv:
        params['year'] = year
    res = api(endpoint, params)
    results = (res or {}).get('results') or []
    if not results and is_tv:
        # جرّب البحث كفيلم أحياناً الأنمي/المسلسل مصنّف خطأ
        res2 = api('/search/movie', {'query': eng, 'language': 'ar'})
        results = (res2 or {}).get('results') or []
        if results:
            is_tv = False
    if not results:
        return None
    # اختر الأفضل: تطابق اسم عالٍ + قرب السنة
    def score(r):
        name = r.get('name') or r.get('title') or ''
        orig = r.get('original_name') or r.get('original_title') or ''
        sc = max(similar(eng, name), similar(eng, orig))
        rd = (r.get('first_air_date') or r.get('release_date') or '')[:4]
        if year and rd.isdigit():
            diff = abs(int(rd) - year)
            sc += 0.15 if diff == 0 else (0.05 if diff <= 1 else -0.1 * min(diff, 5))
        sc += min(r.get('popularity', 0), 50) / 500.0  # ترجيح خفيف للشهرة
        return sc
    best = max(results, key=score)
    name = best.get('name') or best.get('title') or ''
    orig = best.get('original_name') or best.get('original_title') or ''
    nm_sim = max(similar(eng, name), similar(eng, orig))
    # عتبة القبول: تطابق اسم معقول = عمل حقيقي
    if nm_sim < 0.6:
        return None
    best['_is_tv'] = is_tv
    return best


def genre_names(ids, is_tv):
    return [_GENRES.get(g, '') for g in (ids or []) if _GENRES.get(g)]


_GENRES = {}


def load_genres():
    for is_tv in (True, False):
        r = api('/genre/tv/list' if is_tv else '/genre/movie/list', {'language': 'ar'})
        for g in (r or {}).get('genres', []) or []:
            _GENRES[g['id']] = g['name']


def fetch_credits(tmdb_id, is_tv):
    kind = 'tv' if is_tv else 'movie'
    cache_file = os.path.join(CRED_DIR, f'{tmdb_id}-{kind}.json')
    if os.path.exists(cache_file):
        try:
            return json.load(open(cache_file, encoding='utf-8'))
        except Exception:
            pass
    det = api(f'/{kind}/{tmdb_id}', {'language': 'ar'})
    cred = api(f'/{kind}/{tmdb_id}/credits', {'language': 'ar'})
    out = {'cast': [], 'creators': [], 'runtime': None}
    for c in sorted((cred or {}).get('cast', []) or [], key=lambda c: c.get('order', 999))[:15]:
        nm = (c.get('name') or '').strip()
        if not nm:
            continue
        prof = c.get('profile_path')
        out['cast'].append({'name': nm, 'character': (c.get('character') or '').strip(),
                            'profile': (PROFILE + prof) if prof else None})
    if det:
        if is_tv:
            for cb in det.get('created_by', []) or []:
                nm = (cb.get('name') or '').strip()
                if nm:
                    out['creators'].append(nm)
            ert = det.get('episode_run_time') or []
            if ert:
                out['runtime'] = int(ert[0])
        else:
            out['runtime'] = det.get('runtime') or None
    if not is_tv and cred:
        for cw in cred.get('crew', []) or []:
            if cw.get('job') == 'Director':
                nm = (cw.get('name') or '').strip()
                if nm and nm not in out['creators']:
                    out['creators'].append(nm)
    json.dump(out, open(cache_file, 'w', encoding='utf-8'), ensure_ascii=False)
    return out


def build_seasons(episodes_dict, is_movie):
    """episodes_dict: {'season|ep': [ {name,url}, ... ]} -> seasons[]"""
    smap = {}
    for k, servers in episodes_dict.items():
        try:
            s, e = k.split('|'); s = int(s); e = int(e)
        except Exception:
            s, e = 1, 1
        if is_movie:
            s, e = 1, 1
        # نظّف السيرفرات
        clean_servers = []
        seen = set()
        for i, sv in enumerate(servers):
            u = sv.get('url', '')
            if not u or u in seen:
                continue
            seen.add(u)
            clean_servers.append({'name': sv.get('name') or f'سيرفر {i+1}', 'url': u})
        ep = smap.setdefault(s, {})
        if e in ep:
            ep[e]['servers'].extend(clean_servers)
        else:
            ep[e] = {'num': e, 'title': f'الحلقة {e}', 'servers': clean_servers}
    seasons = []
    for s in sorted(smap):
        eps = [smap[s][e] for e in sorted(smap[s])]
        seasons.append({'num': s, 'episodes': eps})
    return seasons


def main():
    print('تحميل الكتالوج + الأعمال الجديدة ...', flush=True)
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    new_works = json.load(open(NEW_WORKS, encoding='utf-8'))
    existing_ids = {w.get('work_id') for w in catalog}
    print(f'  كتالوج: {len(catalog)} | أعمال جديدة: {len(new_works)}', flush=True)

    scache = {}
    if os.path.exists(SEARCH_CACHE):
        try:
            scache = json.load(open(SEARCH_CACHE, encoding='utf-8'))
        except Exception:
            scache = {}

    print('تحميل قوائم الأنواع من TMDB ...', flush=True)
    load_genres()

    stats = {'added': 0, 'skipped_notmdb': 0, 'skipped_noeng': 0,
             'skipped_dup': 0, 'api_calls': 0}
    added_works = []
    used_slugs = set(w.get('franchise_key') for w in catalog)

    for i, nw in enumerate(new_works):
        if i % 50 == 0:
            print(f'  [{i}/{len(new_works)}] مُضاف={stats["added"]} '
                  f'بلا_tmdb={stats["skipped_notmdb"]}', flush=True)
            json.dump(scache, open(SEARCH_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)

        kind = nw['kind']
        typ = KIND_MAP.get(kind)
        if not typ:
            # نوع "غير معروف" — نحاول تخمينه من is_series
            typ = 'series' if (nw.get('is_series', '').lower() == 'true') else 'movie'

        eng, year, season = parse_title(nw.get('title', ''), kind)
        if not eng or len(eng) < 2:
            stats['skipped_noeng'] += 1
            continue

        ckey = f'{typ}|{norm(eng)}|{year or ""}'
        if ckey in scache:
            best = scache[ckey]
        else:
            best = tmdb_search(eng, typ, year)
            stats['api_calls'] += 1
            scache[ckey] = best  # قد يكون None (نخزّن الرفض أيضاً)

        if not best:
            stats['skipped_notmdb'] += 1
            continue

        is_tv = best.get('_is_tv', typ in ('series', 'anime'))
        real_typ = typ if typ != 'movie' or not is_tv else typ
        # إن اكتشف البحث أنه فيلم رغم تصنيفه مسلسل، عدّل النوع
        if not is_tv and typ in ('series',):
            real_typ = 'movie'
        elif not is_tv and typ == 'anime':
            real_typ = 'anime'  # أنمي فيلم يبقى أنمي
        tmdb_id = best.get('id')
        tmdb_name = best.get('name') or best.get('title') or eng
        tmdb_orig = best.get('original_name') or best.get('original_title') or ''
        rd = (best.get('first_air_date') or best.get('release_date') or '')[:4]
        y = int(rd) if rd.isdigit() else year

        # work_id فريد
        base_slug = slugify(eng)
        wid = base_slug
        n = 2
        while wid in existing_ids or wid in used_slugs:
            wid = f'{base_slug}-{n}'
            n += 1
        existing_ids.add(wid)
        used_slugs.add(wid)

        # المواسم/الحلقات/السيرفرات
        is_movie = (real_typ == 'movie')
        seasons = build_seasons(nw.get('episodes', {}), is_movie)
        if not seasons:
            continue
        ep_count = sum(len(s['episodes']) for s in seasons)

        # كائن الكتالوج
        title_ar = ''  # سيأتي من الإثراء (tmdbTitleAr) عند البناء
        full_title = f'{eng}'
        work = {
            'work_id': wid,
            'franchise_key': base_slug,
            'full_title': full_title,
            'base_title': eng,
            'titleEn': tmdb_orig or eng,   # يُصحَّح لاحقاً في البناء
            'titleAr': '',
            'entry_type': real_typ,
            'entryKind': real_typ,
            'franchise_entry_no': 1,
            'category': real_typ,
            'category_label': CAT_LABEL.get(real_typ, 'مسلسل'),
            'subcategory': '', 'subcategory_label': '',
            'is_new': True,
            'year': y,
            'poster': (POSTER + best['poster_path']) if best.get('poster_path') else '',
            'seasons': seasons,
            'episodeCount': ep_count,
            'seasonCount': len(seasons),
            '_source': 'topcinema-new',
        }
        catalog.append(work)
        added_works.append(wid)
        stats['added'] += 1

        # ملف الإثراء tmdb-ai/{work_id}.json
        overview = best.get('overview') or ''
        genres = genre_names(best.get('genre_ids'), is_tv)
        ai = {
            'tmdbId': tmdb_id,
            'synopsis': overview,
            'tagline': '',
            'rating': round(best.get('vote_average') or 0, 1),
            'voteCount': best.get('vote_count') or 0,
            'genres': genres,
            'backdrop': (BACKDROP + best['backdrop_path']) if best.get('backdrop_path') else '',
            'tmdbPoster': (POSTER + best['poster_path']) if best.get('poster_path') else '',
            'tmdbTitleAr': tmdb_name if re.search(r'[\u0600-\u06FF]', tmdb_name) else '',
            'year': y,
            'source': 'topcinema-new',
        }
        json.dump(ai, open(os.path.join(AI_DIR, f'{wid}.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False)

        # الطاقم (credits) — يُخزَّن بمفتاح {tmdbId}-{tv|movie}
        fetch_credits(tmdb_id, is_tv)
        stats['api_calls'] += 2

    # حفظ
    print('حفظ الكتالوج + الكاش ...', flush=True)
    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(scache, open(SEARCH_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump({'stats': stats, 'added': added_works}, open(REPORT, 'w', encoding='utf-8'),
              ensure_ascii=False)

    print('\n=== تقرير إضافة الأعمال الجديدة ===')
    print(f'  أُضيفت (أعمال حقيقية) : {stats["added"]}')
    print(f'  تُخطّيت (لا نتيجة TMDB): {stats["skipped_notmdb"]}')
    print(f'  تُخطّيت (بلا اسم إنجليزي): {stats["skipped_noeng"]}')
    print(f'  طلبات API             : {stats["api_calls"]}')
    print(f'  إجمالي الكتالوج الآن   : {len(catalog)}')


if __name__ == '__main__':
    main()
