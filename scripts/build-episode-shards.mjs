/**
 * Build per-title episode shards (streaming, dependency-free, low-memory).
 *
 * Reads the master src/data/generated/all.json and writes ONE small JSON file
 * per episodic title (series/anime with >1 episode) into public/_data/episodes/.
 *
 * Why shards: the SSR episode pages must NOT bundle the 86MB all.json (that OOMs
 * the build and blows the Cloudflare Worker size limit). Each title is emitted
 * as a PLAIN STATIC asset and fetched at request time, so a request only ever
 * pulls in the one title it needs. The shards carry the exact same Title objects
 * the static pages use, so episode content stays identical across the site.
 *
 * Why streaming: all.json is ~86MB. `JSON.parse(readFileSync(...))` peaks well
 * above 1GB and gets OOM-killed on small machines. Instead we walk the file as a
 * stream and carve out each top-level array element by tracking brace/bracket
 * depth (string- and escape-aware), parsing one Title object at a time. Peak
 * memory stays at roughly the size of a single title.
 *
 * Slugs can contain non-ASCII (Arabic) chars, so the on-disk filename is a
 * base64url of the UTF-8 slug; a manifest maps slug -> filename.
 */
import { createReadStream, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAdultContent } from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const allPath = join(root, 'src/data/generated/all.json');
const outDir = join(root, 'public/_data/episodes');
const similarDir = join(root, 'public/_data/similar');
const manifestPath = join(root, 'src/data/generated/episode-manifest.json');
const routeIndexPath = join(root, 'src/data/generated/episode-routes.json');

// NEW-works (CSV-ingested, is_new=true) artifacts. These works are served
// on-demand (SSR), never statically built, so we emit:
//   - one full detail shard per new work  -> public/_data/new/<file>.json
//   - a slug -> file manifest             -> new-manifest.json
//   - a slim per-subcategory card index   -> public/_data/subcat/<sub>.json
const newDir = join(root, 'public/_data/new');
const subcatDir = join(root, 'public/_data/subcat');
const newManifestPath = join(root, 'src/data/generated/new-manifest.json');
const subcatCountsPath = join(root, 'src/data/generated/subcat-counts.json');



function slugToFile(slug) {
  return Buffer.from(slug, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isEpisodic(t) {
  return (
    (t.category === 'series' || t.category === 'anime') &&
    t.episodes_count > 1 &&
    Array.isArray(t.seasons) &&
    t.seasons.length > 0
  );
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (existsSync(similarDir)) rmSync(similarDir, { recursive: true, force: true });
mkdirSync(similarDir, { recursive: true });
if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true });
mkdirSync(newDir, { recursive: true });
if (existsSync(subcatDir)) rmSync(subcatDir, { recursive: true, force: true });
mkdirSync(subcatDir, { recursive: true });

const manifest = {};
const routeIndex = [];
// NEW works: slug -> shard filename, and slim card index grouped by subcategory.
const newManifest = {};
const subcatIndex = {}; // sub -> [card entries]
let newCount = 0;

// Slim "similar titles" index, sharded by category. Each entry only carries the
// card-level fields getSimilarTitlesLite needs to score + render related cards.
// Emitted as PLAIN STATIC assets so the SSR Worker never bundles the 5MB index.
const similarByCategory = {};
let episodicCount = 0;
let scanned = 0;

/**
 * Stream the top-level JSON array, yielding each element's raw JSON string.
 * Tracks depth only outside of strings, honouring escape sequences.
 */
let skippedAdult = 0;

function processObject(jsonText) {
  const t = JSON.parse(jsonText);
  scanned++;

  // ── Adult / indecent content gate ─────────────────────────────────────────
  // The user asked to exclude any indecent / semi-pornographic work. We apply
  // the blocklist to BOTH new (CSV-ingested) and old works so nothing slips
  // into the listings, similar rails or per-subcategory indexes. We rely on
  // TMDB's `adult` flag (when captured) plus a keyword blocklist over the work's
  // names + genre.
  if (
    isAdultContent({
      name: `${t.clean_title || ''} ${t.raw_name || ''} ${t.original_title || ''}`,
      title: t.clean_title || '',
      genre: t.genre || '',
      adult: t.adult === true,
    })
  ) {
    skippedAdult++;
    return; // never emit a shard, route or index entry for it
  }

  // Collect a slim "similar" entry for EVERY title (movies included as cards
  // can be recommended too) into its category bucket. Only the fields the
  // runtime scorer/renderer needs — keeps each category file small.
  const cat = t.category;
  if (cat && !t.is_new) {
    (similarByCategory[cat] ??= []).push({
      slug: t.slug,
      clean_title: t.clean_title,
      category: t.category,
      category_label: t.category_label,
      poster: t.poster ?? null,
      year: t.year ?? null,
      episodes_count: t.episodes_count ?? 0,
      seasons_count: t.seasons_count ?? 0,
      genre: t.genre ?? null,
      rating: t.rating ?? 0,
      votes: t.votes ?? 0,
      sort_rating: t.sort_rating ?? 0,
      sort_recent: t.sort_recent ?? 0,
      is_special: !!t.is_special,
      country: t.country ?? null,
    });
  }

  // NEW works (CSV-ingested) → emit a full detail shard + register in the slim
  // per-subcategory card index. These are SSR-only (never statically built).
  if (t.is_new) {
    newCount++;
    const nf = slugToFile(t.slug);
    writeFileSync(join(newDir, `${nf}.json`), JSON.stringify(t));
    newManifest[t.slug] = nf;
    const sub = t.subcategory || 'other';
    (subcatIndex[sub] ??= []).push({
      slug: t.slug,
      clean_title: t.clean_title,
      category: t.category,
      category_label: t.category_label,
      subcategory: t.subcategory ?? null,
      subcategory_label: t.subcategory_label ?? null,
      poster: t.poster ?? null,
      year: t.year ?? null,
      episodes_count: t.episodes_count ?? 0,
      seasons_count: t.seasons_count ?? 0,
      genre: t.genre ?? null,
      rating: t.rating ?? 0,
      votes: t.tmdb_votes ?? 0,
      sort_rating: t.sort_rating ?? 0,
      sort_recent: t.sort_recent ?? 0,
      is_new: true,
    });
    // New episodic works ALSO get an episode shard + route entry so their
    // per-episode SSR pages work just like the old catalogue.
    if (isEpisodic(t)) {
      const file = slugToFile(t.slug);
      writeFileSync(join(outDir, `${file}.json`), JSON.stringify(t));
      manifest[t.slug] = file;
      episodicCount++;
      routeIndex.push({
        s: t.slug,
        c: t.category,
        z: [...t.seasons]
          .filter((season) => Array.isArray(season.episodes) && season.episodes.length > 0)
          .sort((a, b) => a.season - b.season)
          .map((season) => [
            season.season,
            [...season.episodes].sort((a, b) => a.episode - b.episode).map((e) => e.episode),
          ]),
      });
    }
    return;
  }

  if (!isEpisodic(t)) return;

  episodicCount++;
  const file = slugToFile(t.slug);
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(t));
  manifest[t.slug] = file;

  routeIndex.push({
    s: t.slug,
    c: t.category, // 'series' | 'anime'
    z: [...t.seasons]
      .filter((season) => Array.isArray(season.episodes) && season.episodes.length > 0)
      .sort((a, b) => a.season - b.season)
      .map((season) => [
        season.season,
        [...season.episodes].sort((a, b) => a.episode - b.episode).map((e) => e.episode),
      ]),
  });
}

