#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
التحقق الشامل من كل إثراءات TMDB (يعالج السبب الجذري: tmdbId خاطئ بسبب تشابه الأسماء).

المشكلة: أعمال مثل "The One", "Phoenix", "Vigilante" أُعطيت tmdbId لفيلم مشهور مختلف
يشترك في كلمة (مثلاً "Harry Potter and the Order of the Phoenix") فأخذت صورته وقصته.

الحل: لكل عمل مُثرى، نجلب الاسم الرسمي الحقيقي من TMDB (باستخدام tmdbId المخزّن)،
ونطابقه مع اسم العمل. إن كان التطابق ضعيفاً → الإثراء خاطئ → نُلغيه (tmdbId=null)
فيعود العمل لصورة الـ CSV النظيفة أو placeholder، وبلا قصة/تفاصيل خاطئة.

streaming-friendly: يقرأ details.json (مبني) فقط، ويكتب في .import-cache/tmdb-ai/.
يستخدم كاش أسماء موسّع (tmdb-names-all.json) لتجنّب تكرار الاستعلامات.
"""
import json, os, re, time, urllib.request
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
NAMECACHE = os.path.join(CACHE, 'tmdb-names-all.json')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')

TOKEN = None
for line in open(os.path.join(ROOT, '.dev.vars'), encoding='utf-8'):
    if line.startswith('TMDB_TOKEN'):
        TOKEN = line.split('=', 1)[1].strip().strip('"')
        break
assert TOKEN, 'TMDB_TOKEN غير موجود'

def api(path):
    url = f'https://api.themoviedb.org/3/{path}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}', 'accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.0 * (attempt + 1))
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return None

def norm(t):
    t = (t or '').lower()
    t = re.sub(r'[^a-z0-9\u0600-\u06FF ]', ' ', t)
    t = re.sub(r'\b(the|a|an|movie|film|part|and|of|le|la|el|season|tv)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def tokens(t):
    return set(norm(t).split())

def char_ratio(a, b):
    import difflib, unicodedata
    def strip(s):
        s = unicodedata.normalize('NFKD', (s or '').lower())
        s = ''.join(c for c in s if not unicodedata.combining(c))
        return re.sub(r'[^a-z0-9]', '', s)
    ca, cb = strip(a), strip(b)
    if not ca or not cb:
        return 0.0
    return difflib.SequenceMatcher(None, ca, cb).ratio()

def match_score(work_name, tmdb_names):
    wn = norm(work_name); wt = tokens(work_name)
    if not wn or not wt:
        return 0.0
    best = 0.0
    for tn_raw in tmdb_names:
        tn = norm(tn_raw); tt = tokens(tn_raw)
        if not tn or not tt:
            continue
        if wn == tn:
            return 1.0
        cr = char_ratio(work_name, tn_raw)
        if cr >= 0.92:
            return max(best, 0.95)
        inter = wt & tt
        if not inter:
            if cr >= 0.88:
                best = max(best, 0.85)
            continue
        jac = len(inter) / len(wt | tt)
        cover_work = len(inter) / len(wt)
        cover_tmdb = len(inter) / len(tt)
        # عقوبة الأسماء القصيرة الجزئية: اسم العمل كلمة/كلمتان وهو مجرد جزء
        # من اسم TMDB الأطول (مثل "Vigilante" ⊂ "Citizen Vigilante"، "Fire" ⊂ "Fire and Ash").
        # هذا match خاطئ شائع — نُبقي jac فقط (منخفض) بلا أي مكافأة تغطية.
        short_partial = (len(wt) <= 2 and cover_work >= 0.99 and cover_tmdb < 0.99
                         and len(tt) > len(wt))
        if short_partial:
            # اسم العمل مجرد جزء من اسم أطول — نخفض الدرجة صراحةً تحت العتبة
            # (كلمة واحدة تُخفّض بشدة، كلمتان أقل حدّة). ولا نمنحه أي مكافأة تغطية.
            penalty = 0.25 if len(wt) == 1 else 0.4
            score = min(jac, penalty)
            best = max(best, score)
            continue
        score = jac
        if cover_work >= 0.85 and cover_tmdb >= 0.7:
            score = max(score, 0.9)
        if (tn.startswith(wn + ' ') or wn.startswith(tn + ' ')) and min(len(wt), len(tt)) >= 2:
            score = max(score, 0.8)
        if cr >= 0.85 and cover_work >= 0.6:
            score = max(score, 0.85)
        best = max(best, score)
    return best

def get_names(tid, typ):
    is_tv = (typ in ('series', 'anime'))
    kind = 'tv' if is_tv else 'movie'
    d = api(f'{kind}/{tid}?language=ar')
    if not d:
        kind = 'movie' if is_tv else 'tv'
        d = api(f'{kind}/{tid}?language=ar')
    if not d:
        return None
    names = set()

    def add_from(doc):
        for k in ('title', 'original_title', 'name', 'original_name'):
            if doc.get(k):
                names.add(doc[k])

    add_from(d)
    # مهم جدًا: نجلب أيضًا الاسم الإنجليزي الرسمي (language=ar قد يرجّع ترجمة/لغة أخرى
    # فيغيب الاسم الإنجليزي الأصلي مثل "12th Fail" فنُلغي إثراءً صحيحًا بالخطأ).
    en = api(f'{kind}/{tid}?language=en-US')
    if en:
        add_from(en)
    alt = api(f'{kind}/{tid}/alternative_titles')
    if alt:
        for it in (alt.get('titles') or alt.get('results') or []):
            if it.get('title'):
                names.add(it['title'])
    return {'names': list(names), 'kind': kind}

def clear_entry(source):
    return {'tmdbId': None, 'source': source}

THRESH = 0.5  # أقل من هذا = إثراء خاطئ

def main():
    det = json.load(open(DETAILS, encoding='utf-8'))
    name_cache = {}
    if os.path.exists(NAMECACHE):
        name_cache = json.load(open(NAMECACHE, encoding='utf-8'))

    # اجمع كل الأعمال المُثراة مع tmdbId
    enriched = [(wid, w) for wid, w in det.items() if w.get('tmdbId')]
    print(f'أعمال مُثراة للفحص: {len(enriched)}')

    # جمّع حسب tmdbId لتقليل الاستعلامات
    by_tid = defaultdict(list)
    for wid, w in enriched:
        by_tid[(w['tmdbId'], w.get('type'))].append(wid)

    stats = {'ok': 0, 'cleared': 0, 'no_data': 0, 'api': 0}
    cleared_log = []
    processed = 0

    for (tid, typ), wids in by_tid.items():
        key = f'{tid}:{typ}'
        if key in name_cache:
            info = name_cache[key]
        else:
            info = get_names(tid, typ)
            stats['api'] += 1
            name_cache[key] = info
            if stats['api'] % 50 == 0:
                json.dump(name_cache, open(NAMECACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f"  ... {processed}/{len(by_tid)} مجموعة | {stats['api']} استعلام | أُلغي {stats['cleared']}")
            time.sleep(0.05)
        processed += 1

        if not info or not info.get('names'):
            stats['no_data'] += 1
            continue  # بلا بيانات: لا نخاطر، نُبقي كما هو

        tmdb_names = info['names']
        for wid in wids:
            w = det[wid]
            cand = [w.get('title'), w.get('originalTitle')]
            if w.get('titleEn') and not re.search(r'[\u0600-\u06FF]', w.get('titleEn', '')):
                cand.append(w['titleEn'])
            sc = max((match_score(c, tmdb_names) for c in cand if c), default=0.0)
            if sc >= THRESH:
                stats['ok'] += 1
            else:
                # إثراء خاطئ — ألغِه
                json.dump(clear_entry('verify-all-wrong-match'),
                          open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['cleared'] += 1
                cleared_log.append({
                    'id': wid, 'title': w.get('title'), 'wrong_tmdbId': tid,
                    'tmdb_names': tmdb_names[:3], 'score': round(sc, 2),
                })

    json.dump(name_cache, open(NAMECACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(cleared_log, open(os.path.join(CACHE, 'wrong-enrichments.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    # تقرير
    rep = os.path.join(ROOT, 'reports', 'wrong-enrichments.md')
    os.makedirs(os.path.dirname(rep), exist_ok=True)
    with open(rep, 'w', encoding='utf-8') as f:
        f.write('# إثراءات TMDB الخاطئة (tmdbId خاطئ بسبب تشابه الأسماء)\n\n')
        f.write(f'**الإجمالي:** {len(cleared_log)} عمل أُلغي إثراؤه الخاطئ (عاد لصورة CSV/placeholder).\n\n')
        for c in sorted(cleared_log, key=lambda x: x['title'] or ''):
            f.write(f"- **{c['title']}** (`{c['id']}`) — كان مربوطاً خطأً بـ tmdbId={c['wrong_tmdbId']} "
                    f"({', '.join(c['tmdb_names'])}) — درجة التطابق {c['score']}\n")

    print()
    print('✅ انتهى الفحص الشامل')
    print(f"  استعلامات API: {stats['api']}")
    print(f"  إثراء صحيح: {stats['ok']}")
    print(f"  إثراء خاطئ أُلغي: {stats['cleared']}")
    print(f"  بلا بيانات TMDB (أُبقي): {stats['no_data']}")
    print(f"  التقرير: reports/wrong-enrichments.md")

if __name__ == '__main__':
    main()
