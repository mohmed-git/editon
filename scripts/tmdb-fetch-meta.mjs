#!/usr/bin/env node
/**
 * tmdb-fetch-meta.mjs
 * Fetches vote_average, vote_count, popularity and the canonical release/air date
 * for every title with a tmdb_id, into scripts/.cache/tmdb-meta.json.
 *
 * These power a credible, IMDb-style weighted ("Bayesian") rating used for the
 * "Top Rated" sort, and an accurate date for the "Latest" sort.
 *
 * Resumable. Env: TMDB_API_KEY (v3) or TMDB_ACCESS_TOKEN (Bearer).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'src/data/generated/all.full.json');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'tmdb-meta.json');

const accessToken = process.env.TMDB_ACCESS_TOKEN || '';
const apiKey = process.env.TMDB_API_KEY || '';
if (!accessToken && !apiKey) { console.error('Set TMDB_API_KEY or TMDB_ACCESS_TOKEN'); process.exit(1); }

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;

const headers = () => accessToken ? { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } : { accept: 'application/json' };

function kindFor(title) {
  const url = title.tmdb_url || '';
  return /\/tv\//.test(url) ? 'tv' : /\/movie\//.test(url) ? 'movie' : (title.category === 'movie' ? 'movie' : 'tv');
}

async function fetchMeta(kind, id) {
  const base = `https://api.themoviedb.org/3/${kind}/${id}`;
  const url = apiKey ? `${base}?api_key=${apiKey}&language=en-US` : `${base}?language=en-US`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); return fetchMeta(kind, id); }
    return null;
  }
  const j = await res.json();
  return {
    vote: Number(j.vote_average) || 0,
    votes: Number(j.vote_count) || 0,
    pop: Number(j.popularity) || 0,
    date: j.release_date || j.first_air_date || j.last_air_date || '',
  };
}

async function main() {
  const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const titles = Array.isArray(raw) ? raw : Object.values(raw)[0];
  await fs.mkdir(CACHE_DIR, { recursive: true });
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch {}

  const byKey = new Map();
  for (const t of titles) {
    if (!t.tmdb_id) continue;
    const kind = kindFor(t);
    const key = `${kind}:${t.tmdb_id}`;
    if (!byKey.has(key)) byKey.set(key, { kind, id: t.tmdb_id });
  }
  let work = [...byKey.values()].filter((w) => !(`${w.kind}:${w.id}` in cache));
  if (limitArg > 0) work = work.slice(0, limitArg);
  console.log(`unique ids: ${byKey.size} | cached: ${byKey.size - work.length} | to fetch: ${work.length}`);

  let done = 0, save = 0;
  for (const w of work) {
    const m = await fetchMeta(w.kind, w.id);
    cache[`${w.kind}:${w.id}`] = m || { vote: 0, votes: 0, pop: 0, date: '' };
    done++; save++;
    if (save >= 50) { await fs.writeFile(CACHE_FILE, JSON.stringify(cache)); save = 0; process.stdout.write(`\r  ${done}/${work.length}   `); }
    await new Promise((r) => setTimeout(r, 35));
  }
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  console.log(`\nDONE. fetched ${done}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
