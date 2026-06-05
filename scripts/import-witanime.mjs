import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const posterDir = path.join(rootDir, 'public', 'images', 'anime');
const sourceFile = process.argv[2] || 'C:/Users/tometo.man/Downloads/cleaned_witanime_full_with_posters_no_urls.csv';

const ANIME_LABEL = 'أنمي';
const DEFAULT_COUNTRY = 'اليابان';
const DEFAULT_LANGUAGE = 'مترجم';
const DEFAULT_QUALITY = 'FHD';

function cleanTitle(value) {
  return String(value || '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return cleanTitle(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(?:^|\s)(anime|انمي|أنمي|الموسم|season|tv|ova|ona|movie|film)(?:\s|$)/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  const base = cleanTitle(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 140)
    .replace(/-+$/g, '');
  return base || `anime-${Date.now()}`;
}

function toInt(value, fallback = 1) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isYonaplay(name, url) {
  return /yonaplay/i.test(`${name || ''} ${url || ''}`);
}

function isValidUrl(value) {
  const url = String(value || '').trim();
  if (!url || url === '#' || /^about:blank$/i.test(url)) return false;
  if (/^(javascript|null|undefined|n\/a):?/i.test(url)) return false;
  return /^https?:\/\//i.test(url) || /^\/\//.test(url);
}

function normalizeServerLabel(value, index) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || `سيرفر ${index}`;
}

function collectRowServers(row) {
  const servers = [];
  const seen = new Set();
  for (let index = 1; index <= 10; index += 1) {
    const name = row[`server${index}_name`];
    const url = String(row[`server${index}_url`] || '').trim();
    if (isYonaplay(name, url) || !isValidUrl(url) || seen.has(url)) continue;
    seen.add(url);
    servers.push({
      id: servers.length + 1,
      label: normalizeServerLabel(name, servers.length + 1),
      url,
    });
  }
  return servers;
}

