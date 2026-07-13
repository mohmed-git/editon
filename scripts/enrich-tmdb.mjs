// ============================================================================
// المرحلة 2: إثراء الكتالوج بـ TMDB (Arabic) + توليد ملفات الموقع النهائية
// ----------------------------------------------------------------------------
// - يقرأ .import-cache/raw-catalog.json
// - يرتّب الأعمال حسب أولوية مبدئية، ثم يثري كلاً منها من TMDB:
//     * search (movie/tv) → أفضل تطابق
//     * details: overview, genres, vote_average+count, runtime, seasons,
//       poster/backdrop عالي الجودة, credits (cast/creators), country
//     * لكل موسم: episodes (اسم + overview + vote_average+count + still)
// - cache على القرص (.import-cache/tmdb/<slug>.json) للاستئناف (resume)
// - log للأعمال غير الموجودة (.import-cache/not-found.log)
// - أعمال ناقصة (بلا سيرفر صالح / بلا صورة) تُوسم unready
// - يولّد: src/data/{titles,details,home,categories,stats}.json
//          src/data/episodes/shard-XX.json (مجمّعة، عدد محدود)
//          publish-priority.md
//
// حدود التشغيل عبر env:
//   LIMIT=1500        عدد الأعمال المراد إثراؤها هذه الجولة (الخيار ب)
//   CONCURRENCY=6     عدد الطلبات المتوازية
//   SHARDS=64         عدد ملفات الحلقات المجمّعة
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR, PUBLIC_DATA_DIR, CACHE_DIR, REPORTS_DIR,
  readJSON, writeJSON, ensureDir, shardOf, seasonOrdAr,
} from './lib-common.mjs';

