#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# المرحلة 1: استخراج مصغّر من CSV بطريقة streaming (موفّرة للذاكرة).
# نقرأ الملف صفاً صفاً ونكتب سطراً مختصراً TSV لكل سيرفر:
#   norm_name \t kind \t season \t episode \t host_key \t player \t url
# ثم يُفرز الملف خارجياً بأمر sort على القرص (لا يحمّل كل شيء في الرام).
# نكتب أيضاً meta لكل عمل (أول ظهور) في ملف منفصل.
# ============================================================================
import os, sys, csv, re, unicodedata
from urllib.parse import urlparse, unquote

csv.field_size_limit(50 * 1024 * 1024)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.import-cache')
CSV_FILE = os.path.join(ROOT, '..', 'work_csv', 'topcinemaa_full_1836pages.csv')
OUT_SERVERS = os.path.join(CACHE, '_csv_servers.tsv')      # سطر لكل سيرفر
OUT_META = os.path.join(CACHE, '_csv_meta.tsv')            # سطر لكل عمل (أول ظهور)

SUB_STRIP = {'www', 'down', 'embed', 'play', 'player', 'stream', 'watch',
             'video', 'cdn', 's1', 's2', 's3', 'vip', 'new', 'get', 'go',
             'e', 'd', 'v', 'm', 'mobile', 'api'}


def unwrap(url):
    u = (url or '').strip()
    if not u:
        return ''
    if 'play.php?to=' in u:
        real = u.split('play.php?to=', 1)[1]
        real = unquote(real)
        if not real.startswith('http'):
            real = 'https://' + real
        return real
    return u


def root_host(url):
    try:
        u = unwrap(url)
        if '//' not in u:
            u = 'http://' + u
        host = urlparse(u).netloc.lower().split(':')[0]
        if not host:
            return ''
        parts = host.split('.')
        while len(parts) > 2 and parts[0] in SUB_STRIP:
            parts = parts[1:]
        return parts[-2] if len(parts) >= 2 else parts[0]
    except Exception:
        return ''


def norm_name(s):
    s = (s or '').strip().lower()
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def norm_player(p):
    return re.sub(r'[^a-z0-9]+', '', (p or '').strip().lower())


def server_key(name, url):
    rh = root_host(url)
    if rh and rh not in ('topcinemaa', 'topcinema'):
        return rh
    return norm_player(name)


def is_valid_url(u):
    return bool(u) and u.startswith('http') and '.' in u


def clean(s):
    # نزيل TAB/newline من الحقول لأننا نستخدم TSV
    return (s or '').replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').strip()


def main():
    n = 0
    kept = 0
    seen_meta = set()
    fs = open(OUT_SERVERS, 'w', encoding='utf-8')
    fm = open(OUT_META, 'w', encoding='utf-8')
    with open(CSV_FILE, encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            n += 1
            if n % 100000 == 0:
                print(f'  ... {n} صف | {kept} سيرفر صالح', flush=True)
            if len(row) < 15:
                continue
            kind = clean(row[1])
            name = clean(row[2])
            if not name:
                continue
            nk = norm_name(name)
            if not nk:
                continue
            url = unwrap(row[12])
            if not is_valid_url(url):
                continue
            # موسم/حلقة
            try:
                season = int(float(row[4] or 1))
            except Exception:
                season = 1
            try:
                episode = int(float(row[6] or 1))
            except Exception:
                episode = 1
            if kind == 'فيلم':
                season, episode = 1, 1
            player = clean(row[10]) or 'سيرفر'
            hk = server_key(player, url)
            if not hk:
                hk = norm_player(player) or 'x'
            fs.write(f'{nk}\t{kind}\t{season}\t{episode}\t{hk}\t{player}\t{clean(url)}\n')
            kept += 1
            # meta أول ظهور
            mkey = (nk, kind)
            if mkey not in seen_meta:
                seen_meta.add(mkey)
                fm.write('\t'.join([
                    nk, kind, clean(row[3]), clean(row[7]),
                    clean(row[8]), clean(row[13]), clean(row[14]),
                ]) + '\n')
    fs.close()
    fm.close()
    print(f'تم: {n} صف مقروء | {kept} سيرفر صالح | {len(seen_meta)} عمل فريد')
    print(f'المخرجات: {OUT_SERVERS} , {OUT_META}')


if __name__ == '__main__':
    main()
