import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const generatedDir = path.join(rootDir, 'src', 'data', 'generated');

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

function compactDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 220 ? text.slice(0, 220) : text;
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
  const stats = titles.reduce(
    (acc, title) => {
      acc.total += 1;
      acc[title.category] = (acc[title.category] || 0) + 1;
      return acc;
    },
    { total: 0, movie: 0, series: 0, anime: 0 }
  );

  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(path.join(generatedDir, 'all.json'), `${JSON.stringify(titles, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(generatedDir, 'index.json'), `${JSON.stringify(titles.map(toIndexEntry), null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(generatedDir, 'search-index.json'), `${JSON.stringify(titles.map(toSearchEntry), null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(generatedDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

  console.log(`Generated ${titles.length} titles.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
