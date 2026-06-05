import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const defaultBackupDir = path.resolve(rootDir, '..', 'backups', 'before-witanime-import-2026-05-18-132937', 'titles');
const backupTitlesDir = process.argv[2] || defaultBackupDir;
const cacheDir = path.join(rootDir, 'scripts', '.cache');
const cacheFile = path.join(cacheDir, 'tmdb-anime-cache.json');
const today = new Date().toISOString().slice(0, 10);
const accessToken = process.env.TMDB_ACCESS_TOKEN || '';
const apiKey = process.env.TMDB_API_KEY || '';

if (!accessToken && !apiKey) {
  console.error('Set TMDB_ACCESS_TOKEN or TMDB_API_KEY before running this script.');
  process.exit(1);
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/^\s*(?:انمي|أنمي|مسلسل|فيلم)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function baseTitle(value) {
  let title = cleanTitle(value)
    .replace(/\s*[:\-–—]\s*(?:\d+(?:st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+)\s*$/i, '')
    .replace(/\s+(?:\d+(?:st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+|cour\s+\d+)\s*$/i, '')
    .replace(/\s+(?:the\s+final|final\s+season|final)\s*$/i, '')
    .replace(/\s+(?:ii|iii|iv|v)\s*$/i, '')
    .replace(/\s+(?:2|3|4|5)(?:nd|rd|th)?\s*season\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || cleanTitle(value);
}

function inferSeasonNumber(title) {
  const seasons = [...(title.seasons || [])].map((season) => Number(season.season)).filter(Number.isFinite);
  if (seasons.length === 1) return seasons[0];
  const value = `${title.clean_title || ''} ${title.slug || ''}`;
  const numeric = value.match(/\bseason[\s-]*(\d+)\b/i)?.[1]
    || value.match(/\b(\d+)(?:st|nd|rd|th)[\s-]*season\b/i)?.[1];
  if (numeric) return Number(numeric);
  if (/\bii\b/i.test(value) || /-ii\b/i.test(value)) return 2;
  if (/\biii\b/i.test(value) || /-iii\b/i.test(value)) return 3;
  if (/\biv\b/i.test(value) || /-iv\b/i.test(value)) return 4;
  return seasons[0] || null;
}

function seasonLabel(number, title) {
  if (number) return `الموسم ${number}`;
  if (/final/i.test(title.clean_title || '')) return 'الموسم الأخير';
  return 'موسم مرتبط';
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
  const response = await fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } : { accept: 'application/json' },
  });
  if (response.status === 429 && attempt < 4) {
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch {
    return { search: {}, details: {}, seasons: {} };
  }
}

async function writeCache(cache) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function mapCountry(value) {
  const countries = {
    JP: 'اليابان',
    CN: 'الصين',
    KR: 'كوريا الجنوبية',
    US: 'الولايات المتحدة',
    GB: 'المملكة المتحدة',
  };
  return countries[value] || value || null;
}

function mapLanguage(value) {
  const languages = {
    ja: 'اليابانية',
    zh: 'الصينية',
    ko: 'الكورية',
    en: 'الإنجليزية',
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
    Drama: 'دراما',
    Family: 'عائلي',
    Fantasy: 'فانتازيا',
    Mystery: 'غموض',
    Romance: 'رومانسي',
    'Sci-Fi & Fantasy': 'خيال علمي وفانتازيا',
    War: 'حروب',
  };
  return map[value] || value;
}

function pickTrailer(details) {
  const videos = details?.videos?.results || [];
  const trailer = videos.find((video) => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
    || videos.find((video) => video.site === 'YouTube' && video.type === 'Trailer')
    || videos.find((video) => video.site === 'YouTube');
  return trailer?.key || null;
}

function bestSearchResult(results, query) {
  const normalizedQuery = normalize(query);
  const scored = (results || []).map((item) => {
    const names = [item.name, item.original_name].map(normalize);
    let score = 0;
    if (names.includes(normalizedQuery)) score += 60;
    if (names.some((name) => name.includes(normalizedQuery) || normalizedQuery.includes(name))) score += 30;
    if (item.original_language === 'ja') score += 10;
    if ((item.origin_country || []).includes('JP')) score += 10;
    score += Math.min(Number(item.popularity || 0), 20);
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function buildArabicFromTmdb(title, details, fallbackStory) {
  const name = cleanTitle(title.clean_title);
  const genres = (details.genres || []).map((genre) => genre.name).filter(Boolean).slice(0, 4).join('، ') || title.genre || 'أنمي';
  const firstYear = details.first_air_date ? details.first_air_date.slice(0, 4) : title.year;
  const seasons = details.number_of_seasons || title.seasons_count;
  const episodes = details.number_of_episodes || title.episodes_count;
  return `يدور أنمي ${name} ضمن أجواء ${genres}، ويعتمد على حكاية تتطور عبر الشخصيات والمواجهات بدل الاكتفاء بفكرة واحدة. بدأ عرض العمل${firstYear ? ` عام ${firstYear}` : ''}، وتوضح بيانات TMDB أنه يضم ${seasons} موسم و${episodes} حلقة. ${fallbackStory || 'تساعد صفحة CINMAPRO على متابعة الحلقات بترتيب واضح وروابط مشاهدة محدثة.'}`;
}

function trimMeta(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 155) return text;
  return `${text.slice(0, 152).replace(/\s+\S*$/, '')}…`;
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ''));
}

async function findTmdbForGroup(group, cache) {
  const query = group.base;
  if (cache.search[query] !== undefined) return cache.search[query];
  const search = await tmdbFetch('/search/tv', {
    query,
    include_adult: 'false',
    language: 'en-US',
  });
  const result = bestSearchResult(search?.results || [], query);
  cache.search[query] = result ? result.id : null;
  return cache.search[query];
}

async function getDetails(tmdbId, cache) {
  if (!tmdbId) return null;
  if (cache.details[tmdbId]) return cache.details[tmdbId];
  const [ar, en] = await Promise.all([
    tmdbFetch(`/tv/${tmdbId}`, { language: 'ar-SA', append_to_response: 'external_ids,content_ratings,credits,videos' }),
    tmdbFetch(`/tv/${tmdbId}`, { language: 'en-US', append_to_response: 'external_ids,content_ratings,credits,videos' }),
  ]);
  if (!ar && !en) return null;
  cache.details[tmdbId] = { ar, en };
  return cache.details[tmdbId];
}

async function getSeason(tmdbId, seasonNumber, cache) {
  if (!tmdbId || !seasonNumber) return null;
  const key = `${tmdbId}:${seasonNumber}`;
  if (cache.seasons[key]) return cache.seasons[key];
  const [ar, en] = await Promise.all([
    tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'ar-SA' }),
    tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'en-US' }),
  ]);
  cache.seasons[key] = { ar, en };
  return cache.seasons[key];
}

