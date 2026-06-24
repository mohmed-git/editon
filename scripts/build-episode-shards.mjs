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

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const allPath = join(root, 'src/data/generated/all.json');
const outDir = join(root, 'public/_data/episodes');
const manifestPath = join(root, 'src/data/generated/episode-manifest.json');
const routeIndexPath = join(root, 'src/data/generated/episode-routes.json');

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

const manifest = {};
const routeIndex = [];
let episodicCount = 0;
let scanned = 0;

/**
 * Stream the top-level JSON array, yielding each element's raw JSON string.
 * Tracks depth only outside of strings, honouring escape sequences.
 */
function processObject(jsonText) {
  const t = JSON.parse(jsonText);
  scanned++;
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
  console.log(`[episode-shards] scanned ${scanned} titles`);
  console.log(`[episode-shards] wrote ${episodicCount} shards -> public/_data/episodes/`);
  console.log(`[episode-shards] manifest -> src/data/generated/episode-manifest.json`);
  console.log(`[episode-shards] route index (${routeIndex.length} titles) -> src/data/generated/episode-routes.json`);
});

stream.on('error', (err) => {
  console.error('[episode-shards] stream error:', err);
  process.exit(1);
});
