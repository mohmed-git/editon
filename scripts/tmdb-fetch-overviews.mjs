#!/usr/bin/env node
/**
 * tmdb-fetch-overviews.mjs
 * Fetches REAL Arabic plot overviews from TMDB for every title that has a tmdb_id,
 * and writes them into a cache file (scripts/.cache/tmdb-overviews.json).
 *
 * - Uses /movie/{id} or /tv/{id} depending on tmdb_url.
 * - Tries language=ar-SA first, falls back to ar, then en (English overview kept
 *   only as a marker so we know a real plot exists; build step decides usage).
 * - Resumable: skips ids already in cache. Safe to re-run.
 *
 * Env: TMDB_ACCESS_TOKEN (preferred, Bearer) OR TMDB_API_KEY (v3).
 * Usage: node scripts/tmdb-fetch-overviews.mjs [--limit N] [--only movie|tv|anime]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'src/data/generated/all.full.json');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'tmdb-overviews.json');

const accessToken = process.env.TMDB_ACCESS_TOKEN || '';
const apiKey = process.env.TMDB_API_KEY || '';

if (!accessToken && !apiKey) {
  console.error('ERROR: Set TMDB_ACCESS_TOKEN (Bearer) or TMDB_API_KEY (v3) before running.');
  process.exit(1);
}

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';

function headers() {
  return accessToken
    ? { Authorization: `Bearer ${accessToken}`, accept: 'application/json' }
    : { accept: 'application/json' };
}

function endpointFor(title) {
  // tmdb_url contains /movie/ or /tv/
  const url = title.tmdb_url || '';
  const kind = /\/tv\//.test(url) ? 'tv' : /\/movie\//.test(url) ? 'movie' : (title.category === 'movie' ? 'movie' : 'tv');
  return { kind };
}

async function fetchOverview(kind, id, lang) {
  const base = `https://api.themoviedb.org/3/${kind}/${id}`;
  const url = apiKey ? `${base}?api_key=${apiKey}&language=${lang}` : `${base}?language=${lang}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      return fetchOverview(kind, id, lang);
    }
    return { ok: false, status: res.status };
  }
  const json = await res.json();
  return { ok: true, overview: (json.overview || '').trim(), title: json.title || json.name || '' };
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const titles = Array.isArray(raw) ? raw : Object.values(raw)[0];
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cache = await loadCache();

  let candidates = titles.filter((t) => t.tmdb_id);
  if (onlyArg === 'anime') candidates = candidates.filter((t) => t.category === 'anime');
  else if (onlyArg === 'movie' || onlyArg === 'tv') candidates = candidates.filter((t) => endpointFor(t).kind === onlyArg);

  // de-dupe by kind:id (anime share ids across seasons)
  const byKey = new Map();
  for (const t of candidates) {
    const { kind } = endpointFor(t);
    const key = `${kind}:${t.tmdb_id}`;
    if (!byKey.has(key)) byKey.set(key, { kind, id: t.tmdb_id });
  }
  let work = [...byKey.values()].filter((w) => !(`${w.kind}:${w.id}` in cache));
  if (limitArg > 0) work = work.slice(0, limitArg);

  console.log(`Total titles with id: ${candidates.length} | unique ids: ${byKey.size} | already cached: ${byKey.size - work.length} | to fetch: ${work.length}`);

  let done = 0;
  let arFound = 0;
  let enOnly = 0;
  let empty = 0;
  let saveCounter = 0;

  for (const w of work) {
    const key = `${w.kind}:${w.id}`;
    let ar = await fetchOverview(w.kind, w.id, 'ar-SA');
    if (ar.ok && !ar.overview) ar = await fetchOverview(w.kind, w.id, 'ar');
    const en = (ar.ok && !ar.overview) ? await fetchOverview(w.kind, w.id, 'en-US') : { ok: false };

    if (ar.ok && ar.overview) { cache[key] = { ar: ar.overview, lang: 'ar' }; arFound++; }
    else if (en.ok && en.overview) { cache[key] = { en: en.overview, lang: 'en' }; enOnly++; }
    else { cache[key] = { lang: 'none' }; empty++; }

    done++;
    saveCounter++;
    if (saveCounter >= 50) {
      await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
      saveCounter = 0;
      process.stdout.write(`\r  progress: ${done}/${work.length}  (ar:${arFound} en:${enOnly} none:${empty})   `);
    }
    await new Promise((r) => setTimeout(r, 40)); // ~25 req/s, well under TMDB limit
  }

  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  console.log(`\nDONE. fetched: ${done} | arabic: ${arFound} | english-only: ${enOnly} | none: ${empty}`);
  console.log(`Cache: ${CACHE_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
