// ============================================================================
// إثراء الأفلام فقط من TMDB — دون المساس ببقية البيانات (سلاسل/أنمي/صور مطبّقة)
// ----------------------------------------------------------------------------
// يقرأ titles.json/details.json الحاليَّين، ويبحث لكل فيلم في TMDB (search/movie)
// بالاسم الإنجليزي + السنة، ثم يجلب details لأفضل تطابق ويضيف:
//   - synopsis (overview بالعربية)
//   - genres (تصنيفات نوعية: كوميديا/دراما/أكشن/خيال علمي/فانتازيا…)
//   - rating + voteCount (مع سياسة الحد الأدنى 50 صوتاً لإظهار التقييم)
//   - releaseDate (تاريخ إصدار كامل YYYY-MM-DD لترتيب "أحدث الأفلام" بدقة)
//   - poster/backdrop عالي الجودة (فقط إن لم يكن للفيلم بوستر TMDB أصلاً)
//   - cast, runtime, tmdbId, popularity
// cache على القرص للاستئناف. يحافظ على التصنيفات الجغرافية القديمة كإضافة.
//
// env: LIMIT (عدد الأفلام هذه الجولة), CONCURRENCY (تزامن), MIN_VOTES (=50),
//      OFFSET (تخطّي أول N فيلم), FORCE=1 (تجاهل الكاش).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const V4 = process.env.TMDB_API_TOKEN || '';
const BASE = 'https://api.themoviedb.org/3';
const IMG = (p, s = 'w500') => (p ? `https://image.tmdb.org/t/p/${s}${p}` : null);
const LIMIT = parseInt(process.env.LIMIT || '99999', 10);
const OFFSET = parseInt(process.env.OFFSET || '0', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '8', 10);
const MIN_VOTES = parseInt(process.env.MIN_VOTES || '50', 10);
const FORCE = process.env.FORCE === '1';

const CACHE = '.import-cache/tmdb-movies';
fs.mkdirSync(CACHE, { recursive: true });

if (!V4) { console.error('❌ TMDB_API_TOKEN غير مضبوط'); process.exit(1); }

const titles = JSON.parse(fs.readFileSync('src/data/titles.json', 'utf8'));
const details = JSON.parse(fs.readFileSync('src/data/details.json', 'utf8'));

const H = { Authorization: `Bearer ${V4}`, accept: 'application/json' };
let reqCount = 0;
async function tmdb(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  url.searchParams.set('language', 'ar');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      reqCount++;
      const r = await fetch(url, { headers: H });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      await new Promise((s) => setTimeout(s, 800 * (attempt + 1)));
    }
  }
  return null;
}