// ---- إعداد المفتاح -----------------------------------------------------------
function loadEnv() {
  const envPath = path.resolve(CACHE_DIR, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();
const V4_TOKEN = process.env.TMDB_API_TOKEN || '';
const V3_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = (p, size = 'w500') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

const LIMIT = parseInt(process.env.LIMIT || '1500', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '6', 10);
const SHARDS = parseInt(process.env.SHARDS || '64', 10);
const MAX_SEASONS = parseInt(process.env.MAX_SEASONS || '8', 10); // احترام CPU/حجم

const TMDB_CACHE = path.join(CACHE_DIR, 'tmdb');
ensureDir(TMDB_CACHE);
const NOT_FOUND_LOG = path.join(CACHE_DIR, 'not-found.log');

let reqCount = 0;
function authHeaders() {
  return V4_TOKEN ? { Authorization: `Bearer ${V4_TOKEN}`, accept: 'application/json' } : { accept: 'application/json' };
}
async function tmdb(pathname, params = {}) {
  const url = new URL(TMDB_BASE + pathname);
  url.searchParams.set('language', 'ar');
  if (V3_KEY && !V4_TOKEN) url.searchParams.set('api_key', V3_KEY);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 5; attempt++) {
    reqCount++;
    let res;
    try {
      res = await fetch(url, { headers: authHeaders() });
    } catch (e) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('retry-after') || '2', 10);
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    return res.json();
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- خريطة الأنواع (genres) ع → مضمونة بالعربي من TMDB ----------------------

// ---- بحث عن أفضل تطابق -------------------------------------------------------
function normStr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').trim();
}
function scoreMatch(work, cand, isTv) {
  const wname = normStr(work.searchName);
  const cname = normStr(isTv ? cand.name : cand.title);
  const corig = normStr(isTv ? cand.original_name : cand.original_title);
  let s = 0;
  if (cname === wname || corig === wname) s += 100;
  else if (cname.includes(wname) || wname.includes(cname)) s += 40;
  else if (corig.includes(wname) || wname.includes(corig)) s += 35;
  // تطابق السنة
  const cy = (isTv ? cand.first_air_date : cand.release_date || '').slice(0, 4);
  if (work.csvYear && cy && String(work.csvYear) === cy) s += 25;
  // الشعبية ترجّح
  s += Math.min(20, (cand.popularity || 0) / 20);
  s += Math.min(15, (cand.vote_count || 0) / 500);
  return s;
}

async function searchWork(work) {
  const isTv = work.category !== 'movie';
  const type = isTv ? 'tv' : 'movie';
  const tryQueries = [work.searchName, work.titleEn, work.titleAr].filter(Boolean);
  let best = null, bestScore = -1;
  for (const q of tryQueries) {
    const data = await tmdb(`/search/${type}`, { query: q, page: 1, include_adult: 'false' });
    if (!data || !data.results || !data.results.length) continue;
    for (const cand of data.results.slice(0, 8)) {
      const sc = scoreMatch(work, cand, isTv);
      if (sc > bestScore) { bestScore = sc; best = cand; }
    }
    if (bestScore >= 100) break; // تطابق تام كافٍ
  }
  // fallback: لو TV فشل جرّب movie والعكس (بعض الأعمال مصنّفة خطأ)
  if (!best) {
    const alt = isTv ? 'movie' : 'tv';
    const data = await tmdb(`/search/${alt}`, { query: work.searchName, page: 1, include_adult: 'false' });
    if (data && data.results && data.results.length) {
      best = data.results[0];
      best.__altType = alt;
    }
  }
  return best ? { cand: best, isTv: best.__altType ? best.__altType === 'tv' : isTv, score: bestScore } : null;
}

// ---- إثراء تفاصيل عمل -------------------------------------------------------
async function enrichWork(work) {
  const cached = readJSON(path.join(TMDB_CACHE, `${work.slug}.json`));
  if (cached) return cached; // resume

  const match = await searchWork(work);
  if (!match) {
    fs.appendFileSync(NOT_FOUND_LOG, `${work.slug}\t${work.category}\t${work.searchName}\n`);
    const miss = { found: false };
    writeJSON(path.join(TMDB_CACHE, `${work.slug}.json`), miss);
    return miss;
  }

  const { cand, isTv } = match;
  const type = isTv ? 'tv' : 'movie';
  const tmdbId = cand.id;
  const details = await tmdb(`/${type}/${tmdbId}`, { append_to_response: 'credits' });
  if (!details) {
    const miss = { found: false };
    writeJSON(path.join(TMDB_CACHE, `${work.slug}.json`), miss);
    return miss;
  }

  const credits = details.credits || {};
  const cast = (credits.cast || []).slice(0, 8).map((c) => c.name);
  let creators = [];
  if (isTv) creators = (details.created_by || []).map((c) => c.name);
  else creators = (credits.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);

  const genres = (details.genres || []).map((g) => g.name);
  const country =
    (details.production_countries && details.production_countries[0]?.name) ||
    (details.origin_country && details.origin_country[0]) || '';
  const year = parseInt(((isTv ? details.first_air_date : details.release_date) || '').slice(0, 4), 10) || work.csvYear || null;

  // مواسم TMDB (أرقام المواسم الفعلية، نتجاهل موسم 0 = specials عادةً)
  let tmdbSeasons = [];
  if (isTv && Array.isArray(details.seasons)) {
    tmdbSeasons = details.seasons
      .filter((s) => s.season_number >= 0)
      .map((s) => ({ season_number: s.season_number, episode_count: s.episode_count, name: s.name }));
  }

  const result = {
    found: true,
    type: isTv ? (work.category === 'anime' ? 'anime' : 'series') : 'movie',
    tmdbType: type,
    tmdbId,
    title: isTv ? details.name : details.title,
    originalTitle: isTv ? details.original_name : details.original_title,
    overview: details.overview || '',
    tagline: details.tagline || '',
    year,
    genres,
    country,
    rating: details.vote_average ? Math.round(details.vote_average * 10) / 10 : null,
    voteCount: details.vote_count || 0,
    poster: IMG(details.poster_path, 'w500'),
    backdrop: IMG(details.backdrop_path, 'w1280'),
    runtime: isTv
      ? (Array.isArray(details.episode_run_time) && details.episode_run_time[0]) || null
      : details.runtime || null,
    numberOfSeasons: isTv ? details.number_of_seasons || null : null,
    numberOfEpisodes: isTv ? details.number_of_episodes || null : null,
    cast,
    creators,
    popularity: details.popularity || 0,
    tmdbSeasons,
  };

  // إثراء الحلقات (تقييم + قصة لكل حلقة) — للمسلسلات/الأنمي فقط
  // نقتصر على المواسم الموجودة فعلاً في CSV وبحدّ أقصى MAX_SEASONS
  if (isTv) {
    const csvSeasonNums = work.seasons.map((s) => s.num).filter((n) => n > 0).slice(0, MAX_SEASONS);
    const epMeta = {}; // { [seasonNum]: { [epNum]: {name,overview,rating,voteCount,still,airDate} } }
    for (const sn of csvSeasonNums) {
      const sd = await tmdb(`/${type}/${tmdbId}/season/${sn}`);
      if (sd && Array.isArray(sd.episodes)) {
        epMeta[sn] = {};
        for (const e of sd.episodes) {
          epMeta[sn][e.episode_number] = {
            name: e.name || '',
            overview: e.overview || '',
            rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null,
            voteCount: e.vote_count || 0,
            still: IMG(e.still_path, 'w300'),
            airDate: e.air_date || null,
          };
        }
      }
    }
    result.episodeMeta = epMeta;
  }

  writeJSON(path.join(TMDB_CACHE, `${work.slug}.json`), result);
  return result;
}

// ---- تشغيل متوازٍ محدود ------------------------------------------------------
async function runPool(items, worker, concurrency) {
  let i = 0, done = 0;
  const results = new Array(items.length);
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { error: String(e) }; }
      done++;
      if (done % 25 === 0 || done === items.length) {
        process.stdout.write(`\r  إثراء: ${done}/${items.length} (طلبات TMDB: ${reqCount})   `);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  process.stdout.write('\n');
  return results;
}

main().catch((e) => { console.error(e); process.exit(1); });

async function main() {
  if (!V4_TOKEN && !V3_KEY) {
    console.error('❌ لا يوجد مفتاح TMDB. ضع TMDB_API_KEY أو TMDB_API_TOKEN في .env');
    process.exit(1);
  }
  const catalog = readJSON(path.join(CACHE_DIR, 'raw-catalog.json'));
  if (!catalog) { console.error('❌ شغّل parse-csv.mjs أولاً'); process.exit(1); }
  console.log(`🎬 كتالوج: ${catalog.length} عمل | LIMIT=${LIMIT} | CONCURRENCY=${CONCURRENCY}`);

  // أولوية مبدئية: الجديد أولاً ثم عدد الحلقات (نُعيد الترتيب لاحقاً بشعبية TMDB)
  const ordered = [...catalog].sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return b.episodeCount - a.episodeCount;
  });
  const batch = ordered.slice(0, LIMIT);

  console.log('🔎 إثراء الدفعة من TMDB…');
  await runPool(batch, enrichWork, CONCURRENCY);

  // نجمع كل نتائج الـ cache (تشمل جولات سابقة) لبناء ملفات الموقع
  console.log('🧩 توليد ملفات الموقع…');
  buildSiteData(catalog);
  console.log(`\n✅ تم! (طلبات TMDB هذه الجولة: ${reqCount})`);
}

