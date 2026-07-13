#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
التحقق النهائي القاطع (يعتمد على TMDB API):
المبدأ: كل مجموعة أعمال تشترك نفس tmdbId — نجلب الاسم الرسمي الحقيقي من TMDB مرة واحدة
(الاسم الأصلي EN + العربي + العناوين البديلة)، ثم نطابق اسم كل عمل:
  - العمل الذي يطابق اسمه اسم TMDB بقوة  → يحتفظ بالإثراء (الصورة/القصة/التفاصيل صحيحة).
  - الأعمال التي لا تطابق (مثل Ash / Fire أخذت خطأً match فيلم Avatar) → يُلغى إثراؤها،
    فتعود لصورة الموقع الأصلية (details.json المصدر).

مثال:
  tmdbId=83533 (Avatar: Fire and Ash)
    - "Avatar: Fire and Ash" يطابق → يبقى
    - "Ash", "Fire" لا يطابقان → يُلغى إثراؤهما

نحتفظ بالإثراء الأصلي (من details.json) لمن يطابق، ونضع tmdbId=null لمن لا يطابق.
"""
import json, os, re, time, urllib.request, urllib.parse
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
NAMECACHE = os.path.join(CACHE, 'tmdb-names.json')  # كاش أسماء tmdbId لتجنب إعادة الاستعلام

# قراءة التوكن
TOKEN = None
for line in open(os.path.join(ROOT, '.dev.vars'), encoding='utf-8'):
    if line.startswith('TMDB_TOKEN'):
        TOKEN = line.split('=', 1)[1].strip().strip('"')
        break
assert TOKEN, 'TMDB_TOKEN غير موجود'

def api(path):
    url = f'https://api.themoviedb.org/3/{path}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}', 'accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 3:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None

def norm(t):
    """تطبيع للمطابقة: أحرف صغيرة، إزالة الرموز، إزالة كلمات الحشو."""
    t = (t or '').lower()
    t = re.sub(r'[^a-z0-9\u0600-\u06FF ]', ' ', t)
    t = re.sub(r'\b(the|a|an|movie|film|part|and|of|le|la|el)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def tokens(t):
    return set(norm(t).split())

def char_ratio(a, b):
    """تشابه على مستوى الأحرف (بلا مسافات) — يلتقط اختلافات النقل الحرفي/الإملاء
    مثل Mahotsukai↔Mahoutsukai أو Magi Lumiere↔Magi-Lumière أو Thats↔That's."""
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
    """أعلى درجة تطابق بين اسم العمل وأي من أسماء TMDB الرسمية.

    المبدأ الصحيح لتفادي الإيجابيات الكاذبة (مثل "Ash" داخل "Avatar: Fire and Ash"):
    الدرجة تعتمد على التطابق المتبادل الكامل تقريباً — لا يكفي أن يكون اسم العمل
    كلمةً واحدةً موجودة ضمن اسم أطول. نستخدم Jaccard (يعاقب فروق الطول) مع
    مكافأة فقط عند التطابق الكامل أو التغطية شبه الكاملة للطرفين.
    """
    wn = norm(work_name)
    wt = tokens(work_name)
    if not wn or not wt:
        return 0.0
    best = 0.0
    for tn_raw in tmdb_names:
        tn = norm(tn_raw)
        tt = tokens(tn_raw)
        if not tn or not tt:
            continue
        if wn == tn:
            return 1.0
        # تطابق شبه تام على مستوى الأحرف (نقل حرفي/إملاء): نفس العمل فعلياً
        cr = char_ratio(work_name, tn_raw)
        if cr >= 0.92:
            return max(best, 0.95)
        inter = wt & tt
        if not inter:
            # حتى بلا كلمات مشتركة، قد يكون تطابق أحرف عالٍ (accents/apostrophes)
            if cr >= 0.88:
                best = max(best, 0.85)
            continue
        # Jaccard: يعاقب اختلاف عدد الكلمات (الأساس)
        jac = len(inter) / len(wt | tt)
        # تغطية كل طرف
        cover_work = len(inter) / len(wt)   # كم من اسم العمل موجود في TMDB
        cover_tmdb = len(inter) / len(tt)   # كم من اسم TMDB موجود في اسم العمل
        # مطابقة قوية فقط عندما يغطي الطرفان بعضهما بقدر معقول
        # (يمنع "Ash" [تغطية TMDB=0.25] من التطابق مع "Avatar Fire and Ash")
        score = jac
        if cover_work >= 0.85 and cover_tmdb >= 0.7:
            score = max(score, 0.9)
        # سلاسل: أحدهما بادئة كاملة للآخر بحدود متعددة الكلمات
        if (tn.startswith(wn + ' ') or wn.startswith(tn + ' ')) and min(len(wt), len(tt)) >= 2:
            score = max(score, 0.8)
        # تطابق أحرف عالٍ مع تقاطع كلمات معقول: نفس العنوان بإملاء مختلف
        if cr >= 0.85 and cover_work >= 0.6:
            score = max(score, 0.85)
        best = max(best, score)
    return best

