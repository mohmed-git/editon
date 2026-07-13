#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# استخراج الاسم الإنجليزي النظيف + السنة + رقم الموسم من عنوان صفحة topcinemaa
# مثال أفلام:   'فيلم 10 Lives 2024 مترجم اون لاين'  -> ('10 Lives', 2024, None)
# مثال مسلسلات: 'مسلسل ... Road to a Million الموسم الثاني الحلقة 5 مترجمة'
#               -> ('007: Road to a Million', None, 2)
# نأخذ آخر (أطول) تسلسل لاتيني قبل كلمات الموسم/الحلقة، ونلتقط السنة إن وُجدت.
# ============================================================================
import re

# كلمات عربية تُعلِّم نهاية اسم العمل
STOP_WORDS = ['الموسم', 'الحلقة', 'مترجم', 'مترجمة', 'اون لاين', 'اونلاين',
              'مدبلج', 'مدبلجة', 'والاخيرة', 'كاملة', 'كامل', 'الجزء']

AR_SEASON = {
    'الاول': 1, 'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4,
    'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9,
    'العاشر': 10,
}

# قاموس بادئة النوع
KIND_WORD = {'فيلم': 'movie', 'مسلسل': 'series', 'انمي': 'anime', 'أنمي': 'anime'}


def _season_num(title):
    m = re.search(r'الموسم\s+ال?(\w+)', title)
    if m:
        w = m.group(1)
        if w in AR_SEASON:
            return AR_SEASON[w]
        # الموسم 2
        m2 = re.search(r'الموسم\s+(\d+)', title)
        if m2:
            return int(m2.group(1))
    m3 = re.search(r'الموسم\s+(\d+)', title)
    if m3:
        return int(m3.group(1))
    # كلمات مثل "الموسم الثاني"
    for w, n in AR_SEASON.items():
        if f'الموسم {w}' in title or f'الموسم ال{w[2:]}' in title:
            return n
    return None


def parse_title(title, kind_word=''):
    """يعيد (english_name, year, season_num)."""
    t = (title or '').strip()
    year = None
    my = re.search(r'\b(19\d\d|20\d\d)\b', t)
    if my:
        year = int(my.group(1))
    season = _season_num(t)

    # أزل بادئة النوع
    for kw in KIND_WORD:
        if t.startswith(kw + ' '):
            t = t[len(kw) + 1:]
            break

    # اقطع عند أول كلمة توقّف
    cut = len(t)
    for sw in STOP_WORDS:
        i = t.find(sw)
        if i != -1:
            cut = min(cut, i)
    head = t[:cut].strip()

    # التقط أطول تسلسل لاتيني (حروف/أرقام/رموز شائعة) من "head"
    # نسمح بالحروف اللاتينية، الأرقام، والمسافات وبعض الرموز
    matches = re.findall(r"[A-Za-z0-9][A-Za-z0-9 :&'\u2019\u2018\.\-!,\?\(\)]*[A-Za-z0-9\)]",
                         head)
    matches = [m.strip() for m in matches if m.strip()]
    # اختر الأطول (يحتوي عادة الاسم الإنجليزي)
    eng = ''
    if matches:
        eng = max(matches, key=len).strip()
    # إن كان الاسم مجرد سنة، أهمله
    if re.fullmatch(r'\d{4}', eng):
        eng = ''
    # نظّف السنة من داخل الاسم (للأفلام يكون الاسم متبوعاً بالسنة)
    if year and eng:
        eng = re.sub(r'\b' + str(year) + r'\b', '', eng).strip()
        eng = re.sub(r'\s{2,}', ' ', eng).strip(' -:,')
    return eng, year, season


if __name__ == '__main__':
    import json, os
    ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    nw = json.load(open(os.path.join(ROOT, '.import-cache', 'topcinema-new-works.json'), encoding='utf-8'))
    import random
    random.seed(1)
    ok = 0
    for w in random.sample(nw, 30):
        eng, year, season = parse_title(w['title'], w['kind'])
        if eng:
            ok += 1
        print(f"[{w['kind']}] eng={eng!r} year={year} season={season}")
        print(f"    <- {w['title']!r}")
    print(f'\nمع اسم إنجليزي: {ok}/30')
