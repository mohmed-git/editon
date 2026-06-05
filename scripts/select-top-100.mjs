#!/usr/bin/env node
// Select top 100 works (60 movies + 25 series + 15 anime) by quality score
import fs from 'node:fs';
import path from 'node:path';

const SRC_ALL = '/home/user/webapp/src/data/generated/all.json';
const DEST_DIR = '/home/user/cinmapro/src/data';
const DEST_TITLES = path.join(DEST_DIR, 'titles');
const DEST_GENERATED = path.join(DEST_DIR, 'generated');

fs.mkdirSync(DEST_TITLES, { recursive: true });
fs.mkdirSync(DEST_GENERATED, { recursive: true });

const all = JSON.parse(fs.readFileSync(SRC_ALL, 'utf8'));

function score(t) {
  let s = 0;
  if (t.poster) s += 20;
  if (t.description && t.description.length > 150) s += 8;
  else if (t.description && t.description.length > 80) s += 4;
  const y = Number(t.year);
  if (y >= 2023) s += 6;
  else if (y >= 2020) s += 4;
  else if (y >= 2015) s += 2;
  if (t.stars) s += 3;
  if (t.genre) s += 2;
  if (t.director) s += 2;
  if (t.quality && /4K|1080|HD|WEB-DL/i.test(t.quality)) s += 2;
  s += Math.min(t.episodes_count || 1, 30) * 0.15;
  return s;
}

const movies = all.filter(t => t.category === 'movie' && t.poster).sort((a,b)=>score(b)-score(a)).slice(0, 60);
const series = all.filter(t => t.category === 'series' && t.poster).sort((a,b)=>score(b)-score(a)).slice(0, 25);
const anime  = all.filter(t => t.category === 'anime'  && t.poster).sort((a,b)=>score(b)-score(a)).slice(0, 15);

const selected = [...movies, ...series, ...anime];
console.log(`Selected: ${movies.length} movies + ${series.length} series + ${anime.length} anime = ${selected.length}`);

// Write per-title JSON files
for (const t of selected) {
  fs.writeFileSync(path.join(DEST_TITLES, `${t.slug}.json`), JSON.stringify(t, null, 2), 'utf8');
}

// Write all.json
fs.writeFileSync(path.join(DEST_GENERATED, 'all.json'), JSON.stringify(selected, null, 2), 'utf8');

// Build index entries
const indexEntries = selected.map(t => ({
  slug: t.slug,
  clean_title: t.clean_title,
  category: t.category,
  category_label: t.category === 'movie' ? 'فيلم' : t.category === 'series' ? 'مسلسل' : 'أنمي',
  url: t.url,
  poster: t.poster,
  year: t.year || '',
  episodes_count: t.episodes_count || 1,
  seasons_count: t.seasons_count || 1,
  has_multiple_seasons: (t.seasons_count || 1) > 1,
  genre: t.genre || '',
  description: (t.description || '').slice(0, 200),
}));
fs.writeFileSync(path.join(DEST_GENERATED, 'index.json'), JSON.stringify(indexEntries, null, 2), 'utf8');

// Search index (lighter)
const searchIndex = selected.map(t => ({
  slug: t.slug,
  clean_title: t.clean_title,
  category: t.category,
  category_label: t.category === 'movie' ? 'فيلم' : t.category === 'series' ? 'مسلسل' : 'أنمي',
  url: t.url,
  poster: t.poster,
  year: t.year || '',
  episodes_count: t.episodes_count || 1,
  seasons_count: t.seasons_count || 1,
  has_multiple_seasons: (t.seasons_count || 1) > 1,
}));
fs.writeFileSync(path.join(DEST_GENERATED, 'search-index.json'), JSON.stringify(searchIndex, null, 2), 'utf8');

// Stats
const stats = {
  total: selected.length,
  movie: movies.length,
  series: series.length,
  anime: anime.length,
};
fs.writeFileSync(path.join(DEST_GENERATED, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');

console.log('✅ Top 100 dataset written to /home/user/cinmapro/src/data');
console.log('Stats:', stats);