def get_tmdb_names(tid, typ):
    """جلب كل أسماء العمل الرسمية من TMDB (أصلي + مترجم + عناوين بديلة)."""
    is_tv = (typ in ('series', 'anime', 'ova', 'ona', 'special'))
    kind = 'tv' if is_tv else 'movie'
    d = api(f'{kind}/{tid}?language=ar')
    if not d:
        # جرّب النوع الآخر
        kind = 'movie' if is_tv else 'tv'
        d = api(f'{kind}/{tid}?language=ar')
    if not d:
        return None
    names = set()
    for k in ('title', 'original_title', 'name', 'original_name'):
        if d.get(k):
            names.add(d[k])
    # عناوين بديلة
    alt = api(f'{kind}/{tid}/alternative_titles')
    if alt:
        for it in (alt.get('titles') or alt.get('results') or []):
            if it.get('title'):
                names.add(it['title'])
    return {'names': list(names), 'kind': kind}

def restore_enrich(w, source):
    return {
        'tmdbId': w['tmdbId'], 'synopsis': w.get('synopsis',''), 'tagline': w.get('tagline',''),
        'rating': w.get('rating'), 'voteCount': w.get('voteCount',0),
        'genres': w.get('genres',[]), 'backdrop': w.get('backdrop'),
        'tmdbPoster': w.get('tmdbPoster'),
        'tmdbTitleAr': w.get('tmdbTitleAr') or '',
        'year': w.get('year'), 'source': source,
    }

def cleared_entry(source):
    return {'tmdbId': None, 'source': source}

def main():
    details = json.load(open(os.path.join(ROOT, 'src', 'data', 'details.json'), encoding='utf-8'))

    # مجموعات الأعمال المشتركة في tmdbId
    by_tmdb = defaultdict(list)
    for wid, w in details.items():
        tid = w.get('tmdbId')
        if tid:
            by_tmdb[tid].append(wid)
    shared = {t: ws for t, ws in by_tmdb.items() if len(ws) > 1}

    # كاش الأسماء
    name_cache = {}
    if os.path.exists(NAMECACHE):
        name_cache = json.load(open(NAMECACHE, encoding='utf-8'))

    stats = {'kept': 0, 'cleared': 0, 'groups': len(shared), 'api_calls': 0, 'no_data': 0}
    log_split = []

    for i, (tid, wids) in enumerate(sorted(shared.items()), 1):
        key = str(tid)
        if key in name_cache:
            info = name_cache[key]
        else:
            # نمرر نوع أول عمل كتخمين
            typ = details[wids[0]].get('type', 'movie')
            info = get_tmdb_names(tid, typ)
            stats['api_calls'] += 1
            name_cache[key] = info
            if i % 20 == 0:
                json.dump(name_cache, open(NAMECACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'  ... {i}/{len(shared)} مجموعة، {stats["api_calls"]} استعلام')
            time.sleep(0.1)

        if not info or not info.get('names'):
            stats['no_data'] += 1
            # بلا بيانات: أبقِ الجميع (لا نخاطر بالمسح)
            for wid in wids:
                json.dump(restore_enrich(details[wid], 'verify-no-tmdb-data'),
                          open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['kept'] += 1
            continue

        tmdb_names = info['names']
        # احسب درجة كل عمل
        scored = []
        for wid in wids:
            w = details[wid]
            # نطابق باسم العمل الإنجليزي (title) والأصلي
            cand_names = [w.get('title'), w.get('originalTitle')]
            # titleEn هنا هو الاسم المعرّب — نتجاهله في المطابقة الإنجليزية لكن نجربه أيضاً
            if w.get('titleEn') and not re.search(r'[\u0600-\u06FF]', w.get('titleEn','')):
                cand_names.append(w['titleEn'])
            sc = max((match_score(cn, tmdb_names) for cn in cand_names if cn), default=0.0)
            scored.append((wid, sc))

        # عتبة المطابقة القوية
        THRESH = 0.55
        strong = [(wid, sc) for wid, sc in scored if sc >= THRESH]

        if not strong:
            # لا أحد يطابق بقوة — أبقِ صاحب أعلى درجة فقط لتفادي فقد الإثراء تماماً
            best_wid = max(scored, key=lambda x: x[1])[0]
            strong = [(best_wid, dict(scored)[best_wid])]

        keep_ids = {wid for wid, _ in strong}

        for wid, sc in scored:
            if wid in keep_ids:
                json.dump(restore_enrich(details[wid], 'verify-keep'),
                          open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['kept'] += 1
            else:
                json.dump(cleared_entry('verify-cleared'),
                          open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['cleared'] += 1

        if len(keep_ids) < len(wids):
            log_split.append({
                'tmdbId': tid,
                'tmdb_names': tmdb_names[:4],
                'kept': [(details[w]['title'], round(dict(scored)[w],2)) for w in keep_ids],
                'cleared': [(details[w]['title'], round(dict(scored)[w],2)) for w in wids if w not in keep_ids],
            })

    json.dump(name_cache, open(NAMECACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(log_split, open(os.path.join(CACHE, 'verify-split-log.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    print()
    print('✅ انتهى التحقق عبر TMDB')
    print(f'  مجموعات مشتركة: {stats["groups"]}')
    print(f'  استعلامات API: {stats["api_calls"]}')
    print(f'  بلا بيانات TMDB: {stats["no_data"]}')
    print(f'  أُبقي الإثراء: {stats["kept"]}')
    print(f'  أُلغي (يعود لصورة الموقع): {stats["cleared"]}')
    print(f'  مجموعات فُصلت: {len(log_split)}')
    print(f'  سجل الفصل: .import-cache/verify-split-log.json')

if __name__ == '__main__':
    main()
