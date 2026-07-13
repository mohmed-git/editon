#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# المرحلة 2: دمج سيرفرات topcinemaa في الكتالوج (موفّر للذاكرة).
# يقرأ الملف المفروز _csv_servers_sorted.tsv مجموعةً بمجموعة (كل عمل معاً)،
# ويدمج في .import-cache/catalog-merged.json حسب قواعد المستخدم:
#   1) لا نحذف أي سيرفر موجود.
#   2) نفس المضيف (host_key) => نستبدل الرابط بالأحدث.
#   3) مضيف جديد => نضيف سيرفراً جديداً.
#   4) الأعمال غير الموجودة => تُحفظ في topcinema-new-works.json لإثرائها لاحقاً.
# لا يحمّل الـ CSV كاملاً في الرام؛ فقط الكتالوج (~36MB) + مجموعة عمل واحد.
# ============================================================================
import os, sys, json, re, unicodedata, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
CATALOG = os.path.join(CACHE, 'catalog-merged.json')
SERVERS_SORTED = os.path.join(CACHE, '_csv_servers_sorted.tsv')
META_FILE = os.path.join(CACHE, '_csv_meta.tsv')
NEW_WORKS_OUT = os.path.join(CACHE, 'topcinema-new-works.json')

KIND_MAP = {'مسلسل': 'series', 'فيلم': 'movie', 'انمي': 'anime', 'أنمي': 'anime'}


def norm_name(s):
    s = (s or '').strip().lower()
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def root_host_from_url(url):
    # للمطابقة مع سيرفرات الموقع الموجودة (نفس منطق csv_extract)
    from urllib.parse import urlparse, unquote
    SUB_STRIP = {'www', 'down', 'embed', 'play', 'player', 'stream', 'watch',
                 'video', 'cdn', 's1', 's2', 's3', 'vip', 'new', 'get', 'go',
                 'e', 'd', 'v', 'm', 'mobile', 'api'}
    try:
        u = (url or '').strip()
        if 'play.php?to=' in u:
            u = unquote(u.split('play.php?to=', 1)[1])
            if not u.startswith('http'):
                u = 'https://' + u
        if '//' not in u:
            u = 'http://' + u
        host = urlparse(u).netloc.lower().split(':')[0]
        if not host:
            return ''
        parts = host.split('.')
        while len(parts) > 2 and parts[0] in SUB_STRIP:
            parts = parts[1:]
        rh = parts[-2] if len(parts) >= 2 else parts[0]
        if rh in ('topcinemaa', 'topcinema'):
            return ''
        return rh
    except Exception:
        return ''


def norm_player(p):
    return re.sub(r'[^a-z0-9]+', '', (p or '').strip().lower())


def existing_server_key(name, url):
    rh = root_host_from_url(url)
    if rh:
        return rh
    return norm_player(name)