// Incremental state machine. `buf` only ever holds the bytes of the element
// currently being assembled (plus a little lookahead), so memory stays tiny.
let buf = '';        // bytes of the in-progress element (from its opening '{')
let depth = 0;       // brace depth of the in-progress element
let inString = false;
let escaped = false;
let started = false; // have we passed the opening top-level '['?
let collecting = false; // are we currently inside a top-level element?

const stream = createReadStream(allPath, { encoding: 'utf8', highWaterMark: 1 << 20 });

stream.on('data', (chunk) => {
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];

    if (!started) {
      // Skip whitespace until the opening top-level '['.
      if (ch === '[') started = true;
      continue;
    }

    if (collecting) {
      buf += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          // Completed one top-level element.
          processObject(buf);
          buf = '';
          collecting = false;
        }
      }
      continue;
    }

    // Between elements: wait for the next element's opening '{'.
    if (ch === '{') {
      collecting = true;
      depth = 1;
      buf = '{';
    }
    // commas / whitespace / closing ']' are ignored here.
  }
});

stream.on('end', () => {
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(routeIndexPath, JSON.stringify(routeIndex));

  // Emit one slim similar-index per category as a STATIC asset. The SSR episode
  // routes fetch only their own category file at request time, so the 5MB index
  // is never bundled into the Worker.
  for (const [cat, entries] of Object.entries(similarByCategory)) {
    writeFileSync(join(similarDir, `${cat}.json`), JSON.stringify(entries));
    console.log(`[episode-shards] similar/${cat}.json -> ${entries.length} titles`);
  }

  // NEW-works artifacts: manifest + per-subcategory slim card indexes.
  writeFileSync(newManifestPath, JSON.stringify(newManifest));
  const subcatCounts = {};
  for (const [sub, entries] of Object.entries(subcatIndex)) {
    // Stable default order: rating-then-recency so listing pages look good
    // even before client-side re-sorting.
    entries.sort((a, b) =>
      (b.sort_rating - a.sort_rating) || (b.sort_recent - a.sort_recent) ||
      String(a.clean_title).localeCompare(String(b.clean_title), 'ar'));
    writeFileSync(join(subcatDir, `${sub}.json`), JSON.stringify(entries));
    subcatCounts[sub] = entries.length;
    console.log(`[episode-shards] subcat/${sub}.json -> ${entries.length} works`);
  }
  writeFileSync(subcatCountsPath, JSON.stringify(subcatCounts, null, 2));
  console.log(`[episode-shards] new works: ${newCount} (shards + subcat index)`);
  console.log(`[episode-shards] skipped ${skippedAdult} adult/indecent works`);


  console.log(`[episode-shards] scanned ${scanned} titles`);
  console.log(`[episode-shards] wrote ${episodicCount} shards -> public/_data/episodes/`);
  console.log(`[episode-shards] manifest -> src/data/generated/episode-manifest.json`);
  console.log(`[episode-shards] route index (${routeIndex.length} titles) -> src/data/generated/episode-routes.json`);
});

stream.on('error', (err) => {
  console.error('[episode-shards] stream error:', err);
  process.exit(1);
});