function csvGenres(value) {
  return String(value || '')
    .split(/[,\u060C/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueGenres(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.flatMap(csvGenres)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function posterExtension(url, contentType = '') {
  const fromType = contentType.includes('png')
    ? '.png'
    : contentType.includes('webp')
      ? '.webp'
      : contentType.includes('gif')
        ? '.gif'
        : contentType.includes('jpeg') || contentType.includes('jpg')
          ? '.jpg'
          : '';
  if (fromType) return fromType;
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

async function downloadPoster(url, slug, existingPoster) {
  if (!isValidUrl(url)) return existingPoster || null;

  await fs.mkdir(posterDir, { recursive: true });
  const known = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  for (const ext of known) {
    const relative = `/images/anime/${slug}${ext}`;
    try {
      await fs.access(path.join(rootDir, 'public', relative));
      return relative;
    } catch {
      // keep looking
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 CINMAPRO poster importer',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    if (!response.ok) return existingPoster || url;
    const contentType = response.headers.get('content-type') || '';
    const ext = posterExtension(url, contentType);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return existingPoster || url;
    const target = path.join(posterDir, `${slug}${ext}`);
    await fs.writeFile(target, bytes);
    return `/images/anime/${slug}${ext}`;
  } catch {
    return existingPoster || url;
  } finally {
    clearTimeout(timeout);
  }
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

async function readExistingTitles() {
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json'));
  const titles = [];
  for (const file of files) {
    const fullPath = path.join(titlesDir, file);
    const title = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    titles.push({ file, fullPath, title });
  }
  return titles;
}

function titleSearchValues(title) {
  return [
    title.clean_title,
    title.raw_name,
    title.slug,
    String(title.url || '').split('/').filter(Boolean).pop(),
  ]
    .map(normalizeTitle)
    .filter(Boolean);
}

function makeDescription(name, genre, seasonsCount, episodesCount) {
  const genreText = genre || 'أكشن، دراما، مغامرة';
  return `أنمي ${name} متوفر على CINMAPRO بترجمة عربية وروابط مشاهدة مرتبة حسب المواسم والحلقات. يجمع العمل بين أجواء ${genreText}، ويضم ${seasonsCount} موسم و${episodesCount} حلقة مع سيرفرات متعددة تساعدك على اختيار المشاهدة الأنسب.`;
}

function ensureSeason(title, seasonNumber) {
  title.seasons ||= [];
  let season = title.seasons.find((item) => Number(item.season) === seasonNumber);
  if (!season) {
    season = { season: seasonNumber, episodes_count: 0, episodes: [] };
    title.seasons.push(season);
  }
  return season;
}

function ensureEpisode(season, episodeNumber) {
  season.episodes ||= [];
  let episode = season.episodes.find((item) => Number(item.episode) === episodeNumber);
  if (!episode) {
    episode = { episode: episodeNumber, title: `الحلقة ${episodeNumber}`, servers: [] };
    season.episodes.push(episode);
  }
  return episode;
}

function prependServers(episode, incomingServers) {
  const seen = new Set();
  const merged = [];
  for (const server of [...incomingServers, ...(episode.servers || [])]) {
    const url = String(server.url || '').trim();
    if (!isValidUrl(url) || isYonaplay(server.label, url) || seen.has(url)) continue;
    seen.add(url);
    merged.push({
      id: merged.length + 1,
      label: normalizeServerLabel(server.label, merged.length + 1),
      url,
    });
  }
  episode.servers = merged;
}

function finalizeTitle(title) {
  title.seasons.sort((a, b) => Number(a.season) - Number(b.season));
  let episodeTotal = 0;
  for (const season of title.seasons) {
    season.episodes.sort((a, b) => Number(a.episode) - Number(b.episode));
    season.episodes_count = season.episodes.length;
    episodeTotal += season.episodes.length;
  }
  title.seasons_count = title.seasons.length;
  title.episodes_count = episodeTotal;
}

function makeNewTitle(group, slug, poster) {
  const seasons = [];
  const genre = uniqueGenres(group.rows.map((row) => row.genres)).join('، ');
  const title = {
    slug,
    clean_title: group.name,
    raw_name: `انمي ${group.name}`,
    category: 'anime',
    category_label: ANIME_LABEL,
    poster,
    note: `تم استيراد الحلقات من ملف Witanime بعد حذف السيرفرات التالفة.`,
    matched_poster: Boolean(poster),
    seasons_count: 0,
    episodes_count: 0,
    seasons,
    description: '',
    url: `/anime/${slug}`,
    story: null,
    year: null,
    quality: DEFAULT_QUALITY,
    duration: null,
    language: DEFAULT_LANGUAGE,
    country: DEFAULT_COUNTRY,
    director: null,
    stars: null,
    genre,
    trailerId: null,
    rating: null,
    imdb_rating: null,
    seoContent: {
      generatedAt: new Date().toISOString().slice(0, 10),
      arabicTitle: group.name,
      mainDescription: '',
      metaDescription: `${group.name} أنمي مترجم | حلقات ومواسم وروابط مشاهدة بجودة عالية على CINMAPRO`,
      highlights: `يعرض ${group.name} حلقاته بترتيب واضح حسب الموسم والحلقة، مع سيرفرات مشاهدة مختارة بعد حذف الروابط التالفة.`,
      beforeWatchingPoints: [
        'يفضل البدء من الحلقة الأولى إذا كان العمل قصصياً.',
        'استخدم السيرفر الأول لأنه مضاف من القائمة الأحدث.',
        'بدل السيرفر إذا واجهت بطئاً في التشغيل.',
      ],
    },
  };
  title.description = makeDescription(group.name, genre, 1, 1);
  title.seoContent.mainDescription = title.description;
  return title;
}

function uniqueSlug(baseSlug, usedSlugs) {
  let slug = baseSlug;
  if (usedSlugs.has(slug)) slug = `${baseSlug}-anime`;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-anime-${counter}`;
    counter += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

async function main() {
  const rawCsv = await fs.readFile(sourceFile);
  const rows = parse(rawCsv, { columns: true, bom: true, skip_empty_lines: true });
  const existing = await readExistingTitles();
  const usedSlugs = new Set(existing.map(({ title }) => title.slug));
  const animeIndex = new Map();

  for (const entry of existing.filter(({ title }) => title.category === 'anime')) {
    for (const value of titleSearchValues(entry.title)) {
      if (!animeIndex.has(value)) animeIndex.set(value, entry);
    }
  }

  const groups = new Map();
  for (const row of rows) {
    const name = cleanTitle(row.anime_title);
    if (!name) continue;
    const key = normalizeTitle(name);
    if (!groups.has(key)) groups.set(key, { name, key, rows: [], poster: row.poster || '' });
    const group = groups.get(key);
    group.rows.push(row);
    if (!group.poster && row.poster) group.poster = row.poster;
  }

  const importGroups = [...groups.values()];
  const posterByGroup = new Map();
  let posterDone = 0;
  await mapLimit(importGroups, 14, async (group) => {
    const matched = animeIndex.get(group.key);
    const baseSlug = matched?.title.slug || slugify(group.name);
    const poster = await downloadPoster(group.poster, baseSlug, matched?.title.poster || null);
    posterByGroup.set(group.key, poster);
    posterDone += 1;
    if (posterDone % 100 === 0) console.log(`Downloaded/checked posters: ${posterDone}/${importGroups.length}`);
  });

  let matchedTitles = 0;
  let createdTitles = 0;
  let touchedTitles = 0;
  let addedEpisodes = 0;
  let addedServerLinks = 0;
  let skippedYonaplay = 0;
  const touched = new Map();

  for (const group of importGroups) {
    let entry = animeIndex.get(group.key);
    if (entry) {
      matchedTitles += 1;
    } else {
      const slug = uniqueSlug(slugify(group.name), usedSlugs);
      const fullPath = path.join(titlesDir, `${slug}.json`);
      const title = makeNewTitle(group, slug, posterByGroup.get(group.key) || group.poster || null);
      entry = { file: `${slug}.json`, fullPath, title };
      createdTitles += 1;
    }

    const title = entry.title;
    title.poster = posterByGroup.get(group.key) || title.poster || group.poster || null;
    title.matched_poster = Boolean(title.poster);
    title.category = 'anime';
    title.category_label = ANIME_LABEL;
    title.url = `/anime/${title.slug}`;
    title.quality ||= DEFAULT_QUALITY;
    title.language ||= DEFAULT_LANGUAGE;
    title.country ||= DEFAULT_COUNTRY;

    const importedGenres = uniqueGenres(group.rows.map((row) => row.genres));
    if (!title.genre && importedGenres.length) title.genre = importedGenres.join('، ');

    for (const row of group.rows) {
      for (let index = 1; index <= 10; index += 1) {
        if (isYonaplay(row[`server${index}_name`], row[`server${index}_url`])) skippedYonaplay += 1;
      }
      const seasonNumber = toInt(row.season, 1);
      const episodeNumber = toInt(row.episode, 1);
      const season = ensureSeason(title, seasonNumber);
      const beforeEpisodeCount = season.episodes.length;
      const episode = ensureEpisode(season, episodeNumber);
      if (season.episodes.length > beforeEpisodeCount) addedEpisodes += 1;
      const beforeServers = episode.servers?.length || 0;
      prependServers(episode, collectRowServers(row));
      const afterServers = episode.servers?.length || 0;
      if (afterServers > beforeServers) addedServerLinks += afterServers - beforeServers;
    }

    finalizeTitle(title);
    if (!title.description) {
      title.description = makeDescription(title.clean_title, title.genre, title.seasons_count, title.episodes_count);
    }
    if (title.seoContent?.mainDescription === '') {
      title.seoContent.mainDescription = title.description;
    }
    touched.set(entry.fullPath, title);
  }

  for (const [fullPath, title] of touched) {
    await fs.writeFile(fullPath, `${JSON.stringify(title, null, 2)}\n`, 'utf8');
    touchedTitles += 1;
  }

  console.log(JSON.stringify({
    sourceFile,
    rows: rows.length,
    uniqueAnimeInCsv: importGroups.length,
    matchedTitles,
    createdTitles,
    touchedTitles,
    addedEpisodes,
    addedServerLinks,
    skippedYonaplay,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
