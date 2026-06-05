import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const cacheDir = path.join(rootDir, 'scripts', '.cache');
const cacheFile = path.join(cacheDir, 'tmdb-movies-series-search-cache.json');
const today = new Date().toISOString().slice(0, 10);
const accessToken = process.env.TMDB_ACCESS_TOKEN || '';
const apiKey = process.env.TMDB_API_KEY || '';
const categories = new Set(['movie', 'series']);

if (!accessToken && !apiKey) {
  console.error('Set TMDB_ACCESS_TOKEN or TMDB_API_KEY before running this script.');
  process.exit(1);
}

function cleanBrand(value) {
  return String(value || '')
    .replace(/Flixora/gi, 'CINMAPRO')
    .replace(/فليكسورا/g, 'CINMAPRO')
    .replace(/Cinmapro/g, 'CINMAPRO')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value) {
  return cleanBrand(value)
    .replace(/^\s*(?:فيلم|مسلسل|انمي|أنمي)\s+/u, '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleYear(title) {
  const year = String(title.year || '').match(/\b(19|20)\d{2}\b/)?.[0];
  if (year) return year;
  return `${title.clean_title || ''} ${title.raw_name || ''} ${title.slug || ''}`.match(/\b(19|20)\d{2}\b/)?.[0] || null;
}

function normalize(value) {
  return cleanTitle(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function tmdbUrl(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  if (!accessToken) url.searchParams.set('api_key', apiKey);
  return url;
}

async function tmdbFetch(endpoint, params = {}, attempt = 0) {
  const url = tmdbUrl(endpoint, params);
  let response;
  try {
    response = await fetch(url, {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}`, accept: 'application/json' }
        : { accept: 'application/json' },
    });
  } catch {
    if (attempt < 4) {
      await sleep(1000 * (attempt + 1));
      return tmdbFetch(endpoint, params, attempt + 1);
    }
    return null;
  }
  if (response.status === 429 && attempt < 5) {
    const retry = Number(response.headers.get('retry-after') || 2);
    await sleep((retry + 1) * 1000);
    return tmdbFetch(endpoint, params, attempt + 1);
  }
  if (!response.ok) {
    if (attempt < 2 && response.status >= 500) {
      await sleep(1000 * (attempt + 1));
      return tmdbFetch(endpoint, params, attempt + 1);
    }
    return null;
  }
  return response.json();
}

async function readCache() {
  try {
    const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    cache.search ||= {};
    return { search: cache.search };
  } catch {
    return { search: {} };
  }
}

async function writeCache(cache) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function mapCountry(value) {
  const countries = {
    US: 'الولايات المتحدة',
    GB: 'المملكة المتحدة',
    CA: 'كندا',
    AU: 'أستراليا',
    FR: 'فرنسا',
    DE: 'ألمانيا',
    IT: 'إيطاليا',
    ES: 'إسبانيا',
    JP: 'اليابان',
    KR: 'كوريا الجنوبية',
    CN: 'الصين',
    IN: 'الهند',
    MX: 'المكسيك',
    BR: 'البرازيل',
    AR: 'الأرجنتين',
    DK: 'الدنمارك',
    SE: 'السويد',
    NO: 'النرويج',
    NL: 'هولندا',
    BE: 'بلجيكا',
    TR: 'تركيا',
    EG: 'مصر',
    SA: 'السعودية',
    AE: 'الإمارات',
  };
  return countries[value] || value || null;
}

function mapLanguage(value) {
  const languages = {
    en: 'الإنجليزية',
    ar: 'العربية',
    ja: 'اليابانية',
    ko: 'الكورية',
    zh: 'الصينية',
    fr: 'الفرنسية',
    de: 'الألمانية',
    it: 'الإيطالية',
    es: 'الإسبانية',
    pt: 'البرتغالية',
    hi: 'الهندية',
    tr: 'التركية',
    da: 'الدنماركية',
    sv: 'السويدية',
    no: 'النرويجية',
    nl: 'الهولندية',
  };
  return languages[value] || value || null;
}

function englishGenreToArabic(value) {
  const map = {
    Action: 'أكشن',
    Adventure: 'مغامرة',
    Animation: 'أنمي',
    Comedy: 'كوميديا',
    Crime: 'جريمة',
    Documentary: 'وثائقي',
    Drama: 'دراما',
    Family: 'عائلي',
    Fantasy: 'فانتازيا',
    History: 'تاريخي',
    Horror: 'رعب',
    Music: 'موسيقى',
    Mystery: 'غموض',
    Romance: 'رومانسي',
    'Science Fiction': 'خيال علمي',
    'Sci-Fi & Fantasy': 'خيال علمي وفانتازيا',
    'TV Movie': 'فيلم تلفزيوني',
    Thriller: 'إثارة',
    War: 'حروب',
    Western: 'ويسترن',
    Kids: 'أطفال',
    News: 'أخبار',
    Reality: 'واقعي',
    Soap: 'دراما يومية',
    Talk: 'حواري',
    'War & Politics': 'حروب وسياسة',
  };
  return map[value] || value;
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ''));
}

function pickTrailer(details) {
  const videos = details?.videos?.results || [];
  const trailer = videos.find((video) => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
    || videos.find((video) => video.site === 'YouTube' && video.type === 'Trailer')
    || videos.find((video) => video.site === 'YouTube' && /trailer/i.test(video.name || ''))
    || videos.find((video) => video.site === 'YouTube');
  return trailer?.key || null;
}

function bestSearchResult(results, query, year, category) {
  const normalizedQuery = normalize(query);
  const scored = (results || []).map((item) => {
    const names = [item.title, item.name, item.original_title, item.original_name].map(normalize).filter(Boolean);
    const date = item.release_date || item.first_air_date || '';
    const resultYear = date.slice(0, 4);
    let score = 0;
    if (names.includes(normalizedQuery)) score += 70;
    if (names.some((name) => name.includes(normalizedQuery) || normalizedQuery.includes(name))) score += 35;
    if (year && resultYear === String(year)) score += 40;
    if (year && resultYear && Math.abs(Number(resultYear) - Number(year)) === 1) score += 10;
    if (category === 'movie' && item.media_type === 'movie') score += 10;
    if (category === 'series' && item.media_type === 'tv') score += 10;
    score += Math.min(Number(item.popularity || 0), 20);
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 25 ? scored[0].item : null;
}

async function searchTmdb(title, cache) {
  const category = title.category;
  const media = category === 'movie' ? 'movie' : 'tv';
  const query = cleanTitle(title.clean_title || title.raw_name || title.slug);
  const year = titleYear(title);
  const key = `${media}:${query}:${year || ''}`;
  if (cache.search[key] !== undefined) return cache.search[key];

  const params = {
    query,
    include_adult: 'false',
    language: 'en-US',
  };
  if (category === 'movie' && year) params.year = year;
  if (category === 'series' && year) params.first_air_date_year = year;

  let search = await tmdbFetch(`/search/${media}`, params);
  let result = bestSearchResult((search?.results || []).map((item) => ({ ...item, media_type: media })), query, year, category);

  if (!result && year) {
    const retryParams = { query, include_adult: 'false', language: 'en-US' };
    search = await tmdbFetch(`/search/${media}`, retryParams);
    result = bestSearchResult((search?.results || []).map((item) => ({ ...item, media_type: media })), query, year, category);
  }

  cache.search[key] = result ? result.id : null;
  return cache.search[key];
}

async function getDetails(category, tmdbId, cache) {
  if (!tmdbId) return null;
  const media = category === 'movie' ? 'movie' : 'tv';
  const append = category === 'movie'
    ? 'external_ids,release_dates,credits,videos'
    : 'external_ids,content_ratings,credits,videos';
  const [ar, en] = await Promise.all([
    tmdbFetch(`/${media}/${tmdbId}`, { language: 'ar-SA', append_to_response: append }),
    tmdbFetch(`/${media}/${tmdbId}`, { language: 'en-US', append_to_response: append }),
  ]);
  if (!ar && !en) return null;
  return { ar, en };
}

async function getSeason(tmdbId, seasonNumber, cache) {
  if (!tmdbId || !seasonNumber) return null;
  const [ar, en] = await Promise.all([
    tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'ar-SA' }),
    tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'en-US' }),
  ]);
  return { ar, en };
}

function getCountry(details, englishDetails) {
  const countries = details.production_countries?.length ? details.production_countries : englishDetails.production_countries || [];
  const names = countries.map((country) => hasArabic(country.name) ? country.name : mapCountry(country.iso_3166_1)).filter(Boolean);
  if (names.length) return [...new Set(names)].slice(0, 4).join('، ');
  const origin = details.origin_country?.[0] || englishDetails.origin_country?.[0];
  return mapCountry(origin);
}

function getLanguage(details, englishDetails) {
  const spoken = details.spoken_languages?.length ? details.spoken_languages : englishDetails.spoken_languages || [];
  const names = spoken.map((language) => hasArabic(language.name) ? language.name : mapLanguage(language.iso_639_1)).filter(Boolean);
  if (names.length) return [...new Set(names)].slice(0, 3).join('، ');
  return mapLanguage(details.original_language || englishDetails.original_language);
}

function getGenres(details, englishDetails, category) {
  const genres = (details.genres?.length ? details.genres : englishDetails.genres || [])
    .map((genre) => hasArabic(genre.name) ? genre.name : englishGenreToArabic(genre.name))
    .filter(Boolean);
  const unique = [...new Set(genres)];
  return category === 'anime' ? ['أنمي', ...unique.filter((genre) => genre !== 'أنمي')] : unique;
}

function buildArabicFallback(title, details, englishDetails) {
  const name = cleanTitle(title.clean_title || title.raw_name || title.slug);
  const kind = title.category === 'movie' ? 'الفيلم' : 'المسلسل';
  const genres = getGenres(details, englishDetails, title.category).slice(0, 4).join('، ') || title.genre || 'دراما';
  const year = (details.release_date || details.first_air_date || '').slice(0, 4) || title.year;
  const country = getCountry(details, englishDetails) || title.country;
  const lead = englishDetails.credits?.cast?.[0]?.character || englishDetails.credits?.cast?.[0]?.name || 'الشخصية الرئيسية';
  if (title.category === 'movie') {
    return `${lead} يواجه حدثًا يغيّر مسار الحكاية في ${name}، حيث تتحرك القصة داخل أجواء ${genres} وتربط الخطر باختيارات الشخصيات لا بالمشهد السريع وحده. ${year ? `صدر ${kind} عام ${year}` : `يعتمد ${kind} على بناء واضح`}${country ? ` ضمن إنتاج ${country}` : ''}، وتساعد بيانات TMDB على توضيح سياقه وطاقمه وتصنيفه. صفحة CINMAPRO تعرض القصة والمعلومات الأساسية والتريلر وروابط المشاهدة بترتيب مباشر.`;
  }
  return `${lead} يدخل مسارًا متغيرًا في ${name}، حيث تتقدم الحلقات عبر صراع مرتبط بالشخصيات وبالعالم الذي تعيش داخله. ينتمي العمل إلى أجواء ${genres}${year ? ` وبدأ عرضه عام ${year}` : ''}${country ? ` ضمن إنتاج ${country}` : ''}. تساعد بيانات TMDB على تنظيم القصة والمواسم والحلقات، بينما تعرض صفحة CINMAPRO التريلر وروابط المشاهدة والمعلومات الأساسية دون خلط بين المواسم.`;
}

function trimMeta(value) {
  const text = cleanBrand(value);
  if (text.length <= 155) return text;
  return `${text.slice(0, 152).replace(/\s+\S*$/, '')}…`;
}

function applyDetails(title, detailsPair, tmdbId) {
  const ar = detailsPair.ar || {};
  const en = detailsPair.en || {};
  const details = ar.id ? ar : en;
  const englishDetails = en.id ? en : ar;
  const media = title.category === 'movie' ? 'movie' : 'tv';
  const originalStory = title.story || title.description || '';
  const arOverview = hasArabic(ar.overview) ? cleanBrand(ar.overview) : '';
  const story = arOverview || buildArabicFallback(title, details, englishDetails) || originalStory;
  const name = cleanTitle(title.clean_title || title.raw_name || title.slug);
  const date = title.category === 'movie' ? details.release_date : details.first_air_date;
  const runtime = title.category === 'movie'
    ? details.runtime
    : details.episode_run_time?.[0] || details.last_episode_to_air?.runtime || null;
  const cast = englishDetails.credits?.cast?.slice(0, 6).map((person) => person.name).filter(Boolean);
  const director = title.category === 'movie'
    ? englishDetails.credits?.crew?.filter((person) => person.job === 'Director').map((person) => person.name).filter(Boolean)
    : englishDetails.created_by?.map((person) => person.name).filter(Boolean);
  const genres = getGenres(details, englishDetails, title.category);

  title.tmdb_id = tmdbId;
  title.tmdb_url = `https://www.themoviedb.org/${media}/${tmdbId}`;
  title.original_title = title.category === 'movie'
    ? englishDetails.original_title || englishDetails.title || title.original_title || null
    : englishDetails.original_name || englishDetails.name || title.original_title || null;
  title.story = story;
  title.description = story;
  title.year = date?.slice(0, 4) || title.year || null;
  title.rating = typeof details.vote_average === 'number' ? details.vote_average.toFixed(1) : title.rating;
  title.imdb_rating = title.rating;
  title.country = getCountry(details, englishDetails) || title.country || null;
  title.language = getLanguage(details, englishDetails) || title.language || null;
  if (runtime && title.category === 'movie') title.duration = `${runtime} دقيقة`;
  if (runtime && title.category === 'series' && !title.duration) title.duration = `${runtime} دقيقة للحلقة`;
  if (genres.length) title.genre = genres.join('، ');
  if (cast?.length) title.stars = cast.join('، ');
  if (director?.length) title.director = director.join('، ');
  title.trailerId ||= pickTrailer(englishDetails) || pickTrailer(details);
  if (title.category === 'series') {
    title.seasons_count ||= details.number_of_seasons || title.seasons_count;
    title.episodes_count ||= details.number_of_episodes || title.episodes_count;
  }

  title.seoContent ||= {};
  title.seoContent.generatedAt = today;
  title.seoContent.mainDescription = story;
  const kindLabel = title.category === 'movie' ? 'فيلم' : 'مسلسل';
  const hook = story.split(/[.!؟،]/).map((part) => part.trim()).find(Boolean) || 'قصة ومعلومات محدثة وروابط مشاهدة واضحة';
  title.seoContent.metaDescription = trimMeta(`${title.original_title || name} ${name} ${kindLabel} ${title.year || ''} | ${hook} | شاهد مترجم HD على CINMAPRO`);
  title.seoContent.highlights = title.category === 'movie'
    ? `تم تحديث بيانات ${name} من TMDB مع توضيح القصة والطاقم والتصنيف والتريلر عند توفره. تساعد الصفحة على فهم أجواء الفيلم قبل الانتقال إلى المشاهدة.`
    : `تم تحديث بيانات ${name} من TMDB مع تنظيم القصة والمواسم والحلقات والتريلر عند توفره. تساعد الصفحة على متابعة المسلسل بترتيب واضح داخل CINMAPRO.`;
  title.seoContent.sources ||= {};
  title.seoContent.sources.tmdb = title.tmdb_url;
}

async function applyEpisodeDetails(title, cache) {
  if (title.category !== 'series' || !title.tmdb_id) return 0;
  let updated = 0;
  for (const season of title.seasons || []) {
    const seasonData = await getSeason(title.tmdb_id, Number(season.season), cache);
    const arEpisodes = new Map((seasonData?.ar?.episodes || []).map((episode) => [Number(episode.episode_number), episode]));
    const enEpisodes = new Map((seasonData?.en?.episodes || []).map((episode) => [Number(episode.episode_number), episode]));
    for (const episode of season.episodes || []) {
      const arEpisode = arEpisodes.get(Number(episode.episode));
      const enEpisode = enEpisodes.get(Number(episode.episode));
      if (!arEpisode && !enEpisode) continue;
      const selected = arEpisode || enEpisode;
      const arEpisodeOverview = hasArabic(arEpisode?.overview) ? cleanBrand(arEpisode.overview) : null;
      const arEpisodeName = hasArabic(arEpisode?.name) ? cleanBrand(arEpisode.name) : null;
      if (arEpisodeName) episode.title = arEpisodeName;
      episode.overview = arEpisodeOverview || episode.overview || null;
      episode.air_date = selected.air_date || episode.air_date || null;
      episode.runtime = selected.runtime || episode.runtime || null;
      episode.tmdb_episode_id = selected.id || episode.tmdb_episode_id || null;
      episode.tmdb_still_path = selected.still_path || episode.tmdb_still_path || null;
      updated += 1;
    }
  }
  return updated;
}

async function main() {
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json')).sort();
  const entries = [];
  for (const file of files) {
    const fullPath = path.join(titlesDir, file);
    const title = await readJson(fullPath);
    if (!categories.has(title.category)) continue;
    entries.push({ file, fullPath, title });
  }

  const cache = await readCache();
  let matched = 0;
  let notFound = 0;
  let updatedDetails = 0;
  let updatedEpisodes = 0;
  let errors = 0;

  await mapLimit(entries, 6, async (entry, index) => {
    try {
      const tmdbId = entry.title.tmdb_id || await searchTmdb(entry.title, cache);
      if (!tmdbId) {
        notFound += 1;
        return;
      }
      const details = await getDetails(entry.title.category, tmdbId, cache);
      if (!details) {
        notFound += 1;
        return;
      }
      applyDetails(entry.title, details, tmdbId);
      updatedEpisodes += await applyEpisodeDetails(entry.title, cache);
      await fs.writeFile(entry.fullPath, `${JSON.stringify(entry.title, null, 2)}\n`, 'utf8');
      matched += 1;
      updatedDetails += 1;
      if ((index + 1) % 100 === 0) {
        await writeCache(cache);
        console.log(`TMDB movie/series checked: ${index + 1}/${entries.length}`);
      }
    } catch (error) {
      errors += 1;
      console.warn(`Failed ${entry.file}: ${error.message}`);
    }
  });

  await writeCache(cache);
  console.log(JSON.stringify({
    scanned: entries.length,
    matched,
    notFound,
    updatedDetails,
    updatedEpisodes,
    errors,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