// ---- توليد ملفات الموقع من الكتالوج + cache TMDB ----------------------------
function pad(n) { return String(n).padStart(2, '0'); }

function buildSiteData(catalog) {
  const titles = {};   // id -> بطاقة
  const detailsMap = {}; // id -> تفاصيل (نسخة كاملة للصفحات الثابتة)
  const episodeShards = Array.from({ length: SHARDS }, () => ({})); // shard -> { id -> {season->episodes[]} }
  const detailShards = Array.from({ length: SHARDS }, () => ({})); // shard -> { id -> detail } (لصفحات SSR)
  const catalogMeta = []; // للتقرير

  let enrichedCount = 0, unreadyCount = 0;

  for (const w of catalog) {
    const id = w.slug;
    const t = readJSON(path.join(TMDB_CACHE, `${id}.json`));
    const found = t && t.found;
    if (found) enrichedCount++;

    const type = found ? t.type : w.category;
    const title = w.titleAr || (found ? t.title : '') || w.titleEn || w.rawTitle;
    const titleEn = w.titleEn || (found ? t.originalTitle : '') || '';
    const year = (found && t.year) || w.csvYear || null;
    const poster = w.poster || (found ? t.poster : null); // نفضّل بوستر R2 من CSV
    const tmdbPoster = found ? t.poster : null;
    const backdrop = found ? t.backdrop : null;
    const genres = found ? t.genres : [];
    const rating = found ? t.rating : null;

    // جاهزية النشر
    const ready = w.hasValidServer && (!!poster);

    titles[id] = {
      id, type, title, titleEn, year, rating,
      poster, backdrop, genres,
      isNew: w.isNew,
    };

    // إجمالي السيرفرات الصالحة
    let totalValidServers = 0;
    for (const s of w.seasons) for (const e of s.episodes) totalValidServers += e.validServerCount;

    detailsMap[id] = {
      id, type,
      tmdbId: found ? t.tmdbId : null,
      title, titleEn,
      originalTitle: found ? t.originalTitle : titleEn,
      year, rating,
      voteCount: found ? t.voteCount : 0,
      ratingSource: found ? 'TMDB' : null,
      poster, tmdbPoster, backdrop,
      genres,
      country: found ? t.country : '',
      synopsis: found ? t.overview : '',
      tagline: found ? t.tagline : '',
      runtime: found ? t.runtime : null,
      cast: found ? t.cast : [],
      creators: found ? t.creators : [],
      quality: 'HD',
      language: 'مترجم',
      seasonCount: w.seasonCount,
      episodeCount: w.episodeCount,
      totalValidServers,
      numberOfSeasons: found ? t.numberOfSeasons : w.seasonCount,
      numberOfEpisodes: found ? t.numberOfEpisodes : w.episodeCount,
      popularity: found ? t.popularity : 0,
      ready,
      // قائمة المواسم (أرقام + عدد حلقات كل موسم من CSV) لصفحة العمل
      seasons: w.seasons.map((s) => ({ num: s.num, episodes: s.episodes.length })),
    };

    // بناء حلقات هذا العمل (مدموجة CSV + TMDB) داخل shard
    const shard = shardOf(id, SHARDS);
    // نسخة detail داخل shard — تُقرأ في صفحات SSR (watch) دون استيراد details.json كامل
    detailShards[shard][id] = detailsMap[id];
    const bySeasonList = {};
    for (const s of w.seasons) {
      const arr = [];
      const meta = found && t.episodeMeta ? t.episodeMeta[s.num] : null;
      for (const e of s.episodes) {
        const m = meta ? meta[e.num] : null;
        arr.push({
          num: e.num,
          name: (m && m.name) || e.csvTitle || `الحلقة ${e.num}`,
          synopsis: (m && m.overview) || '',
          rating: m && m.rating != null ? m.rating : null,
          voteCount: m ? m.voteCount : 0,
          ratingSource: m && m.rating != null ? 'TMDB' : null,
          still: (m && m.still) || null,
          airDate: (m && m.airDate) || null,
          servers: e.servers
            .filter((sv) => sv.valid)
            .map((sv, i) => ({ id: `s${i + 1}`, name: sv.label, url: sv.url })),
        });
      }
      bySeasonList[s.num] = arr;
    }
    episodeShards[shard][id] = bySeasonList;

    if (!ready) unreadyCount++;
    catalogMeta.push({
      id, type, title, titleEn, year,
      found, rating, voteCount: found ? t.voteCount : 0,
      popularity: found ? t.popularity : 0,
      seasonCount: w.seasonCount, episodeCount: w.episodeCount,
      hasValidServer: w.hasValidServer, hasPoster: !!poster,
      totalValidServers, ready,
    });
  }

  // كتابة ملفات الحلقات المجمّعة كأصول ثابتة (public/data) — تُخدَّم من CDN
  // ولا تمرّ عبر الـ bundler. SSR يجلبها عبر fetch وقت الطلب (shard واحد فقط).
  const epDir = path.join(PUBLIC_DATA_DIR, 'episodes');
  if (fs.existsSync(epDir)) fs.rmSync(epDir, { recursive: true, force: true });
  ensureDir(epDir);
  for (let i = 0; i < SHARDS; i++) {
    writeJSON(path.join(epDir, `shard-${pad(i)}.json`), episodeShards[i]);
  }

  // كتابة ملفات تفاصيل الأعمال المجمّعة كأصول ثابتة (SSR: يجلب shard واحد فقط)
  const dDir = path.join(PUBLIC_DATA_DIR, 'details');
  if (fs.existsSync(dDir)) fs.rmSync(dDir, { recursive: true, force: true });
  ensureDir(dDir);
  for (let i = 0; i < SHARDS; i++) {
    writeJSON(path.join(dDir, `shard-${pad(i)}.json`), detailShards[i]);
  }

  // صفوف الصفحة الرئيسية (مُثراة) + الأقسام (كل الأعمال، SSR بالترقيم)
  const home = buildHome(titles, detailsMap);
  const categories = buildCategories(titles, detailsMap);

  writeJSON(path.join(DATA_DIR, 'titles.json'), titles);
  writeJSON(path.join(DATA_DIR, 'details.json'), detailsMap);
  writeJSON(path.join(DATA_DIR, 'home.json'), home);
  writeJSON(path.join(DATA_DIR, 'categories.json'), categories);

  // فهرس بحث مضغوط للأعمال المُثراة فقط (يُقرأ في صفحة SSR /search).
  // خفيف جداً (اسم + نوع + بوستر) ⇒ لا يُثقل الـ Worker مثل titles.json الكامل.
  const searchIndex = Object.values(titles)
    .filter((t) => detailsMap[t.id]?.tmdbId)
    .map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      titleEn: t.titleEn,
      year: t.year,
      rating: t.rating,
      poster: t.poster,
      genres: (detailsMap[t.id]?.genres || []).slice(0, 4),
    }));
  writeJSON(path.join(DATA_DIR, 'search-index.json'), searchIndex);
  // نسخة كأصل ثابت (public/data) ليجلبها SSR عبر HTTP (بحث/أعمال مشابهة).
  writeJSON(path.join(PUBLIC_DATA_DIR, 'search-index.json'), searchIndex);

  // فهارس الأقسام مقسّمة بالصفحات كأصول ثابتة (public/data/cat) — تُخدَّم من CDN.
  // صفحة القسم SSR تجلب ملف صفحة واحد فقط (60 بطاقة) ⇒ حجم/CPU صغيران.
  const CAT_PAGE = 60;
  const catDir = path.join(PUBLIC_DATA_DIR, 'cat');
  if (fs.existsSync(catDir)) fs.rmSync(catDir, { recursive: true, force: true });
  ensureDir(catDir);
  const catMeta = {};
  for (const slug in categories) {
    const ids = categories[slug].items;
    const cards = ids.map((id) => {
      const t = titles[id];
      return { id, type: t.type, title: t.title, titleEn: t.titleEn, year: t.year, rating: t.rating, poster: t.poster, backdrop: t.backdrop };
    });
    const pages = Math.max(1, Math.ceil(cards.length / CAT_PAGE));
    for (let p = 0; p < pages; p++) {
      writeJSON(path.join(catDir, `${slug}-${p + 1}.json`), cards.slice(p * CAT_PAGE, (p + 1) * CAT_PAGE));
    }
    catMeta[slug] = { label: categories[slug].label, type: categories[slug].type, total: cards.length, pages, pageSize: CAT_PAGE };
  }
  writeJSON(path.join(catDir, 'meta.json'), catMeta);

  // فهرس خفيف لخريطة الموقع: [id, priority] لكل عمل — يُقرأ في sitemap.xml
  // بدل تحميل details.json/titles.json الضخمين وقت البناء (ذاكرة محدودة).
  const sm = [];
  for (const id in titles) {
    const d = detailsMap[id];
    const enriched = !!(d && d.tmdbId);
    const pr = enriched ? ((d.popularity || 0) > 50 ? '0.9' : '0.7') : '0.5';
    sm.push([id, pr]);
  }
  writeJSON(path.join(DATA_DIR, 'sitemap-index.json'), sm);

  const byType = {};
  for (const id in titles) byType[titles[id].type] = (byType[titles[id].type] || 0) + 1;
  const stats = {
    totalTitles: Object.keys(titles).length,
    byType,
    enriched: enrichedCount,
    unready: unreadyCount,
    shards: SHARDS,
    generatedAt: new Date().toISOString(),
  };
  writeJSON(path.join(DATA_DIR, 'stats.json'), stats);

  // تقرير الأولوية
  buildPriorityReport(catalogMeta, stats);

  console.log('  titles:', stats.totalTitles, '| enriched:', enrichedCount, '| unready:', unreadyCount);
  console.log('  byType:', byType, '| shards:', SHARDS);
}