def main():
    print('تحميل الكتالوج ...', flush=True)
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    print(f'  {len(catalog)} عمل', flush=True)

    # فهرس الأعمال: (type, norm_name) و norm_name فقط
    by_key = {}
    by_name = {}
    for w in catalog:
        typ = w.get('category') or w.get('entry_type') or ''
        typ = KIND_MAP.get(typ, typ)
        for nm in (w.get('base_title'), w.get('titleEn'), w.get('full_title')):
            k = norm_name(nm)
            if k:
                by_key.setdefault((typ, k), w)
                by_name.setdefault(k, w)

    # تحميل meta الأعمال (صغير)
    meta = {}  # (nk, kind) -> dict
    with open(META_FILE, encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) < 7:
                p += [''] * (7 - len(p))
            nk, kind, is_series, rating, poster, page_url, title = p[:7]
            meta[(nk, kind)] = {'is_series': is_series, 'rating': rating,
                                'poster': poster, 'page_url': page_url, 'title': title}

    stats = collections.Counter()
    new_works = []

    def index_episodes(w):
        idx = {}
        for s in w.get('seasons', []):
            for ep in s.get('episodes', []):
                idx[(int(s['num']), int(ep['num']))] = ep
        return idx

    def find_work(nk, kind):
        typ = KIND_MAP.get(kind, None)
        if typ and (typ, nk) in by_key:
            return by_key[(typ, nk)]
        if nk in by_name:
            return by_name[nk]
        return None

    # ---- معالجة مجموعة عمل واحد ----
    def process_group(nk, kind, rows):
        # rows: قائمة (season, episode, host_key, player, url)
        w = find_work(nk, kind)
        if w is None:
            stats['new_works'] += 1
            # جمّع الحلقات
            eps = {}
            for season, episode, hk, player, url in rows:
                d = eps.setdefault(f'{season}|{episode}', {})
                d[hk] = {'name': player, 'url': url}  # آخر رابط لكل مضيف
            m = meta.get((nk, kind), {})
            new_works.append({
                'kind': kind, 'name_norm': nk,
                'title': m.get('title', ''), 'page_url': m.get('page_url', ''),
                'rating': m.get('rating', ''), 'poster': m.get('poster', ''),
                'is_series': m.get('is_series', ''),
                'episodes': {k: list(v.values()) for k, v in eps.items()},
            })
            return

        stats['matched_works'] += 1
        ep_index = index_episodes(w)
        season_map = {int(s['num']): s for s in w.get('seasons', [])}

        # جمّع سيرفرات CSV لكل (موسم,حلقة): آخر رابط لكل مضيف
        by_ep = {}
        for season, episode, hk, player, url in rows:
            by_ep.setdefault((season, episode), {})[hk] = {'name': player, 'url': url}

        for (season, episode), players in by_ep.items():
            ep = ep_index.get((season, episode))
            if ep is None:
                if season not in season_map:
                    new_s = {'num': season, 'episodes': []}
                    w.setdefault('seasons', []).append(new_s)
                    season_map[season] = new_s
                ep = {'num': episode, 'title': f'الحلقة {episode}', 'servers': []}
                season_map[season]['episodes'].append(ep)
                ep_index[(season, episode)] = ep
                stats['new_episodes'] += 1

            existing = {}
            for sv in ep.get('servers', []):
                existing[existing_server_key(sv.get('name', ''), sv.get('url', ''))] = sv

            for hk, sv_new in players.items():
                if hk in existing:
                    old = existing[hk]
                    if old.get('url') != sv_new['url']:
                        old['url'] = sv_new['url']
                        stats['replaced'] += 1
                    else:
                        stats['unchanged'] += 1
                else:
                    ep.setdefault('servers', []).append(
                        {'name': sv_new['name'], 'url': sv_new['url']})
                    existing[hk] = ep['servers'][-1]
                    stats['added'] += 1

        w['seasonCount'] = len(w.get('seasons', []))
        w['episodeCount'] = sum(len(s.get('episodes', [])) for s in w.get('seasons', []))

    # ---- قراءة الملف المفروز مجموعة بمجموعة ----
    print('دمج السيرفرات (streaming) ...', flush=True)
    cur_key = None  # (nk, kind)
    buf = []
    processed = 0
    with open(SERVERS_SORTED, encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) < 7:
                continue
            nk, kind, season, episode, hk, player, url = p[:7]
            try:
                season = int(season); episode = int(episode)
            except Exception:
                season, episode = 1, 1
            key = (nk, kind)
            if cur_key is not None and key != cur_key:
                process_group(cur_key[0], cur_key[1], buf)
                processed += 1
                if processed % 1000 == 0:
                    print(f'  ... {processed} عمل معالَج', flush=True)
                buf = []
            cur_key = key
            buf.append((season, episode, hk, player, url))
    if cur_key is not None and buf:
        process_group(cur_key[0], cur_key[1], buf)
        processed += 1

    print('حفظ الكتالوج المحدّث ...', flush=True)
    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(new_works, open(NEW_WORKS_OUT, 'w', encoding='utf-8'), ensure_ascii=False)

    print('\n=== تقرير الدمج ===')
    print(f'  مجموعات معالَجة          : {processed}')
    print(f'  أعمال موجودة طوبقت       : {stats["matched_works"]}')
    print(f'  أعمال جديدة (مؤجّلة)      : {stats["new_works"]}')
    print(f'  سيرفرات مُستبدلة (نفس مضيف): {stats["replaced"]}')
    print(f'  سيرفرات جديدة أُضيفت      : {stats["added"]}')
    print(f'  سيرفرات بلا تغيير         : {stats["unchanged"]}')
    print(f'  حلقات جديدة لأعمال موجودة  : {stats["new_episodes"]}')
    print(f'  الأعمال الجديدة محفوظة في  : {NEW_WORKS_OUT}')


if __name__ == '__main__':
    main()
