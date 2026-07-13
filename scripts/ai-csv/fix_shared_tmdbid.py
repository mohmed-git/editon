#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
كشف وإصلاح الأعمال المختلفة التي تتشارك نفس tmdbId (السبب: المطابقة الأصلية أخذت
أول نتيجة بحث TMDB — الأشهر — بلا scoring حقيقي، فسرقت الأعمال المشهورة المطابقة).

المنهجية:
1) نجمّع الأعمال حسب (tmdbId, type).
2) لكل مجموعة فيها >1 عمل بأسماء «جذور» مختلفة (ليست مواسم/OVA لنفس السلسلة):
   - نعيد بحث TMDB الحقيقي لكل عمل باسمه + سنته، ونطبّق خوارزمية دقيقة:
     * تشابه كلمات كاملة (Jaccard على التوكنات) بدل الاحتواء النصي الخام.
     * إلزام قوي بتطابق السنة (فرق >1 سنة يعاقَب بشدة، >3 سنوات يُرفض تقريباً).
     * وزن شعبية منخفض جداً (كسر تعادل فقط، لا يقلب النتيجة).
     * حد أدنى صارم (THRESH=0.55): أقل منه → «غير موجود» (tmdbId=null) بدل التخمين.
   - نُبقي tmdbId الأصلي فقط للعمل الأعلى تطابقاً حقيقياً؛ الباقون يُعاد إسنادهم
     لنتيجتهم الصحيحة إن وُجدت، وإلا يُلغى إثراؤهم.