function sortByPopularity(a, b) {
  const sa = (a.popularity || 0) + (a.voteCount || 0) / 100 + (a.rating || 0);
  const sb = (b.popularity || 0) + (b.voteCount || 0) / 100 + (b.rating || 0);
  return sb - sa;
}

function buildHome(titles, detailsMap) {
  // الصفحة الرئيسية = واجهة العرض المميّزة: نُبرز الأعمال المُثراة (بيانات + صور
  // غنية) في صفوف الترشيح. باقي الكتالوج يظهر كاملاً في صفحات الأقسام.
  const enriched = Object.values(titles).filter((t) => detailsMap[t.id]?.tmdbId);
  const withPop = enriched.map((t) => ({ ...t, _pop: detailsMap[t.id]?.popularity || 0, _vc: detailsMap[t.id]?.voteCount || 0 }));
  const top = [...withPop].sort((a, b) => (b._pop + b._vc / 100) - (a._pop + a._vc / 100));
  const pickType = (type, n) => top.filter((t) => t.type === type).slice(0, n).map((t) => t.id);
  const heroCand = top.find((t) => t.backdrop) || top[0];
  return {
    hero: heroCand ? heroCand.id : null,
    rows: [
      { title: 'الأكثر رواجاً', slug: 'trending', items: top.slice(0, 20).map((t) => t.id) },
      { title: 'أفلام', slug: 'movie', items: pickType('movie', 20) },
      { title: 'مسلسلات', slug: 'series', items: pickType('series', 20) },
      { title: 'أنمي', slug: 'anime', items: pickType('anime', 20) },
      { title: 'أضيف حديثاً', slug: 'new', items: top.filter((t) => t.isNew).slice(0, 20).map((t) => t.id) },
    ].filter((r) => r.items.length),
  };
}

