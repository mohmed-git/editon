#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 4: بناء كل ملفات بيانات الموقع من الكتالوج المدموج + إثراء TMDB.
المدخلات:
  .import-cache/catalog-merged.json      (9931 عمل بمواسم متعددة)
  .import-cache/tmdb-ai/{work_id}.json   (إثراء TMDB لكل عمل)
  .import-cache/work-redirects.json      (dedup redirects)
  .import-cache/franchise-redirects.json (franchise merge redirects)
المخرجات:
  src/data/titles.json, details.json, search-index.json, categories.json,
           home.json, stats.json, sitemap-index.json, redirects.json
  public/data/search-index.json
  public/data/cat/meta.json, cat/{cat}-{N}.json
  public/data/details/shard-XX.json  (64)
  public/data/episodes/shard-XX.json (64)
  public/data/similar-{movie,series,anime}.json
"""
import json, os, re, glob, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, '.import-cache')
SRC_DATA = os.path.join(ROOT, 'src', 'data')
PUB_DATA = os.path.join(ROOT, 'public', 'data')

PAGE_SIZE = 60
NUM_SHARDS = 64

# ---------- أدوات ----------
def shard_of(s, n=NUM_SHARDS):
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % n

def is_valid_url(u):
    return bool(u) and isinstance(u, str) and u.startswith('http') and 'javascript:' not in u

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

def has_arabic(s):
    return bool(re.search(r'[\u0600-\u06FF]', s or ''))

# ---------- تحميل الكتالوج ----------
print('تحميل catalog-merged.json ...')
catalog = json.load(open(os.path.join(CACHE, 'catalog-merged.json'), encoding='utf-8'))
print(f'  {len(catalog)} عمل')

# ---------- كشف الصور الملوّثة في الـ CSV المصدر ----------
# بعض الأعمال المختلفة تتشارك نفس صورة TMDB داخل الـ CSV نفسه (استخراج خاطئ سابق).
# نحدد صور TMDB المستخدمة في أكثر من عمل ونعتبرها "ملوّثة" فلا نعرضها لعملٍ فقد إثراءه.
_poster_users = defaultdict(list)
for _w in catalog:
    _p = _w.get('poster')
    if _p and 'image.tmdb.org' in _p:
        _poster_users[_p].append(_w.get('work_id'))
POLLUTED_POSTERS = {p for p, ws in _poster_users.items() if len(ws) > 1}
print(f'  صور TMDB ملوّثة (مشتركة في CSV): {len(POLLUTED_POSTERS)}')

# ---------- تحميل الإثراء (مصغّر في الذاكرة توفيراً للرام والسرعة) ----------
# نحمّل الحقول المستخدمة فقط من كل ملف إثراء (بدل الكائن الكامل) لتقليل الذاكرة،
# مع إبقائها في الرام لأنها تُقرأ لكل عمل (+ مصادر _merged_from) فالقراءة الكسولة
# من القرص كانت بطيئة جداً (I/O لآلاف الملفات).
print('تحميل إثراء TMDB (مصغّر) ...')
AI_DIR = os.path.join(CACHE, 'tmdb-ai')
_ENR_FIELDS = ('tmdbId', 'synopsis', 'tagline', 'rating', 'voteCount',
               'genres', 'backdrop', 'tmdbPoster', 'tmdbTitleAr', 'year')
enrich = {}
for f in glob.glob(os.path.join(AI_DIR, '*.json')):
    wid = os.path.basename(f)[:-5]
    try:
        d = json.load(open(f, encoding='utf-8'))
        enrich[wid] = {k: d.get(k) for k in _ENR_FIELDS if d.get(k) is not None}
    except Exception:
        pass
print(f'  {len(enrich)} ملف إثراء')

# ---------- تحميل إثراء الطاقم (cast/creators/runtime) من TMDB credits ----------
# الكاش مفتاحه {tmdbId}-{tv|movie}.json (ولّده enrich_credits.py). نحقنه في details
# أثناء البناء ليبقى الإثراء دائماً ومتسقاً مع أي إعادة بناء مستقبلية.
# ملاحظة ذاكرة: لا نحمّل كل ملفات الطاقم في الرام (تتجاوز حد الذاكرة مع كتالوج كبير).
# بدلاً من ذلك نبني فهرس أسماء الملفات فقط، ونقرأ الملف من القرص عند الطلب (lazy).
print('فهرسة ملفات إثراء الطاقم (credits) ...')
CREDITS_DIR = os.path.join(CACHE, 'tmdb-credits')
_credits_files = set(os.listdir(CREDITS_DIR)) if os.path.isdir(CREDITS_DIR) else set()
print(f'  {len(_credits_files)} ملف طاقم (تُقرأ عند الطلب)')

def credits_for(tmdb_id, typ):
    """يعيد {cast,creators,runtime} من كاش الطاقم أو None (قراءة كسولة من القرص)."""
    if not tmdb_id:
        return None
    kind = 'movie' if typ == 'movie' else 'tv'
    fname = f'{tmdb_id}-{kind}.json'
    if fname not in _credits_files:
        return None
    try:
        return json.load(open(os.path.join(CREDITS_DIR, fname), encoding='utf-8'))
    except Exception:
        return None

# دالة: أفضل إثراء لعمل (يشمل المصادر المدموجة)
def best_enrich(work):
    ids = [work['work_id']] + work.get('_merged_from', [])
    best = None
    for wid in ids:
        e = enrich.get(wid)
        if e and e.get('tmdbId'):
            if best is None or (e.get('voteCount', 0) > best.get('voteCount', 0)):
                best = e
    return best

# ---------- خريطة النوع ----------
TYPE_MAP = {
    'movie': 'movie', 'series': 'series', 'anime': 'anime',
    'ova': 'anime', 'ona': 'anime', 'special': 'anime',
}
def work_type(w):
    et = (w.get('entry_type') or '').lower()
    cat = (w.get('category') or '').lower()
    return TYPE_MAP.get(et) or TYPE_MAP.get(cat) or 'series'

# ---------- بناء الكائنات لكل عمل ----------
print('بناء كائنات الأعمال ...')
titles = {}          # id -> mini
details = {}         # id -> full
episodes_by_id = {}  # id -> {seasonNum: [episodes...]}
search_list = []

def pick_poster(w, e):
    """صورة العمل:
    - عند وجود إثراء صالح (tmdbId مؤكّد للعمل الصحيح): نستخدم صورة TMDB الخاصة به.
    - عند غياب الإثراء (أُلغي لأنه match خاطئ): نعود لصورة الـ CSV، لكن إن كانت
      صورة TMDB ملوّثة (مشتركة مع عمل مختلف) نُهملها (None) لتفادي عرض صورة عمل آخر.
    """
    if e and is_valid_url(e.get('tmdbPoster')):
        return e['tmdbPoster']
    p = w.get('poster')
    if p and p in POLLUTED_POSTERS:
        return None  # صورة ملوّثة بلا إثراء صالح — لا نعرض صورة خاطئة
    return p

for w in catalog:
    wid = w['work_id']
    if not wid:
        continue
    typ = work_type(w)
    e = best_enrich(w)

    title_en = (w.get('titleEn') or w.get('base_title') or wid).strip()
    # titleEn في الموقع = الاسم العربي (المعرب). أفضلية: titleAr من CSV ثم tmdbTitleAr ثم الإنجليزي
    ar_name = (w.get('titleAr') or '').strip()
    if not ar_name and e and (e.get('tmdbTitleAr') or '').strip() and has_arabic(e.get('tmdbTitleAr')):
        ar_name = e['tmdbTitleAr'].strip()
    site_titleEn = ar_name or title_en   # الحقل اسمه titleEn لكنه يحمل الاسم العربي

    poster = pick_poster(w, e)
    backdrop = (e.get('backdrop') if e else None)
    genres = (e.get('genres') if e else None) or []
    year = w.get('year') or (e.get('year') if e else None)

    # التقييم: يُخفى إن كان عدد الأصوات قليلاً (غير موثوق إحصائياً).
    # يمنع ظهور "10/10" أو "9/10" مضللة بأصوات قليلة.
    MIN_VOTES = 20
    raw_rating = (e.get('rating') if e else None)
    vote_count = (e.get('voteCount', 0) if e else 0)
    rating = raw_rating if (raw_rating is not None and vote_count >= MIN_VOTES) else None

    # عدّ الحلقات/السيرفرات
    seasons = w.get('seasons', [])
    season_count = len(seasons)
    ep_count = sum(len(s.get('episodes', [])) for s in seasons)
    total_servers = sum(len(ep.get('servers', [])) for s in seasons for ep in s.get('episodes', []))

    # titles.json
    titles[wid] = {
        'id': wid, 'type': typ, 'title': title_en, 'titleEn': site_titleEn,
        'year': year, 'rating': rating, 'poster': poster, 'backdrop': backdrop,
        'genres': genres, 'isNew': bool(w.get('is_new')),
    }

    # details.json
    details[wid] = {
        'id': wid, 'type': typ, 'tmdbId': (e.get('tmdbId') if e else None),
        'title': title_en, 'titleEn': site_titleEn,
        'originalTitle': w.get('full_title') or title_en,
        'year': year, 'rating': rating, 'voteCount': vote_count,
        'ratingSource': ('tmdb' if rating is not None else None),
        'poster': poster, 'tmdbPoster': (e.get('tmdbPoster') if e else None),
        'backdrop': backdrop, 'genres': genres, 'country': '',
        'synopsis': (e.get('synopsis', '') if e else ''),
        'tagline': (e.get('tagline', '') if e else ''),
        **(lambda cr: {
            'runtime': (cr or {}).get('runtime'),
            'cast': (cr or {}).get('cast') or [],
            'creators': (cr or {}).get('creators') or [],
        })(credits_for((e.get('tmdbId') if e else None), typ)),
        'quality': 'HD', 'language': 'مترجم',
        'seasonCount': season_count, 'episodeCount': ep_count,
        'totalValidServers': total_servers,
        'numberOfSeasons': season_count, 'numberOfEpisodes': ep_count,
        'popularity': vote_count,
        'ready': True,
        'seasons': [{'num': s['num'], 'episodes': len(s.get('episodes', []))} for s in seasons],
    }

    # episodes (كامل مع السيرفرات)
    eps_map = {}
    for s in seasons:
        snum = str(s['num'])
        arr = []
        for ep in s.get('episodes', []):
            servers = []
            for i, sv in enumerate(ep.get('servers', [])):
                if is_valid_url(sv.get('url')):
                    servers.append({'id': i + 1, 'name': sv.get('name', f'سيرفر {i+1}'), 'url': sv['url']})
            arr.append({
                'num': ep['num'],
                'name': ep.get('title') or f"الحلقة {ep['num']}",
                'synopsis': '', 'rating': None, 'voteCount': 0, 'ratingSource': None,
                'still': None, 'airDate': None, 'servers': servers,
            })
        eps_map[snum] = arr
    episodes_by_id[wid] = eps_map

    # search-index
    search_list.append({
        'id': wid, 'type': typ, 'title': title_en, 'titleEn': site_titleEn,
        'year': year, 'rating': rating, 'poster': poster, 'genres': genres,
    })

print(f'  {len(titles)} عمل مبني')

# ---------- تنظيف الصور المشتركة النهائية (Issue 2+3 — نسخة حاسمة) ----------
# القاعدة القاطعة: لا يجوز أن يتشارك عملان (بأي id مختلف) نفس صورة البوستر إطلاقاً.
# كل عمل صفحة مستقلة ويجب أن تكون له صورته الخاصة. لأي صورة مشتركة بين عدة أعمال:
#   - نُبقي البوستر لعمل واحد فقط (الأحق: الأقوى تطابقاً/العمل الأصلي).
#   - باقي الأعمال تُجرَّد من صورة TMDB وتعود لصورة CSV الأصلية إن كانت نظيفة،
#     وإلا placeholder — لا نعرض أبداً صورة عملٍ آخر.
print('تنظيف الصور المشتركة بين أعمال مختلفة (حاسم) ...')

def _strip_poster(wid):
    """جرّد العمل من صورته الحالية؛ حاول إعادته لصورة CSV النظيفة، وإلا None."""
    csv_poster = catalog_poster.get(wid)
    # صورة CSV صالحة وغير ملوّثة وغير مستخدمة سلفاً كبوستر نهائي متشارك
    if csv_poster and is_valid_url(csv_poster) and csv_poster not in POLLUTED_POSTERS \
            and csv_poster not in used_final_posters:
        new_p = csv_poster
        used_final_posters.add(csv_poster)
    else:
        new_p = None
    details[wid]['poster'] = new_p
    titles[wid]['poster'] = new_p
    if wid in search_by_id:
        search_by_id[wid]['poster'] = new_p

def _rank(wid):
    """أحقّية العمل بالاحتفاظ بالصورة المشتركة (الأعلى أولاً):
    1) من له إثراء صحيح (tmdbId != None) أولى.
    2) الاسم الأقصر (العمل الأصلي عادةً بلا لواحق: OVA/Movie 2/Season …).
    3) استقرار: الأقدم سنةً ثم id.
    """
    d = details[wid]
    has_enrich = 1 if d.get('tmdbId') is not None else 0
    title_len = len(d.get('title') or '')
    year = d.get('year') or 9999
    return (has_enrich, -title_len, -(year if isinstance(year, int) else 9999), wid)

search_by_id = {it['id']: it for it in search_list}
# خريطة صورة CSV الأصلية لكل عمل (لإعادة المجرَّدين لصورهم الأصلية)
catalog_poster = {w['work_id']: w.get('poster') for w in catalog if w.get('work_id')}
used_final_posters = set()

# ابنِ خريطة الصور النهائية
poster_map = defaultdict(list)
for wid, d in details.items():
    if d.get('poster'):
        poster_map[d['poster']].append(wid)
# احجز الصور الفريدة أصلاً كمستخدمة
for poster, wids in poster_map.items():
    if len(wids) == 1:
        used_final_posters.add(poster)

cleaned = 0
diff_tmdb_groups = 0
same_tmdb_groups = 0
for poster, wids in sorted(poster_map.items()):
    if len(wids) < 2:
        continue
    tmdb_ids = set(details[w].get('tmdbId') for w in wids)
    if len(tmdb_ids - {None}) > 1 or None in tmdb_ids:
        diff_tmdb_groups += 1
    else:
        same_tmdb_groups += 1
    # اختر صاحب الأحقية الوحيد ليبقى بالصورة، وجرّد الباقي
    keeper = max(wids, key=_rank)
    used_final_posters.add(poster)  # الصورة محجوزة للـ keeper
    for w in wids:
        if w == keeper:
            continue
        _strip_poster(w)
        cleaned += 1
print(f'  مجموعات صور مشتركة: بـ tmdbId مختلف={diff_tmdb_groups} | بنفس tmdbId={same_tmdb_groups}')
print(f'  أعمال جُرِّدت من صورة متشاركة: {cleaned}')

# فحص نهائي: تأكيد عدم بقاء أي صورة متشاركة
_final_check = defaultdict(int)
for wid, d in details.items():
    if d.get('poster'):
        _final_check[d['poster']] += 1
_still_shared = sum(1 for c in _final_check.values() if c > 1)
print(f'  صور لا تزال متشاركة بعد التنظيف: {_still_shared} (يجب أن تكون 0)')

# ---------- كتابة الملفات الأساسية ----------
print('كتابة titles/details/search-index ...')
write_json(os.path.join(SRC_DATA, 'titles.json'), titles)
write_json(os.path.join(SRC_DATA, 'details.json'), details)
write_json(os.path.join(SRC_DATA, 'search-index.json'), search_list)
write_json(os.path.join(PUB_DATA, 'search-index.json'), search_list)

# ---------- shards ----------
print('كتابة details/episodes shards ...')
# خريطة كل shard -> قائمة ids (خفيفة الذاكرة)
shard_ids = defaultdict(list)
for wid in titles:
    shard_ids[shard_of(wid)].append(wid)
# اكتب shard تلو الآخر لتقليل الذاكرة (نبني قاموس shard واحد فقط في كل مرة)
for i in range(NUM_SHARDS):
    name = f'shard-{i:02d}.json'
    ids = shard_ids.get(i, [])
    write_json(os.path.join(PUB_DATA, 'details', name), {wid: details[wid] for wid in ids})
    write_json(os.path.join(PUB_DATA, 'episodes', name), {wid: episodes_by_id[wid] for wid in ids})
# episodes لم تعد لازمة بعد كتابة الـ shards — حرّر الذاكرة
episodes_by_id.clear()

# ---------- التصنيفات cat/* ----------
print('كتابة cat/* + meta.json ...')
CAT_LABELS = {'movie': 'أفلام', 'series': 'مسلسلات', 'anime': 'أنمي'}
by_cat = defaultdict(list)
for wid, t in titles.items():
    by_cat[t['type']].append(t)

# ترتيب: الأحدث سنة ثم التقييم
def sort_key(t):
    return (-(t.get('year') or 0), -(t.get('rating') or 0))

# نظّف ملفات cat القديمة
for old in glob.glob(os.path.join(PUB_DATA, 'cat', '*.json')):
    os.remove(old)

meta = {}
for cat, items in by_cat.items():
    items.sort(key=sort_key)
    # cat item = subset من الحقول
    cat_items = [{
        'id': t['id'], 'type': t['type'], 'title': t['title'], 'titleEn': t['titleEn'],
        'year': t['year'], 'rating': t['rating'], 'poster': t['poster'],
        'backdrop': t['backdrop'], 'genres': t['genres'],
    } for t in items]
    pages = (len(cat_items) + PAGE_SIZE - 1) // PAGE_SIZE
    for p in range(pages):
        chunk = cat_items[p * PAGE_SIZE:(p + 1) * PAGE_SIZE]
        write_json(os.path.join(PUB_DATA, 'cat', f'{cat}-{p+1}.json'), chunk)
    # الأنواع والسنوات
    all_genres = []
    for t in items:
        for g in t['genres']:
            if g not in all_genres:
                all_genres.append(g)
    all_years = sorted({t['year'] for t in items if t.get('year')}, reverse=True)
    meta[cat] = {
        'label': CAT_LABELS.get(cat, cat), 'type': cat, 'total': len(cat_items),
        'pages': pages, 'pageSize': PAGE_SIZE, 'genres': all_genres, 'years': all_years,
    }

# trending = الأعلى تقييماً/رواجاً عبر كل الأنواع
trending = sorted(titles.values(), key=lambda t: -((t.get('rating') or 0)))[:120]
trend_items = [{
    'id': t['id'], 'type': t['type'], 'title': t['title'], 'titleEn': t['titleEn'],
    'year': t['year'], 'rating': t['rating'], 'poster': t['poster'],
    'backdrop': t['backdrop'], 'genres': t['genres'],
} for t in trending]
tp = (len(trend_items) + PAGE_SIZE - 1) // PAGE_SIZE
for p in range(tp):
    write_json(os.path.join(PUB_DATA, 'cat', f'trending-{p+1}.json'),
               trend_items[p * PAGE_SIZE:(p + 1) * PAGE_SIZE])
meta['trending'] = {'label': 'الأكثر رواجاً', 'type': 'trending', 'total': len(trend_items),
                    'pages': tp, 'pageSize': PAGE_SIZE, 'genres': [], 'years': []}
write_json(os.path.join(PUB_DATA, 'cat', 'meta.json'), meta)

# ---------- categories.json ----------
print('كتابة categories.json ...')
categories = {}
for cat in ['movie', 'series', 'anime']:
    items = sorted(by_cat[cat], key=sort_key)
    categories[cat] = {'label': CAT_LABELS.get(cat, cat), 'type': cat,
                       'items': [t['id'] for t in items]}
categories['trending'] = {'label': 'الأكثر رواجاً', 'type': 'trending',
                          'items': [t['id'] for t in trending]}
write_json(os.path.join(SRC_DATA, 'categories.json'), categories)

# ---------- home.json ----------
print('كتابة home.json ...')
def top_ids(items, n=30):
    return [t['id'] for t in sorted(items, key=sort_key)[:n]]
hero_id = trending[0]['id'] if trending else (list(titles.keys())[0])
home = {
    'hero': hero_id,
    'rows': [
        {'title': 'الأكثر رواجاً', 'slug': 'trending', 'items': [t['id'] for t in trending[:30]]},
        {'title': 'أحدث الأفلام', 'slug': 'movie', 'items': top_ids(by_cat['movie'])},
        {'title': 'أحدث المسلسلات', 'slug': 'series', 'items': top_ids(by_cat['series'])},
        {'title': 'أحدث الأنمي', 'slug': 'anime', 'items': top_ids(by_cat['anime'])},
    ],
}
write_json(os.path.join(SRC_DATA, 'home.json'), home)

# ---------- similar-*.json ----------
print('كتابة similar-* ...')
for cat in ['movie', 'series', 'anime']:
    items = sorted(by_cat[cat], key=lambda t: -((t.get('rating') or 0)))[:1200]
    sim = [{'id': t['id'], 'type': t['type'], 'title': t['title'], 'titleEn': t['titleEn'],
            'year': t['year'], 'rating': t['rating'], 'poster': t['poster']} for t in items]
    write_json(os.path.join(PUB_DATA, f'similar-{cat}.json'), sim)

# ---------- sitemap-index.json ----------
print('كتابة sitemap-index.json ...')
sitemap = [[wid, '0.5'] for wid in titles]
write_json(os.path.join(SRC_DATA, 'sitemap-index.json'), sitemap)

# ---------- stats.json ----------
print('كتابة stats.json ...')
by_type = defaultdict(int)
for t in titles.values():
    by_type[t['type']] += 1
enriched = sum(1 for wid in titles if details[wid].get('tmdbId'))
stats = {
    'totalTitles': len(titles),
    'byType': dict(by_type),
    'enriched': enriched, 'unready': 0, 'shards': NUM_SHARDS,
    'generatedAt': datetime.datetime.utcnow().isoformat() + 'Z',
}
write_json(os.path.join(SRC_DATA, 'stats.json'), stats)

# ---------- redirects.json ----------
print('كتابة redirects.json ...')
redirects = {}
for fn in ['work-redirects.json', 'franchise-redirects.json', 'dedupe-redirects.json']:
    p = os.path.join(CACHE, fn)
    if os.path.exists(p):
        redirects.update(json.load(open(p, encoding='utf-8')))
# احذف أي redirect يشير لهدف غير موجود، وحلّ السلاسل
def resolve(x, seen=None):
    seen = seen or set()
    while x in redirects and x not in seen:
        seen.add(x)
        x = redirects[x]
    return x
redirects = {k: resolve(v) for k, v in redirects.items() if resolve(v) in titles and k not in titles}
write_json(os.path.join(SRC_DATA, 'redirects.json'), redirects)

print()
print('=== تم بناء كل الملفات ===')
print(f'الأعمال      : {len(titles)}')
print(f'  أفلام      : {by_type["movie"]}')
print(f'  مسلسلات    : {by_type["series"]}')
print(f'  أنمي       : {by_type["anime"]}')
print(f'مُثرى (tmdb)  : {enriched}')
print(f'redirects    : {len(redirects)}')

