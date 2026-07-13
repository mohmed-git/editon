#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
جلب تاريخ الإصدار الكامل (release_date للأفلام / first_air_date للمسلسلات والأنمي)
من TMDB لكل عمل له tmdbId، وحفظه في .import-cache/tmdb-ai/{work_id}.json تحت المفتاح
"releaseDate" (بصيغة YYYY-MM-DD). يُستخدم لترتيب "الأحدث" بدقة اليوم والشهر لا السنة فقط.

resumable: يتخطّى أي عمل لديه releaseDate مسبقاً.
متعدد الخيوط (خفيف) مع احترام rate limit.
"""
import json, os, re, sys, time, urllib.request, urllib.parse, urllib.error, glob
from concurrent.futures import ThreadPoolExecutor
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
AI_DIR = os.path.join(CACHE, 'tmdb-ai')

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
    print('❌ لا يوجد TMDB_TOKEN'); sys.exit(1)

def api(path):
    url = 'https://api.themoviedb.org/3' + path
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + TOKEN, 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(2.0)
                continue
            if attempt == 2:
                return None
            time.sleep(0.8 * (attempt + 1))
        except Exception:
            if attempt == 2:
                return None
            time.sleep(0.8 * (attempt + 1))
    return None

lock = threading.Lock()
stats = {'done': 0, 'fetched': 0, 'skipped': 0, 'nodate': 0, 'calls': 0}

def work_type_of(d):
    # نستنتج النوع من مسار الملف غير متاح هنا؛ نجرّب movie ثم tv بناءً على وجود
    # الحقول. لكن أدق: نمرّر النوع من الاسم. بدل ذلك نجرّب الاثنين حسب typ.
    return None

def process(args):
    f, typ = args
    try:
        d = json.load(open(f, encoding='utf-8'))
    except Exception:
        return
    tid = d.get('tmdbId')
    if not tid:
        with lock: stats['skipped'] += 1
        return
    if d.get('releaseDate'):
        with lock: stats['skipped'] += 1
        return
    # movie -> release_date ، غير ذلك -> first_air_date
    if typ == 'movie':
        info = api(f'/movie/{tid}')
        date = (info or {}).get('release_date') if info else None
    else:
        info = api(f'/tv/{tid}')
        date = (info or {}).get('first_air_date') if info else None
    with lock:
        stats['calls'] += 1
        stats['done'] += 1
    if date:
        d['releaseDate'] = date
        tmp = f + '.tmp'
        json.dump(d, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
        os.replace(tmp, f)
        with lock: stats['fetched'] += 1
    else:
        # علّم أنه لا يوجد تاريخ لتفادي إعادة الجلب لاحقاً
        d['releaseDate'] = ''
        tmp = f + '.tmp'
        json.dump(d, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
        os.replace(tmp, f)
        with lock: stats['nodate'] += 1
    if stats['done'] % 500 == 0:
        print(f"  تقدّم: {stats['done']} | جُلب: {stats['fetched']} | بلا تاريخ: {stats['nodate']}", flush=True)


def main():
    # نحتاج معرفة نوع كل عمل. نقرأه من src/data/details.json (خفيف نسبياً).
    det = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))
    typ_of = {wid: w.get('type') for wid, w in det.items()}

    tasks = []
    for f in glob.glob(os.path.join(AI_DIR, '*.json')):
        wid = os.path.basename(f)[:-5]
        typ = typ_of.get(wid, 'movie')
        tasks.append((f, typ))
    print(f'أعمال للفحص: {len(tasks)}', flush=True)

    with ThreadPoolExecutor(max_workers=12) as ex:
        list(ex.map(process, tasks))

    print(f"✅ انتهى | فُحص: {stats['done']} | جُلب تاريخ: {stats['fetched']} | "
          f"بلا تاريخ: {stats['nodate']} | تخطّي (موجود/بلا tmdb): {stats['skipped']} | "
          f"طلبات: {stats['calls']}", flush=True)


if __name__ == '__main__':
    main()