function buildCategories(titles, detailsMap) {
  // كل الأعمال (10,439) — لأنها كلها تُخدَّم SSR ولها صفحات. الترتيب: المُثراة
  // الأعلى شعبيةً أولاً، ثم بقية المُثراة، ثم غير المُثراة (أبجدياً) في الذيل.
  const all = Object.values(titles)
    .map((t) => {
      const d = detailsMap[t.id];
      const enriched = !!(d && d.tmdbId);
      return {
        ...t,
        _enriched: enriched,
        popularity: d?.popularity || 0,
        voteCount: d?.voteCount || 0,
      };
    })
    .sort((a, b) => {
      // المُثراة قبل غير المُثراة
      if (a._enriched !== b._enriched) return a._enriched ? -1 : 1;
      if (a._enriched) return sortByPopularity(a, b);
      // غير المُثراة: الجديد أولاً ثم أبجدياً
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return (a.title || '').localeCompare(b.title || '', 'ar');
    });
  const cats = {
    movie: { label: 'أفلام', type: 'movie' },
    series: { label: 'مسلسلات', type: 'series' },
    anime: { label: 'أنمي', type: 'anime' },
    trending: { label: 'الأكثر رواجاً', type: null },
  };
  const out = {};
  for (const [slug, c] of Object.entries(cats)) {
    let list = c.type ? all.filter((t) => t.type === c.type) : all;
    // "الأكثر رواجاً" = المُثراة فقط (منطقي: نحتاج بيانات شعبية)
    if (slug === 'trending') list = list.filter((t) => t._enriched).slice(0, 200);
    out[slug] = { label: c.label, type: c.type, items: list.map((t) => t.id) };
  }
  return out;
}