async function tmdbEn(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  try {
    reqCount++;
    const r = await fetch(url, { headers: H });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// اسم بحث نظيف
function searchName(t) {
  // فضّل الاسم اللاتيني
  const cand = /[a-zA-Z]/.test(t.title || '') ? t.title : (t.titleEn || t.title || '');
  return (cand || '')
    .replace(/مترجم|اون لاين|اونلاين|كامل|HD|بجودة عالية/gi, '')
    .replace(/\(\d{4}\)/g, '')
    .trim();
}

function pickBest(results, year) {
  if (!results || !results.length) return null;
  // فضّل تطابق السنة إن توفّرت
  if (year) {
    const exact = results.find((r) => (r.release_date || '').slice(0, 4) === String(year));
    if (exact) return exact;
    const near = results.find((r) => {
      const y = parseInt((r.release_date || '').slice(0, 4), 10);
      return y && Math.abs(y - year) <= 1;
    });
    if (near) return near;
  }
  // وإلا الأعلى شعبية
  return results.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
}

async function enrichMovie(id) {
  const cacheFile = path.join(CACHE, `${id}.json`);
  if (!FORCE && fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
  }
  const t = titles[id];
  const name = searchName(t);
  if (!name || name.length < 2) { fs.writeFileSync(cacheFile, JSON.stringify({ notFound: true })); return { notFound: true }; }

  const sr = await tmdb('/search/movie', { query: name, year: t.year || undefined, include_adult: 'false' });
  const best = pickBest(sr?.results, t.year);
  if (!best) {
    // محاولة ثانية بلا سنة
    const sr2 = await tmdb('/search/movie', { query: name, include_adult: 'false' });
    const best2 = pickBest(sr2?.results, t.year);
    if (!best2) { fs.writeFileSync(cacheFile, JSON.stringify({ notFound: true })); return { notFound: true }; }
    return await fetchDetails(id, best2.id, cacheFile);
  }
  return await fetchDetails(id, best.id, cacheFile);
}

async function fetchDetails(id, tmdbId, cacheFile) {
  const d = await tmdb(`/movie/${tmdbId}`, { append_to_response: 'credits' });
  if (!d) { fs.writeFileSync(cacheFile, JSON.stringify({ notFound: true })); return { notFound: true }; }
  // احتياطي: إن غابت القصة بالعربية، اجلبها بالإنجليزية
  let overview = d.overview || '';
  if (!overview) {
    const en = await tmdbEn(`/movie/${tmdbId}`);
    overview = (en && en.overview) || '';
  }
  const out = {
    tmdbId,
    synopsis: overview,
    genres: (d.genres || []).map((g) => g.name),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    voteCount: d.vote_count || 0,
    releaseDate: d.release_date || null,
    year: d.release_date ? parseInt(d.release_date.slice(0, 4), 10) : null,
    poster: IMG(d.poster_path),
    backdrop: IMG(d.backdrop_path, 'w1280'),
    runtime: d.runtime || null,
    cast: (d.credits?.cast || []).slice(0, 8).map((c) => c.name),
    popularity: d.popularity || 0,
    tagline: d.tagline || '',
  };
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

// ---- التشغيل بالدفعات المتوازية ----
const allMovies = Object.keys(titles).filter((id) => titles[id].type === 'movie');
const batch = allMovies.slice(OFFSET, OFFSET + LIMIT);
console.log(`إثراء ${batch.length} فيلم (من إجمالي ${allMovies.length}) — تزامن ${CONCURRENCY}`);

let done = 0, enriched = 0, notFound = 0;
async function worker(queue) {
  while (queue.length) {
    const id = queue.shift();
    const res = await enrichMovie(id);
    done++;
    if (res && !res.notFound) {
      enriched++;
      applyToData(id, res);
    } else notFound++;
    if (done % 200 === 0) {
      console.log(`  ${done}/${batch.length} | مُثرى: ${enriched} | غير موجود: ${notFound} | طلبات: ${reqCount}`);
      saveData();
    }
  }
}

function applyToData(id, res) {
  const t = titles[id];
  const prevGenres = (t.genres || []).filter((g) => /أجنبي|هندي|آسيوي|تركي|نتفليكس/.test(g));
  const newGenres = [...new Set([...(res.genres || []), ...prevGenres])];

  // titles
  t.title = t.title; // نُبقي الاسم كما هو
  if (res.genres && res.genres.length) t.genres = newGenres;
  if (res.year) t.year = res.year;
  t.rating = res.voteCount >= MIN_VOTES && res.rating != null ? res.rating : null;
  // بوستر: نستبدل فقط إن لم يكن الفيلم يملك بوستر TMDB أصلاً وكان الجديد متاحاً
  if (res.poster && !/image\.tmdb\.org/.test(t.poster || '')) t.poster = res.poster;
  if (res.backdrop && !t.backdrop) t.backdrop = res.backdrop;

  // details
  const dd = details[id] || { id, type: 'movie', title: t.title, titleEn: t.titleEn };
  dd.tmdbId = res.tmdbId;
  dd.synopsis = res.synopsis || dd.synopsis || '';
  if (res.genres && res.genres.length) dd.genres = newGenres;
  dd.rating = res.rating;
  dd.ratingRaw = res.rating;
  dd.voteCount = res.voteCount;
  dd.ratingSource = 'TMDB';
  dd.releaseDate = res.releaseDate;
  if (res.year) dd.year = res.year;
  if (res.poster) { dd.tmdbPoster = res.poster; if (!/image\.tmdb\.org/.test(dd.poster || '')) dd.poster = res.poster; }
  if (res.backdrop && !dd.backdrop) dd.backdrop = res.backdrop;
  if (res.runtime) dd.runtime = res.runtime;
  if (res.cast && res.cast.length) dd.cast = res.cast;
  dd.popularity = res.popularity || dd.popularity || 0;
  if (res.tagline) dd.tagline = res.tagline;
  dd.enriched = true;
  // إخفاء التقييم غير الموثوق اتساقاً مع السياسة
  if (res.voteCount < MIN_VOTES) { dd.rating = null; t.rating = null; }
  details[id] = dd;
}

function saveData() {
  fs.writeFileSync('src/data/titles.json', JSON.stringify(titles));
  fs.writeFileSync('src/data/details.json', JSON.stringify(details));
}

const queue = batch.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
saveData();
console.log(`\n✔ انتهى. مُثرى: ${enriched} | غير موجود: ${notFound} | إجمالي طلبات: ${reqCount}`);
