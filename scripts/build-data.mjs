import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const generatedDir = path.join(rootDir, 'src', 'data', 'generated');
const cacheDir = path.join(rootDir, 'scripts', '.cache');

function sanitizeBrand(value) {
  if (typeof value === 'string') {
    return value
      .replace(/Flixora/gi, 'CinemaPlus')
      .replace(/فليكسورا/g, 'سينما بلس')
      .replace(/CINMAPRO/gi, 'CinemaPlus')
      .replace(/Cinmapro/g, 'CinemaPlus');
  }
  if (Array.isArray(value)) return value.map(sanitizeBrand);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizeBrand(nested)])
    );
  }
  return value;
}

/* ───────────────  TMDB ENRICHMENT  ─────────────── */

function loadJsonSafe(file) {
  try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); } catch { return {}; }
}

function tmdbKind(title) {
  const url = title.tmdb_url || '';
  return /\/tv\//.test(url) ? 'tv' : /\/movie\//.test(url) ? 'movie' : (title.category === 'movie' ? 'movie' : 'tv');
}

/** Strip any source / brand / TMDB attribution that must NOT appear in plot text. */
function cleanPlot(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  // Remove sentences that mention the data source or self-promotion.
  t = t
    .replace(/[^.؟!]*\bTMDB\b[^.؟!]*[.؟!]?/gi, '')
    .replace(/[^.؟!]*بيانات (?:المصدر|TMDB|الموقع)[^.؟!]*[.؟!]?/g, '')
    .replace(/[^.؟!]*سينما بلس[^.؟!]*[.؟!]?/g, '')
    .replace(/[^.؟!]*CinemaPlus[^.؟!]*[.؟!]?/gi, '')
    // Legacy brand + self-promotion sentences from the old dataset.
    .replace(/[^.؟!]*CINMAPRO[^.؟!]*[.؟!]?/gi, '')
    .replace(/[^.؟!]*صفحة\s+\S+\s+تعرض[^.؟!]*[.؟!]?/g, '')
    .replace(/[^.؟!]*(?:صدر|تم تحديث)[^.؟!]*[.؟!]?/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

// Bayesian (IMDb-style) weighted rating so a 9.5 with 3 votes does not beat an
// 8.4 with 4000 votes. m = minimum votes to be "credible", C = global mean.
const BAYES_M = 50;
const BAYES_C = 6.5;
function weightedRating(vote, votes) {
  const v = Number(votes) || 0;
  const R = Number(vote) || 0;
  if (v <= 0) return 0;
  return (v / (v + BAYES_M)) * R + (BAYES_M / (v + BAYES_M)) * BAYES_C;
}

function cleanTitleForFallback(title) {
  return String(title.clean_title || title.raw_name || title.slug || '')
    .replace(/^(فيلم|مسلسل|انمي|أنمي|اوفا|أوفا)\s+/u, '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || String(title.slug || 'هذا العمل');
}

function fallbackPlot(title) {
  const name = cleanTitleForFallback(title);
  const type = title.category === 'movie' ? 'الفيلم' : title.category === 'series' ? 'المسلسل' : 'الأنمي';
  const year = title.year ? ` عام ${title.year}` : '';
  const genre = title.genre ? `ضمن أجواء ${String(title.genre).replace(/\s+/g, ' ').trim()}` : 'ضمن أجواء درامية وترفيهية';
  const country = title.country ? `، ومن إنتاج ${String(title.country).replace(/\s+/g, ' ').trim()}` : '';
  const format = title.category === 'movie'
    ? `${title.duration ? `مدة العمل ${title.duration}` : 'يتوفر العمل كصفحة فيلم مستقلة'}، مع معلومات الجودة والترجمة والسيرفرات عند توفرها`
    : `يتكون العمل من ${title.seasons_count || 1} موسم و${title.episodes_count || 1} حلقة، مع ترتيب واضح للمواسم والحلقات`;
  return `تدور أحداث ${type} ${name}${year} ${genre}${country}، حيث تتطور الحكاية عبر شخصيات ومواقف تمنح العمل طابعه الخاص. ${format}. تساعد هذه المعلومات على فهم طبيعة العمل قبل المتابعة، مع عرض التصنيف والجودة واللغة بصورة مباشرة دون حشو أو تكرار.`;
}

function contextualPlotSuffix(title) {
  const type = title.category === 'movie' ? 'الفيلم' : title.category === 'series' ? 'المسلسل' : 'الأنمي';
  const bits = [title.genre, title.year, title.country]
    .filter(Boolean)
    .map((part) => String(part).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const context = bits.length ? `، مع إبراز ${bits.join('، ')}` : '';
  return `تكتمل صفحة ${type} بمعلومات واضحة عن التصنيف والجودة وترتيب المحتوى${context}، لتقديم وصف كافٍ ومفيد بعيدًا عن العبارات المكررة.`;
}

// Anime entries whose *title* is just a special / OVA / recap — demote them.
function isSpecialEntry(title) {
  const t = `${title.clean_title || ''} ${title.raw_name || ''}`;
  return /الحلقة الخاصة|\bOVA\b|\bSpecial\b|\bSpecials\b|\bRecap\b|\bONA\b|أوفا|الخاصة\b/i.test(t);
}

function enrichWithTmdb(title, overviews, meta) {
  const key = `${tmdbKind(title)}:${title.tmdb_id}`;
  // 1) Real plot
  if (title.tmdb_id && overviews[key]) {
    const o = overviews[key];
    const plot = cleanPlot(o.ar || o.en || '');
    if (plot && plot.length >= 40) {
      title.story = plot;
      title.description = plot;
      title.real_plot = true;
    }
  }
  if (!title.real_plot) {
    // No trustworthy source plot: clean whatever boilerplate exists so it is at
    // least free of source/brand mentions, then guarantee a useful non-empty
    // Arabic summary. Empty/ultra-short descriptions create thin pages and weak
    // snippets, especially for pages that should be indexed immediately.
    if (title.story) title.story = cleanPlot(title.story);
    if (title.description) title.description = cleanPlot(title.description);
    const existing = String(title.story || title.description || '').replace(/\s+/g, ' ').trim();
    if (existing.length < 80) {
      const fallback = fallbackPlot(title);
      title.story = fallback;
      title.description = fallback;
    }
    title.real_plot = false;
  }

  // Even real upstream plots are sometimes just a few words. Preserve the real
  // plot, but append a concise contextual sentence so indexable detail pages are
  // not left with ultra-thin summaries or weak search snippets.
  const normalizedStory = String(title.story || title.description || '').replace(/\s+/g, ' ').trim();
  if (normalizedStory && normalizedStory.length < 80) {
    const enriched = `${normalizedStory} ${contextualPlotSuffix(title)}`.replace(/\s+/g, ' ').trim();
    title.story = enriched;
    title.description = enriched;
  }
  // 1b) Purge stale baked-in SEO prose. The old dataset stored full CINMAPRO +
  // "بيانات TMDB" paragraphs inside seoContent.{mainDescription,metaDescription,
  // story,description,highlights,beforeWatching}. buildMainDescription returns
  // seoContent.mainDescription verbatim when present, which would bypass the real
  // plot. Drop these prose fields so the generator always rebuilds clean text from
  // the (now real) title.story. Structured SEO fields (faq points etc.) are kept.
  if (title.seoContent && typeof title.seoContent === 'object') {
    for (const f of ['mainDescription', 'metaDescription', 'story', 'description', 'highlights', 'beforeWatching', 'longRead']) {
      if (f in title.seoContent) delete title.seoContent[f];
    }
    // beforeWatchingPoints often embed brand/source mentions too — clean them.
    if (Array.isArray(title.seoContent.beforeWatchingPoints)) {
      title.seoContent.beforeWatchingPoints = title.seoContent.beforeWatchingPoints
        .map((p) => cleanPlot(p))
        .filter((p) => p && p.length > 8);
    }
  }
  // 2) Sort metadata
  const m = title.tmdb_id ? meta[key] : null;
  const vote = m ? m.vote : Number(title.rating) || 0;
  const votes = m ? m.votes : 0;
  const date = (m && m.date) || '';
  title.tmdb_vote = vote;
  title.tmdb_votes = votes;
  title.release_date = date;
  title.sort_rating = weightedRating(vote, votes);
  // recency: prefer exact date, else year
  const ts = date ? Date.parse(date) : (title.year ? Date.parse(`${title.year}-01-01`) : 0);
  title.sort_recent = Number.isFinite(ts) ? ts : 0;
  title.is_special = title.category === 'anime' && isSpecialEntry(title);
  return title;
}

function compactDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 220 ? text.slice(0, 220) : text;
}

// Balanced preview subset (mirrors src/lib/titles.ts). Within each category we
// prefer credible, non-special, real-plot titles so the preview build is
// representative rather than alphabetic noise.
function capByCategory(items, limit) {
  if (!limit || limit <= 0) return items;
  const perCat = Math.max(1, Math.floor(limit / 3));
  const buckets = { movie: [], series: [], anime: [] };
  for (const t of items) {
    if (buckets[t.category]) buckets[t.category].push(t);
  }
  const score = (t) =>
    (t.is_special ? -1e9 : 0) +
    (Number(t.sort_rating) || 0) * 1000 +
    (Number(t.tmdb_votes) || 0) / 1000;
  const out = [];
  for (const cat of ['movie', 'series', 'anime']) {
    const arr = buckets[cat].slice().sort((a, b) => score(b) - score(a));
    out.push(...arr.slice(0, perCat));
  }
  return out;
}

function toIndexEntry(title) {
  return {
    slug: title.slug,
    clean_title: title.clean_title,
    category: title.category,
    category_label: title.category_label,
    url: title.url,
    poster: title.poster,
    year: title.year || null,
    episodes_count: title.episodes_count,
    seasons_count: title.seasons_count,
    has_multiple_seasons: title.seasons_count > 1,
    genre: title.genre || null,
    description: compactDescription(title.description),
    // sort/credibility metadata
    rating: title.tmdb_vote || (Number(title.rating) || 0),
    votes: title.tmdb_votes || 0,
    sort_rating: title.sort_rating || 0,
    sort_recent: title.sort_recent || 0,
    is_special: !!title.is_special,
  };
}

function toSearchEntry(title) {
  const { description, genre, ...entry } = toIndexEntry(title);
  return entry;
}

async function readTitles() {
  // Read directory entries as Buffers so that filenames containing bytes that
  // are not valid in the current (possibly POSIX) locale still round-trip
  // exactly when we reopen them. Decoding the name to a JS string and handing
  // it back to readFile() corrupts non-ASCII names under a non-UTF-8 locale.
  const rawNames = await fs.readdir(titlesDir, { encoding: 'buffer' });
  const jsonNames = rawNames.filter((buf) => buf.toString('latin1').endsWith('.json'));

  // Sort by the UTF-8 decoded name for a stable, human-friendly order.
  jsonNames.sort((a, b) =>
    a.toString('utf8').localeCompare(b.toString('utf8'), 'ar')
  );

  const titles = [];
  let skipped = 0;
  for (const nameBuf of jsonNames) {
    // Join as Buffers to preserve the exact on-disk bytes of the filename.
    const fullPath = Buffer.concat([
      Buffer.from(titlesDir + path.sep, 'utf8'),
      nameBuf,
    ]);
    try {
      const raw = await fs.readFile(fullPath, 'utf8');
      titles.push(sanitizeBrand(JSON.parse(raw)));
    } catch (err) {
      skipped += 1;
      console.warn(`⚠️  Skipped unreadable title file: ${nameBuf.toString('utf8')} (${err.code || err.message})`);
    }
  }
  if (skipped > 0) console.warn(`⚠️  Total skipped title files: ${skipped}`);
  return titles;
}

async function main() {
  const titles = await readTitles();

  // Merge real TMDB plots + sorting metadata.
  const overviews = loadJsonSafe(path.join(cacheDir, 'tmdb-overviews.json'));
  const meta = loadJsonSafe(path.join(cacheDir, 'tmdb-meta.json'));
  let realPlots = 0;
  for (const t of titles) {
    enrichWithTmdb(t, overviews, meta);
    if (t.real_plot) realPlots += 1;
  }
  console.log(`Real TMDB plots applied: ${realPlots}/${titles.length}`);

  const stats = titles.reduce(
    (acc, title) => {
      acc.total += 1;
      acc[title.category] = (acc[title.category] || 0) + 1;
      return acc;
    },
    { total: 0, movie: 0, series: 0, anime: 0 }
  );

  await fs.mkdir(generatedDir, { recursive: true });

  // Always write the FULL enriched catalogue (used in production CI and as a
  // backup). This is large (~90MB) so we keep it separate from the import that
  // the low-memory sandbox build consumes.
  await fs.writeFile(path.join(generatedDir, 'all.full.json'), `${JSON.stringify(titles)}\n`, 'utf8');

  // The sandbox build imports all.json directly; on a ~1GB box the full file
  // blows up memory and page count. When PREVIEW_LIMIT is set we write a
  // balanced subset there; otherwise all.json == the full catalogue.
  const previewLimit = Number(process.env.PREVIEW_LIMIT || 0);
  const previewTitles = previewLimit > 0 ? capByCategory(titles, previewLimit) : titles;
  await fs.writeFile(path.join(generatedDir, 'all.json'), `${JSON.stringify(previewTitles, null, 2)}\n`, 'utf8');

  // index / search / stats reflect the FULL catalogue (cheap, slim entries).
  await fs.writeFile(path.join(generatedDir, 'index.json'), `${JSON.stringify(titles.map(toIndexEntry))}\n`, 'utf8');
  await fs.writeFile(path.join(generatedDir, 'search-index.json'), `${JSON.stringify(titles.map(toSearchEntry))}\n`, 'utf8');
  await fs.writeFile(path.join(generatedDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

  console.log(`Generated ${titles.length} titles (preview all.json: ${previewTitles.length}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
