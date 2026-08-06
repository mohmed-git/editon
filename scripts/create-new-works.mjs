// ============================================================================
// إنشاء وإثراء الأعمال الجديدة (الدفعة 24) — سينما لايف
// ----------------------------------------------------------------------------
// يقرأ reports/new-works-full.json (أعمال غير موجودة بسيرفراتها من الدمج) و:
//   - العمل الأجنبي (فيه حروف لاتينية) → بحث TMDB + إثراء كامل
//       (قصة عربية، صورة/خلفية، تقييم، تصنيفات، طاقم، سنة…) مثل باقي الأعمال.
//   - العمل العربي (بلا لاتيني) → يُنشأ بدون TMDB (نص افتراضي)، لأن TMDB
//       غالباً لا يغطّيه — كما طلب المستخدم "إلا إذا كان عربي".
//   - يضيف العمل إلى titles.json + details.json + shard الحلقات (بسيرفراته).
//   - cache على القرص (.import-cache/tmdb-new/<slug>.json) لاستئناف الدفعات.
//
// batching (لتفادي OOM وحد المعدّل):
//   LIMIT=200        عدد الأعمال المُعالَجة هذه الجولة (تُشغَّل مراراً حتى تنتهي)
//   CONCURRENCY=5    طلبات TMDB المتوازية
//   MAX_SEASONS=6    أقصى مواسم نجلب حلقاتها من TMDB
//
// USAGE:  NODE_OPTIONS="--max-old-space-size=768" node scripts/create-new-works.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, ensureDir, shardOf } from './lib-common.mjs';
import { normKey } from './lib-match.mjs';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data');
const EP_DIR = path.join(ROOT, 'public', 'data', 'episodes');
const CACHE = path.join(ROOT, '.import-cache', 'tmdb-new');
ensureDir(CACHE);
const DONE_LOG = path.join(ROOT, '.import-cache', 'new-works-done.json');
const NEW_FULL = path.join(ROOT, 'reports', 'new-works-full.json');

// ---- env / مفتاح TMDB ----
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();
const V4 = process.env.TMDB_API_TOKEN || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG = (p, s = 'w500') => (p ? `https://image.tmdb.org/t/p/${s}${p}` : null);