الأعمال التي جذورها متطابقة (مواسم/أجزاء نفس السلسلة) تُترك — مشاركتها tmdbId طبيعية.
يكتب تقرير reports/shared-tmdbid-fixed.md + CSV reports/shared-tmdbid-fixed.csv
"""
import json, os, re, time, csv, urllib.request, urllib.parse
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
NEWCACHE = os.path.join(CACHE, 'tmdb-ai')
DETAILS = os.path.join(ROOT, 'src', 'data', 'details.json')
IMG = 'https://image.tmdb.org/t/p/w500'
BACK = 'https://image.tmdb.org/t/p/w1280'

TOKEN = None
for line in open(os.path.join(ROOT, '.dev.vars'), encoding='utf-8'):
    if line.startswith('TMDB_TOKEN'):
        TOKEN = line.split('=', 1)[1].strip().strip('"')
        break
assert TOKEN, 'TMDB_TOKEN غير موجود'

def api(path, params=None):
    url = f'https://api.themoviedb.org/3/{path}'
    if params:
        url += '?' + urllib.parse.urlencode(params)
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

STOP = {'the','a','an','movie','film','part','and','of','le','la','el','season','tv',
        'ova','ova','special','specials','episode','the','مترجم','اون','لاين','فيلم','اوفا'}

def norm(t):
    t = (t or '').lower()
    t = re.sub(r'[^a-z0-9\u0600-\u06FF ]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

def tokens(t):
    return set(w for w in norm(t).split() if w not in STOP)

def root_name(t):
    """جذر الاسم: قبل أول علامة ترقيم/رقم موسم/كلمة جزء — لتمييز المواسم عن الأعمال المختلفة."""
    t = re.split(r'[:\-–—(]|\bseason\b|\bmovie\b|\bpart\b|\bova\b|\bs\d', norm(t))[0]
    return t.strip()

def word_sim(a, b):
    """Jaccard على الكلمات الكاملة + تغطية — بدل الاحتواء النصي الخام.

    عقوبة قوية للأسماء القصيرة الجزئية: عمل اسمه كلمة/كلمتان وهو مجرد جزء من اسم
    أطول (مثل "Phoenix" ⊂ "Griffin & Phoenix") = مطابقة خاطئة شائعة → نعتمد Jaccard
    وحده (منخفض) بلا مكافأة تغطية إطلاقاً.
    """
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    if not inter:
        return 0.0
    jac = len(inter) / len(ta | tb)
    cover_a = len(inter) / len(ta)   # كم من اسم العمل مُغطّى
    cover_b = len(inter) / len(tb)   # كم من اسم المرشّح مُغطّى
    # اسم العمل مُغطّى بالكامل لكنه أقصر بكثير من المرشّح، والمرشّح ليس مُغطّى →
    # اسم العمل جزء فقط من اسم أطول مختلف: اعتمد Jaccard وحده (لا مكافأة).
    short_partial = (len(ta) <= 2 and cover_a >= 0.99 and cover_b < 0.99 and len(tb) > len(ta))
    if short_partial:
        return jac
    cover = min(cover_a, cover_b)
    return 0.6 * jac + 0.4 * cover

def year_factor(work_year, cand_year):
    """إلزام قوي بالسنة: تطابق=1.0، فرق سنة=0.9، فرق 2-3=0.6، أكبر=0.2 (شبه رفض)."""
    if not work_year or not cand_year:
        return 0.85  # سنة غير معروفة: لا نعاقب بشدة لكن لا نكافئ
    d = abs(int(work_year) - int(cand_year))
    if d == 0: return 1.0
    if d == 1: return 0.9
    if d <= 3: return 0.55
    return 0.15

THRESH = 0.55  # حد أدنى صارم لقبول المطابقة

def search_best(name, year, is_tv):
    """يبحث ويعيد أفضل نتيجة موثوقة (score, result) أو (0, None).

    نبحث بـ language=en-US (فيرجّع الاسم الإنجليزي الرسمي للمقارنة الصحيحة — البحث
    بالعربية يرجّع أسماء معرّبة/يابانية فتفشل مطابقة الاسم الإنجليزي). نطابق الاسم
    الإنجليزي + الأصلي + العربي معاً، ونعزّز بجلب alternative_titles لأفضل مرشّح.
    """
    kind = 'tv' if is_tv else 'movie'
    d = api(f'search/{kind}', {'query': name, 'language': 'en-US', 'include_adult': 'false'})
    results = (d or {}).get('results') or []
    if not results:
        return 0.0, None
    scored = []
    for r in results[:10]:
        cand_names = [r.get('name'), r.get('title'), r.get('original_name'), r.get('original_title')]
        cand_year = None
        dt = r.get('first_air_date') or r.get('release_date') or ''
        if dt[:4].isdigit():
            cand_year = int(dt[:4])
        wsim = max((word_sim(name, cn) for cn in cand_names if cn), default=0.0)
        yf = year_factor(year, cand_year)
        # وزن شعبية منخفض جداً: كسر تعادل فقط (0..0.03)
        pop = r.get('popularity') or 0
        pop_tiny = min(pop / 1000.0, 0.03)
        score = wsim * yf + pop_tiny
        scored.append((score, wsim, yf, r))
    scored.sort(key=lambda x: x[0], reverse=True)

    # للمرشّحين الأعلى: عزّز المطابقة بالأسماء البديلة (قد تحمل الاسم الإنجليزي الشائع)
    for i in range(min(3, len(scored))):
        sc, wsim, yf, r = scored[i]
        if wsim >= 0.99:
            break
        alt = api(f'{kind}/{r["id"]}/alternative_titles')
        if alt:
            alt_names = [it.get('title') for it in (alt.get('titles') or alt.get('results') or []) if it.get('title')]
            aw = max((word_sim(name, an) for an in alt_names), default=0.0)
            if aw > wsim:
                new_score = aw * yf + min((r.get('popularity') or 0) / 1000.0, 0.03)
                scored[i] = (new_score, aw, yf, r)
        time.sleep(0.03)
    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0]
    return best[0], best[3]

def build_entry(res, is_tv, work_year):
    tmdb_id = res.get('id')
    kind = 'tv' if is_tv else 'movie'
    det = api(f'{kind}/{tmdb_id}', {'language': 'ar'}) or {}
    name_ar = det.get('name') or det.get('title') or ''
    return {
        'tmdbId': tmdb_id,
        'synopsis': det.get('overview') or res.get('overview') or '',
        'tagline': det.get('tagline', ''),
        'rating': det.get('vote_average') or res.get('vote_average'),
        'voteCount': det.get('vote_count') or res.get('vote_count', 0),
        'genres': [g['name'] for g in det.get('genres', [])],
        'backdrop': (BACK + det['backdrop_path']) if det.get('backdrop_path') else None,
        'tmdbPoster': (IMG + det['poster_path']) if det.get('poster_path') else None,
        'tmdbTitleAr': name_ar if re.search(r'[\u0600-\u06FF]', name_ar) else '',
        'year': work_year,
        'source': 'fix-shared-research',
    }

def clear_entry():
    return {'tmdbId': None, 'source': 'fix-shared-cleared'}

def names_of_tmdb(tid, is_tv):
    """كل أسماء الـ tmdbId (إنجليزي + عربي + أصلي + بديلة) — للتحقق قبل الإلغاء."""
    kind = 'tv' if is_tv else 'movie'
    names = set()
    for lang in ('en-US', 'ar'):
        d = api(f'{kind}/{tid}', {'language': lang})
        if d:
            for k in ('title', 'original_title', 'name', 'original_name'):
                if d.get(k):
                    names.add(d[k])
    alt = api(f'{kind}/{tid}/alternative_titles')
    if alt:
        for it in (alt.get('titles') or alt.get('results') or []):
            if it.get('title'):
                names.add(it['title'])
    return names

def main():
    det = json.load(open(DETAILS, encoding='utf-8'))
    by_tid = defaultdict(list)
    for wid, w in det.items():
        if w.get('tmdbId'):
            by_tid[(w['tmdbId'], w.get('type'))].append(wid)

    # مجموعات فيها أعمال بجذور أسماء مختلفة (مطابقة خاطئة محتملة)
    suspect_groups = []
    for (tid, typ), wids in by_tid.items():
        if len(wids) < 2:
            continue
        roots = set(root_name(det[w].get('title')) for w in wids)
        # لو كل الجذور واحدة (أو متطابقة تقريباً) → مواسم نفس السلسلة، تخطَّ
        if len(roots) <= 1:
            continue
        # لو الجذور مختلفة فعلاً → مشتبه
        suspect_groups.append((tid, typ, wids, roots))

    print(f'مجموعات مشتبهة (أعمال مختلفة بنفس tmdbId): {len(suspect_groups)}')

    fixed_log = []
    stats = {'re_matched': 0, 'cleared': 0, 'kept': 0, 'api': 0}

    for gi, (tid, typ, wids, roots) in enumerate(suspect_groups):
        is_tv = typ in ('series', 'anime')
        for wid in wids:
            w = det[wid]
            name = w.get('title') or ''
            year = w.get('year')
            score, res = search_best(name, year, is_tv)
            stats['api'] += 1
            time.sleep(0.05)

            if res and score >= THRESH:
                new_tid = res.get('id')
                if new_tid == tid:
                    stats['kept'] += 1
                    continue  # مطابقته الأصلية صحيحة فعلاً
                # أعِد الإسناد لنتيجته الصحيحة
                entry = build_entry(res, is_tv, year)
                stats['api'] += 1
                json.dump(entry, open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['re_matched'] += 1
                fixed_log.append({'id': wid, 'title': name, 'year': year, 'old_tmdbId': tid,
                                  'new_tmdbId': new_tid, 'score': round(score, 2), 'action': 're-matched'})
            else:
                # قبل الإلغاء: تحقّق هل tmdbId الأصلي يطابق الاسم فعلاً (البحث قد يفشل مع
                # الأسماء اليابانية المُرومنة الصعبة رغم أن الإسناد الأصلي صحيح).
                old_names = names_of_tmdb(tid, is_tv)
                stats['api'] += 1
                old_sim = max((word_sim(name, n) for n in old_names), default=0.0)
                if old_sim >= THRESH:
                    stats['kept'] += 1  # الإسناد الأصلي صحيح فعلاً — أبقِه
                    continue
                # لا نتيجة موثوقة ولا الأصلي صحيح → غير موجود (بدل التخمين)
                json.dump(clear_entry(), open(os.path.join(NEWCACHE, f'{wid}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
                stats['cleared'] += 1
                fixed_log.append({'id': wid, 'title': name, 'year': year, 'old_tmdbId': tid,
                                  'new_tmdbId': None, 'score': round(score, 2),
                                  'old_sim': round(old_sim, 2), 'action': 'cleared'})

        if (gi + 1) % 20 == 0:
            print(f"  ... {gi+1}/{len(suspect_groups)} مجموعة | API {stats['api']} | أُعيد={stats['re_matched']} أُلغي={stats['cleared']} صحيح={stats['kept']}")

    # تقارير
    os.makedirs(os.path.join(ROOT, 'reports'), exist_ok=True)
    json.dump(fixed_log, open(os.path.join(CACHE, 'shared-tmdbid-fixed.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    with open(os.path.join(ROOT, 'reports', 'shared-tmdbid-fixed.md'), 'w', encoding='utf-8') as f:
        f.write('# إصلاح الأعمال المتشاركة في نفس tmdbId (مطابقة خاطئة)\n\n')
        f.write(f'- أُعيدت مطابقتها للنتيجة الصحيحة: {stats["re_matched"]}\n')
        f.write(f'- أُلغي إثراؤها (لا نتيجة موثوقة ≥ {THRESH}): {stats["cleared"]}\n')
        f.write(f'- مطابقتها الأصلية صحيحة (أُبقيت): {stats["kept"]}\n\n')
        for c in sorted(fixed_log, key=lambda x: x['title'] or ''):
            f.write(f"- **{c['title']}** (`{c['id']}`, {c['year']}) — {c['action']} — "
                    f"كان tmdb={c['old_tmdbId']} → {c['new_tmdbId']} (درجة {c['score']})\n")

    with open(os.path.join(ROOT, 'reports', 'shared-tmdbid-fixed.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        wr = csv.writer(f)
        wr.writerow(['work_id', 'الاسم', 'السنة', 'النوع', 'tmdbId_القديم', 'tmdbId_الجديد', 'درجة_التطابق', 'الإجراء'])
        for c in sorted(fixed_log, key=lambda x: x['title'] or ''):
            typ = det.get(c['id'], {}).get('type', '')
            wr.writerow([c['id'], c['title'], c['year'], typ, c['old_tmdbId'],
                         c['new_tmdbId'] or '', c['score'], c['action']])

    print()
    print('✅ انتهى إصلاح tmdbId المتشارك')
    print(f"  أُعيدت مطابقتها: {stats['re_matched']}")
    print(f"  أُلغيت (غير موثوقة): {stats['cleared']}")
    print(f"  صحيحة أصلاً: {stats['kept']}")
    print(f"  استعلامات API: {stats['api']}")
    print('  التقرير: reports/shared-tmdbid-fixed.md + .csv')

if __name__ == '__main__':
    main()