function buildPriorityReport(meta, stats) {
  const ranked = [...meta].sort(sortByPopularity);
  const ready = ranked.filter((m) => m.ready && m.found);
  const unready = ranked.filter((m) => !m.ready || !m.found);

  const lines = [];
  lines.push('# تقرير أولوية النشر — سينما لايف\n');
  lines.push(`> تاريخ التوليد: ${stats.generatedAt}\n`);
  lines.push('يرتّب الأعمال من الأكثر شهرة/بحثاً إلى الأقل بناءً على بيانات TMDB ');
  lines.push('(popularity score + vote_count + rating). راجع أعلى الأعمال وتأكّد أنها جاهزة 100% ');
  lines.push('(سيرفرات صالحة + بيانات كاملة + Schema) قبل اعتمادها للنشر أولاً.\n');
  lines.push('## ملخص\n');
  lines.push(`- إجمالي الأعمال: **${stats.totalTitles}**`);
  lines.push(`- أُثريَت من TMDB: **${stats.enriched}**`);
  lines.push(`- جاهزة للنشر: **${ready.length}**`);
  lines.push(`- غير جاهزة (تحتاج مراجعة): **${unready.length}**`);
  lines.push(`- التوزيع: ${JSON.stringify(stats.byType)}\n`);

  lines.push('## ✅ أعلى 200 عمل جاهز للنشر (مرتبة حسب الشهرة)\n');
  lines.push('| # | العمل | النوع | السنة | تقييم TMDB | أصوات | شعبية | مواسم/حلقات | سيرفرات صالحة |');
  lines.push('|---|-------|------|------|-----------|-------|-------|-------------|----------------|');
  ready.slice(0, 200).forEach((m, i) => {
    const name = `${m.title}${m.titleEn && m.titleEn !== m.title ? ` (${m.titleEn})` : ''}`;
    lines.push(`| ${i + 1} | ${name} | ${typeAr(m.type)} | ${m.year || '—'} | ${m.rating ?? '—'} | ${m.voteCount} | ${Math.round(m.popularity)} | ${m.seasonCount}/${m.episodeCount} | ${m.totalValidServers} |`);
  });

  lines.push('\n## ⚠️ أعمال غير جاهزة للنشر\n');
  lines.push('السبب: بدون سيرفر صالح، أو بدون صورة، أو لم تُلاقَ في TMDB (بيانات ناقصة).\n');
  lines.push('| العمل | النوع | سبب عدم الجاهزية |');
  lines.push('|-------|------|------------------|');
  unready.slice(0, 500).forEach((m) => {
    const reasons = [];
    if (!m.found) reasons.push('لم تُلاقَ في TMDB');
    if (!m.hasValidServer) reasons.push('بلا سيرفر صالح');
    if (!m.hasPoster) reasons.push('بلا صورة');
    const name = `${m.title}${m.titleEn && m.titleEn !== m.title ? ` (${m.titleEn})` : ''}`;
    lines.push(`| ${name} | ${typeAr(m.type)} | ${reasons.join('، ') || 'بيانات ناقصة'} |`);
  });
  if (unready.length > 500) lines.push(`\n> …و${unready.length - 500} عملاً آخر غير جاهز (مقتطع).`);

  fs.writeFileSync(path.join(REPORTS_DIR, 'publish-priority.md'), lines.join('\n'), 'utf-8');
  // نسخة JSON للاستهلاك البرمجي
  writeJSON(path.join(CACHE_DIR, 'priority.json'), { ready: ready.map((m) => m.id), unready: unready.map((m) => m.id) });
  console.log('  📄 publish-priority.md → جاهز:', ready.length, '| غير جاهز:', unready.length);
}

function typeAr(t) { return t === 'movie' ? 'فيلم' : t === 'anime' ? 'أنمي' : 'مسلسل'; }
