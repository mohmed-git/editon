#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
دمج الأعمال المكرَّرة حقيقةً التي تظهر كعملين مختلفين باسمين مختلفين لكنها نفس العمل.
المعيار الآمن (صارم — يتجنّب دمج الأجزاء/المواسم/OVA المختلفة):
    نفس tmdbId  +  نفس النوع  +  الاسم المطبّع الصارم متطابق تماماً
(بعد إزالة أدوات التعريف والبادئات الوصفية مثل
 "A Marvel Television Special Presentation").

لكل مجموعة مكرَّرة:
  - نُبقي النسخة الأغنى (الأكثر سيرفرات ثم حلقات ثم أطول id).
  - **ندمج سيرفرات النسخ المحذوفة داخل المُبقى حسب المضيف الجذري** (لا نفقد أي سيرفر،
    ولا نكرّر مضيفاً موجوداً) — مطابقاً لمنطق دمج topcinema.
  - نحذف النسخ الأخرى من الكتالوج مع redirect (301) من المحذوف إلى المُبقى.

streaming (ijson) على catalog-merged.json لتفادي استهلاك الذاكرة (قيد 985MB).
يقرأ الأحقيّة من src/data/details.json (المبني).
"""
import json, os, re, ijson
from collections import defaultdict
from urllib.parse import urlparse, unquote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
SRC = os.path.join(CACHE, 'catalog-merged.json')
BACKUP = os.path.join(CACHE, 'catalog-merged.before-dupmerge.json')
REDIR_EXTRA = os.path.join(CACHE, 'dedupe-redirects.json')

# ---------- تطبيع الاسم الصارم ----------
DESC_PREFIXES = [
    r'a marvel television special presentation',
    r'marvel television special presentation',
    r'a marvel special presentation',
]
def norm_strict(s):
    s = (s or '').lower().strip().replace('\u2013', '-').replace('\u2014', '-')
    for p in DESC_PREFIXES:
        s = re.sub(p, ' ', s)
    s = re.sub(r'[^a-z0-9\u0600-\u06FF]', ' ', s)
    s = re.sub(r'\b(the|a|an)\b', ' ', s)   # أدوات التعريف فقط — لا نلمس movie/part/ova
    return re.sub(r'\s+', ' ', s).strip()

# ---------- مطابقة السيرفرات حسب المضيف ----------
SUB_STRIP = {'www', 'down', 'embed', 'play', 'player', 'stream', 'watch',
             'video', 'cdn', 's1', 's2', 's3', 'vip', 'new', 'get', 'go',
             'e', 'd', 'v', 'm', 'mobile', 'api'}
def root_host_from_url(url):
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

def server_key(name, url):
    rh = root_host_from_url(url)
    return rh if rh else norm_player(name)


def main():
    det = json.load(open(DETAILS, encoding='utf-8'))

    # جمّع حسب (tmdbId, type) ثم الاسم الصارم
    by = defaultdict(list)
    for wid, w in det.items():
        tid = w.get('tmdbId')
        if tid:
            by[(tid, w.get('type'))].append(wid)

    groups = defaultdict(list)   # (tid, typ, norm_name) -> [wids]
    for (tid, typ), wids in by.items():
        if len(wids) < 2:
            continue
        for wid in wids:
            groups[(tid, typ, norm_strict(det[wid].get('title')))].append(wid)

    del_ids = {}       # wid_محذوف -> wid_مُبقى
    groups_log = []
    for sig, wids in groups.items():
        uniq = list(dict.fromkeys(wids))
        if len(uniq) < 2:
            continue
        # الأحقيّة: الأكثر سيرفرات ثم حلقات ثم أطول id (أوصف)
        def rich(wid):
            w = det[wid]
            return (w.get('totalValidServers', 0), w.get('episodeCount', 0), len(wid))
        keeper = max(uniq, key=rich)
        for wid in uniq:
            if wid != keeper:
                del_ids[wid] = keeper
        groups_log.append({
            'tmdbId': sig[0], 'type': sig[1], 'title': det[keeper].get('title'),
            'keep': keeper, 'removed': [w for w in uniq if w != keeper],
        })

    print(f'مجموعات تكرار حقيقي: {len(groups_log)}')
    print(f'أعمال ستُدمج (تُحذف بعد دمج سيرفراتها): {len(del_ids)}')
    if not del_ids:
        print('لا يوجد تكرار — لا تغيير.')
        return

    # keeper -> قائمة النسخ المحذوفة (لدمج سيرفراتها)
    keeper_removed = defaultdict(list)
    for d, k in del_ids.items():
        keeper_removed[k].append(d)

    # المرور 1: اجمع سيرفرات النسخ المحذوفة من الكتالوج (بأسلوب streaming)
    print('المرور 1: جمع سيرفرات النسخ المحذوفة ...', flush=True)
    # removed_servers[wid] = {season_num: {ep_num: [ {name,url}, ... ]}}
    removed_servers = {}
    with open(SRC, 'rb') as fin:
        for w in ijson.items(fin, 'item'):
            wid = w.get('work_id')
            if wid in del_ids:
                smap = {}
                for s in w.get('seasons', []):
                    snum = str(s.get('num'))
                    emap = {}
                    for ep in s.get('episodes', []):
                        emap[str(ep.get('num'))] = [
                            {'name': sv.get('name'), 'url': sv.get('url')}
                            for sv in ep.get('servers', [])
                        ]
                    smap[snum] = emap
                removed_servers[wid] = smap

    # المرور 2: أعِد كتابة الكتالوج — ادمج السيرفرات في المُبقين واحذف النسخ المكررة
    print('المرور 2: دمج السيرفرات وإعادة كتابة الكتالوج ...', flush=True)
    if not os.path.exists(BACKUP):
        os.rename(SRC, BACKUP)
    else:
        os.replace(SRC, BACKUP)

    stats = {'merged_servers_added': 0, 'kept': 0, 'removed': 0}
    with open(BACKUP, 'rb') as fin, open(SRC, 'w', encoding='utf-8') as fout:
        fout.write('[')
        first = True
        for w in ijson.items(fin, 'item'):
            wid = w.get('work_id')
            if wid in del_ids:
                stats['removed'] += 1
                continue  # نحذفها (سيرفراتها دُمجت في المُبقى)
            # لو هذا العمل مُبقٍّ لمجموعة تكرار — ادمج سيرفرات النسخ المحذوفة فيه
            if wid in keeper_removed:
                # ابنِ فهرس المواسم/الحلقات للمُبقى
                for dead in keeper_removed[wid]:
                    dead_map = removed_servers.get(dead, {})
                    for s in w.get('seasons', []):
                        snum = str(s.get('num'))
                        dead_eps = dead_map.get(snum, {})
                        for ep in s.get('episodes', []):
                            enum = str(ep.get('num'))
                            incoming = dead_eps.get(enum, [])
                            if not incoming:
                                continue
                            existing = ep.setdefault('servers', [])
                            have = {server_key(sv.get('name'), sv.get('url')) for sv in existing}
                            for sv in incoming:
                                k = server_key(sv.get('name'), sv.get('url'))
                                if k and k not in have:
                                    existing.append({'name': sv.get('name'), 'url': sv.get('url')})
                                    have.add(k)
                                    stats['merged_servers_added'] += 1
            if not first:
                fout.write(',')
            json.dump(w, fout, ensure_ascii=False, separators=(',', ':'))
            first = False
            stats['kept'] += 1
        fout.write(']')

    # ادمج مع dedupe-redirects الموجودة (إن وُجدت)
    existing_redir = {}
    if os.path.exists(REDIR_EXTRA):
        try:
            existing_redir = json.load(open(REDIR_EXTRA, encoding='utf-8'))
        except Exception:
            existing_redir = {}
    existing_redir.update(del_ids)
    json.dump(existing_redir, open(REDIR_EXTRA, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    # تقرير
    report = os.path.join(ROOT, 'reports', 'merged-duplicates.md')
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, 'w', encoding='utf-8') as f:
        f.write('# الأعمال المكرَّرة المدموجة (نفس العمل باسمين مختلفين)\n\n')
        f.write(f"**الإجمالي:** {len(del_ids)} نسخة مكررة دُمجت سيرفراتها في المُبقى ثم حُذفت مع redirect 301.\n\n")
        f.write(f"**سيرفرات أُضيفت للمُبقين أثناء الدمج:** {stats['merged_servers_added']}\n\n")
        for g in sorted(groups_log, key=lambda x: x['type']):
            f.write(f"- **{g['title']}** ({g['type']}) — أُبقي: `{g['keep']}` | حُذف: "
                    + ', '.join('`' + r + '`' for r in g['removed']) + '\n')

    print(f"✅ حُذف: {stats['removed']} | متبقٍّ: {stats['kept']} | "
          f"سيرفرات مدموجة: {stats['merged_servers_added']}")
    print(f'خريطة redirect: {REDIR_EXTRA}')
    print(f'تقرير: reports/merged-duplicates.md')


if __name__ == '__main__':
    main()