const LIMIT = parseInt(process.env.LIMIT || '200', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const MAX_SEASONS = parseInt(process.env.MAX_SEASONS || '6', 10);
const MAX_SERVERS = 20;
const SHARDS = 64;
const pad = (i) => String(i).padStart(2, '0');

async function tmdb(pathname, params = {}) {
  const url = new URL(TMDB_BASE + pathname);
  url.searchParams.set('language', 'ar');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${V4}`, accept: 'application/json' } });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { await new Promise((r) => setTimeout(r, 800)); }
  }
  return null;
}

function isArabicOnly(name) {
  // لا يحتوي أي حرف لاتيني a-z
  return !/[a-z]/i.test(name);
}
function normStr(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').trim(); }
function scoreMatch(name, year, cand, isTv) {
  const wname = normStr(name);
  const cname = normStr(isTv ? cand.name : cand.title);
  const corig = normStr(isTv ? cand.original_name : cand.original_title);
  let s = 0;
  if (cname === wname || corig === wname) s += 100;
  else if (cname.includes(wname) || wname.includes(cname)) s += 40;
  else if (corig.includes(wname) || wname.includes(corig)) s += 35;
  const cy = ((isTv ? cand.first_air_date : cand.release_date) || '').slice(0, 4);
  if (year && cy && String(year) === cy) s += 25;
  s += Math.min(20, (cand.popularity || 0) / 20);
  s += Math.min(15, (cand.vote_count || 0) / 500);
  return s;
}

async function searchTMDB(name, year, preferTv) {
  const nameNoYear = name.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
  const order = preferTv ? ['tv', 'movie'] : ['movie', 'tv'];
  let best = null, bestScore = -1, bestIsTv = preferTv;
  for (const type of order) {
    const isTv = type === 'tv';
    for (const q of [nameNoYear, name].filter((v, i, a) => v && a.indexOf(v) === i)) {
      const data = await tmdb(`/search/${type}`, { query: q, page: 1, include_adult: 'false' });
      if (!data || !data.results) continue;
      for (const cand of data.results.slice(0, 8)) {
        const sc = scoreMatch(nameNoYear, year, cand, isTv);
        if (sc > bestScore) { bestScore = sc; best = cand; bestIsTv = isTv; }
      }
    }
    if (bestScore >= 100) break;
  }
  return best && bestScore >= 40 ? { cand: best, isTv: bestIsTv, score: bestScore } : null;
}

// ---- تحميل البيانات ----
console.log('▶ تحميل البيانات…');
const titles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'titles.json'), 'utf8'));
const details = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'details.json'), 'utf8'));
const allNew = JSON.parse(fs.readFileSync(NEW_FULL, 'utf8'));
const done = new Set(readJSON(DONE_LOG, []) || []);

// نأخذ دفعة LIMIT من غير المُنجَز
const pending = allNew.filter((w) => !done.has(normKey(w.name) + '|' + w.type));
const batch = pending.slice(0, LIMIT);
console.log(`إجمالي جديد=${allNew.length} | مُنجَز=${done.size} | متبقٍ=${pending.length} | هذه الجولة=${batch.length}`);

// يتجنّب أي id موجود في titles أو details أو مُخصَّص في هذه الجولة (منعاً لدهس
// عمل قائم — مهم للأسماء الرقمية القصيرة مثل "24" / "65"). يزيل السنة المكررة
// من نهاية الاسم قبل إلحاقها، ويضيف لاحقة رقمية عند التصادم. `allocated` يجعل
// النتيجة ثابتة (نفس id في نداءي cacheFile و id النهائي لنفس العمل).
const allocated = new Set();
const allocMap = new Map(); // key(name|year) → id ثابت خلال الجولة
function slugify(name, year) {
  const memoKey = name + '|' + (year || '');
  if (allocMap.has(memoKey)) return allocMap.get(memoKey);
  // أزل سنة زائدة من نهاية الأساس كي لا تتكرر (…-1994-1994)
  let base = normKey(name).replace(/\s+/g, '-').slice(0, 80) || 'work';
  if (year) base = base.replace(new RegExp('-?' + year + '$'), '') || 'work';
  const taken = (id) =>
    Object.prototype.hasOwnProperty.call(titles, id) ||
    Object.prototype.hasOwnProperty.call(details, id) ||
    allocated.has(id);
  let id = year ? `${base}-${year}` : base;
  if (taken(id)) {
    let n = 2;
    let cand = `${base}-${year || ''}-${n}`.replace(/--+/g, '-');
    while (taken(cand)) { n++; cand = `${base}-${year || ''}-${n}`.replace(/--+/g, '-'); }
    id = cand;
  }
  allocated.add(id);
  allocMap.set(memoKey, id);
  return id;
}

const epShards = {};
function loadShard(sh) {
  if (epShards[sh] != null) return epShards[sh];
  const f = path.join(EP_DIR, `shard-${pad(sh)}.json`);
  epShards[sh] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  return epShards[sh];
}
const touchedShards = new Set();

// يبني حلقات العمل في shard من seasons+servers مع epMeta اختيارية من TMDB
function writeEpisodes(id, w, epMeta) {
  const sh = shardOf(id);
  const shard = loadShard(sh);
  touchedShards.add(sh);
  shard[id] = {};
  let total = 0;
  for (const [sk, eps] of Object.entries(w.seasons)) {
    shard[id][sk] = [];
    for (const [ek, ep] of Object.entries(eps)) {
      const epNum = parseInt(ek, 10);
      const meta = epMeta?.[sk]?.[epNum] || {};
      const servers = ep.servers.slice(0, MAX_SERVERS).map((url, i) => ({ id: i + 1, name: `سيرفر ${i + 1}`, url }));
      total += servers.length;
      shard[id][sk].push({
        num: epNum,
        name: meta.name || ep.title || `الحلقة ${epNum}`,
        synopsis: meta.overview || '',
        rating: meta.rating ?? null, voteCount: meta.voteCount || 0,
        ratingSource: meta.rating ? 'tmdb' : null,
        still: meta.still || null, airDate: meta.airDate || null,
        servers,
      });
    }
    shard[id][sk].sort((a, b) => a.num - b.num);
  }
  return total;
}

async function processWork(w) {
  const key = normKey(w.name) + '|' + w.type;
  // cache file يعتمد اسماً مستقراً (لا يُخصِّص id — نستخدم base فقط لتفادي دهس)
  const cacheBase = (normKey(w.name).replace(/\s+/g, '-').slice(0, 80) || 'work') + '-' + (w.year || 'na') + '-' + w.type;
  const cacheFile = path.join(CACHE, cacheBase + '.json');
  let enrich = readJSON(cacheFile);

  const arabicOnly = isArabicOnly(w.name);
  if (enrich === null) {
    if (arabicOnly) {
      enrich = { found: false, arabic: true };
    } else {
      const preferTv = w.type !== 'movie';
      const match = await searchTMDB(w.name, w.year, preferTv);
      if (!match) {
        enrich = { found: false };
      } else {
        const { cand, isTv } = match;
        const type = isTv ? 'tv' : 'movie';
        const d = await tmdb(`/${type}/${cand.id}`, { append_to_response: 'credits' });
        if (!d) enrich = { found: false };
        else {
          const credits = d.credits || {};
          const cast = (credits.cast || []).slice(0, 8).map((c) => ({ name: c.name, character: c.character || '', profile: IMG(c.profile_path, 'w185') }));
          const creators = isTv ? (d.created_by || []).map((c) => c.name) : (credits.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
          const yr = parseInt(((isTv ? d.first_air_date : d.release_date) || '').slice(0, 4), 10) || w.year || null;
          // حلقات (للمسلسلات فقط) للمواسم الموجودة في CSV
          let epMeta = null;
          if (isTv) {
            epMeta = {};
            const csvSeasons = Object.keys(w.seasons).map(Number).filter((n) => n > 0).slice(0, MAX_SEASONS);
            for (const sn of csvSeasons) {
              const sd = await tmdb(`/${type}/${cand.id}/season/${sn}`);
              if (sd && Array.isArray(sd.episodes)) {
                epMeta[sn] = {};
                for (const e of sd.episodes) epMeta[sn][e.episode_number] = {
                  name: e.name || '', overview: e.overview || '',
                  rating: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null,
                  voteCount: e.vote_count || 0, still: IMG(e.still_path, 'w300'), airDate: e.air_date || null,
                };
              }
            }
          }
          enrich = {
            found: true, isTv,
            type: isTv ? (w.type === 'anime' ? 'anime' : 'series') : 'movie',
            tmdbId: cand.id,
            title: isTv ? d.name : d.title,
            titleEn: isTv ? (d.original_name || d.name) : (d.original_title || d.title),
            originalTitle: isTv ? d.original_name : d.original_title,
            overview: d.overview || '', tagline: d.tagline || '',
            year: yr, genres: (d.genres || []).map((g) => g.name),
            country: (d.production_countries?.[0]?.name) || (d.origin_country?.[0]) || '',
            rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
            voteCount: d.vote_count || 0,
            poster: IMG(d.poster_path, 'w500'), backdrop: IMG(d.backdrop_path, 'w1280'),
            runtime: isTv ? ((d.episode_run_time || [])[0] || null) : (d.runtime || null),
            numberOfSeasons: isTv ? d.number_of_seasons || null : null,
            numberOfEpisodes: isTv ? d.number_of_episodes || null : null,
            cast, creators, popularity: d.popularity || 0, epMeta,
          };
        }
      }
    }
    writeJSON(cacheFile, enrich);
  }

  // ---- بناء العمل في titles/details/episodes ----
  const id = slugify(w.name, enrich.found ? enrich.year : w.year);
  const found = enrich.found;
  const type = found ? enrich.type : w.type;
  const displayTitle = found ? (enrich.title || w.name) : w.name;
  const titleEn = found ? (enrich.titleEn || w.name) : w.name;
  const seasonNums = Object.keys(w.seasons).map(Number).sort((a, b) => a - b);
  let epCount = 0; for (const s of Object.values(w.seasons)) epCount += Object.keys(s).length;
  const isMovie = type === 'movie';

  titles[id] = {
    id, type, title: displayTitle, titleEn,
    year: found ? enrich.year : (w.year || null),
    rating: found ? enrich.rating : null,
    poster: found && enrich.poster ? enrich.poster : '/static/placeholder-poster.svg',
    backdrop: found ? enrich.backdrop : null,
    genres: found ? enrich.genres : [],
    isNew: true,
  };
  details[id] = {
    id, type, tmdbId: found ? enrich.tmdbId : null,
    title: displayTitle, titleEn, originalTitle: found ? (enrich.originalTitle || displayTitle) : w.name,
    year: found ? enrich.year : (w.year || null),
    releaseDate: '', rating: found ? enrich.rating : null, voteCount: found ? enrich.voteCount : 0,
    ratingSource: found && enrich.rating ? 'tmdb' : null,
    poster: found && enrich.poster ? enrich.poster : '/static/placeholder-poster.svg',
    tmdbPoster: found ? enrich.poster : null, backdrop: found ? enrich.backdrop : null,
    genres: found ? enrich.genres : [], country: found ? enrich.country : '',
    synopsis: found ? enrich.overview : '', tagline: found ? enrich.tagline : '',
    runtime: found ? enrich.runtime : null,
    cast: found ? enrich.cast : [], creators: found ? enrich.creators : [],
    quality: 'HD', language: 'مترجم',
    seasonCount: seasonNums.length, episodeCount: epCount, totalValidServers: 0,
    numberOfSeasons: isMovie ? null : (found && enrich.numberOfSeasons ? enrich.numberOfSeasons : seasonNums.length),
    numberOfEpisodes: isMovie ? null : (found && enrich.numberOfEpisodes ? enrich.numberOfEpisodes : epCount),
    popularity: found ? enrich.popularity : 0,
    ready: !!(found && enrich.poster),
    seasons: seasonNums.map((n) => ({ num: n, episodes: Object.keys(w.seasons[String(n)]).length })),
  };
  const total = writeEpisodes(id, w, found ? enrich.epMeta : null);
  details[id].totalValidServers = total;

  done.add(key);
  return { id, found, arabic: arabicOnly, type };
}

// ---- تشغيل متوازٍ محدود ----
let idx = 0, okFound = 0, okArabic = 0, notFound = 0, created = 0;
async function runPool() {
  const workers = [];
  for (let c = 0; c < CONCURRENCY; c++) {
    workers.push((async () => {
      while (idx < batch.length) {
        const i = idx++;
        const w = batch[i];
        try {
          const r = await processWork(w);
          created++;
          if (r.arabic) okArabic++;
          else if (r.found) okFound++;
          else notFound++;
          if (created % 25 === 0) console.log(`  … ${created}/${batch.length}`);
        } catch (e) {
          console.error('خطأ في', w.name, e.message);
        }
      }
    })());
  }
  await Promise.all(workers);
}

await runPool();

// ---- الكتابة ----
for (const sh of touchedShards) fs.writeFileSync(path.join(EP_DIR, `shard-${pad(sh)}.json`), JSON.stringify(epShards[sh]));
fs.writeFileSync(path.join(DATA_DIR, 'titles.json'), JSON.stringify(titles));
fs.writeFileSync(path.join(DATA_DIR, 'details.json'), JSON.stringify(details));
writeJSON(DONE_LOG, [...done]);

console.log('\n════════ نتيجة الجولة ════════');
console.log(`أُنشئ: ${created} | مُثرى TMDB: ${okFound} | عربي (بلا TMDB): ${okArabic} | لم يُطابَق TMDB: ${notFound}`);
console.log(`إجمالي الأعمال الآن: ${Object.keys(titles).length} | متبقٍ للدفعات القادمة: ${pending.length - batch.length}`);