async function main() {
  const backupFiles = new Set((await fs.readdir(backupTitlesDir)).filter((file) => file.endsWith('.json')));
  const allFiles = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json'));
  const entries = [];
  for (const file of allFiles) {
    if (backupFiles.has(file)) continue;
    const fullPath = path.join(titlesDir, file);
    const title = await readJson(fullPath);
    if (title.category !== 'anime') continue;
    entries.push({ file, fullPath, title });
  }

  const groups = new Map();
  for (const entry of entries) {
    const base = baseTitle(entry.title.clean_title || entry.title.raw_name || entry.title.slug);
    const key = normalize(base);
    if (!groups.has(key)) groups.set(key, { key, base, entries: [] });
    groups.get(key).entries.push(entry);
  }

  let linkedGroups = 0;
  for (const group of groups.values()) {
    if (group.entries.length < 2) continue;
    linkedGroups += 1;
    const related = group.entries
      .map((entry) => {
        const season = inferSeasonNumber(entry.title);
        return {
          slug: entry.title.slug,
          title: cleanTitle(entry.title.clean_title),
          url: `/anime/${entry.title.slug}`,
          season,
          seasonLabel: seasonLabel(season, entry.title),
          episodesCount: entry.title.episodes_count || 0,
          poster: entry.title.poster || null,
        };
      })
      .sort((a, b) => (a.season || 999) - (b.season || 999) || a.title.localeCompare(b.title));
    for (const entry of group.entries) {
      entry.title.relatedAnimeSeasons = related;
    }
  }

  const cache = await readCache();
  let tmdbMatched = 0;
  let updatedDetails = 0;
  let updatedEpisodes = 0;
  let notFound = 0;

  await mapLimit([...groups.values()], 4, async (group, index) => {
    const tmdbId = await findTmdbForGroup(group, cache);
    if (!tmdbId) {
      notFound += group.entries.length;
      return;
    }
    const detailsPair = await getDetails(tmdbId, cache);
    if (!detailsPair) return;
    const ar = detailsPair.ar || {};
    const en = detailsPair.en || {};
    const details = ar.id ? ar : en;
    const englishDetails = en.id ? en : ar;
    tmdbMatched += group.entries.length;

    for (const entry of group.entries) {
      const title = entry.title;
      const originalStory = title.story || title.description || '';
      const arOverview = hasArabic(ar.overview) ? ar.overview : '';
      const story = arOverview || buildArabicFromTmdb(title, details, originalStory);
      title.tmdb_id = tmdbId;
      title.tmdb_url = `https://www.themoviedb.org/tv/${tmdbId}`;
      title.original_title = englishDetails.original_name || englishDetails.name || title.original_title || null;
      title.story = story;
      title.description = story;
      title.year = details.first_air_date?.slice(0, 4) || title.year || null;
      title.rating = typeof details.vote_average === 'number' ? details.vote_average.toFixed(1) : title.rating;
      title.imdb_rating = title.rating;
      title.country = mapCountry(details.origin_country?.[0]) || title.country || null;
      title.language = mapLanguage(details.original_language) || title.language || null;
      const genres = (details.genres?.length ? details.genres : englishDetails.genres || [])
        .map((genre) => hasArabic(genre.name) ? genre.name : englishGenreToArabic(genre.name))
        .filter(Boolean);
      if (genres.length) title.genre = [...new Set(['أنمي', ...genres])].join('، ');
      const cast = englishDetails.credits?.cast?.slice(0, 6).map((person) => person.name).filter(Boolean);
      if (cast?.length) title.stars = cast.join('، ');
      const creators = englishDetails.created_by?.map((person) => person.name).filter(Boolean);
      if (creators?.length) title.director = creators.join('، ');
      title.trailerId ||= pickTrailer(englishDetails) || pickTrailer(details);
      title.seoContent ||= {};
      title.seoContent.generatedAt = today;
      title.seoContent.mainDescription = story;
      title.seoContent.metaDescription = trimMeta(`${cleanTitle(title.clean_title)} أنمي ${title.year || ''} | ${story.split(/[.!؟،]/).find(Boolean) || 'حلقات مترجمة بتفاصيل محدثة'} | شاهد HD على CINMAPRO`);
      title.seoContent.highlights = `تم تحديث بيانات ${cleanTitle(title.clean_title)} من TMDB مع ربط المواسم المتاحة وترتيب الحلقات داخل CINMAPRO. تظهر الصفحة القصة والتصنيفات والتقييم وروابط المشاهدة بدون خلط بين المواسم.`;
      title.seoContent.sources ||= {};
      title.seoContent.sources.tmdb = title.tmdb_url;
      updatedDetails += 1;

      for (const season of title.seasons || []) {
        const seasonData = await getSeason(tmdbId, Number(season.season), cache);
        const arEpisodes = new Map((seasonData?.ar?.episodes || []).map((episode) => [Number(episode.episode_number), episode]));
        const enEpisodes = new Map((seasonData?.en?.episodes || []).map((episode) => [Number(episode.episode_number), episode]));
        for (const episode of season.episodes || []) {
          const arEpisode = arEpisodes.get(Number(episode.episode));
          const enEpisode = enEpisodes.get(Number(episode.episode));
          if (!arEpisode && !enEpisode) continue;
          const selected = arEpisode || enEpisode;
          const arEpisodeOverview = hasArabic(arEpisode?.overview) ? arEpisode.overview : null;
          const arEpisodeName = hasArabic(arEpisode?.name) ? arEpisode.name : null;
          if (arEpisodeName) episode.title = arEpisodeName;
          else if (!episode.title || /^الحلقة\s+\d+$/u.test(episode.title)) episode.title = `الحلقة ${episode.episode}`;
          episode.overview = arEpisodeOverview || episode.overview || null;
          episode.air_date = selected.air_date || episode.air_date || null;
          episode.runtime = selected.runtime || episode.runtime || null;
          episode.tmdb_episode_id = selected.id || episode.tmdb_episode_id || null;
          episode.tmdb_still_path = selected.still_path || episode.tmdb_still_path || null;
          updatedEpisodes += 1;
        }
      }
    }

    if ((index + 1) % 50 === 0) {
      await writeCache(cache);
      console.log(`TMDB groups checked: ${index + 1}/${groups.size}`);
    }
  });

  await writeCache(cache);
  for (const entry of entries) {
    await fs.writeFile(entry.fullPath, `${JSON.stringify(entry.title, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify({
    backupTitlesDir,
    newAnime: entries.length,
    groups: groups.size,
    linkedGroups,
    tmdbMatched,
    notFound,
    updatedDetails,
    updatedEpisodes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
