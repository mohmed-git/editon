/**
 * Title loader.
 * Reads from src/data/generated/all.json and rewrites every `url` to the
 * opaque route form (see routes.ts) so that nowhere in the rendered HTML do we
 * leak readable /movie /series /anime /watch paths.
 *
 * Image / poster paths are deliberately left untouched.
 */
import type { Title, TitleIndexEntry } from './types';
import all from '../data/generated/all.json';
import { splitGenres } from './detailContent';
import { detailRoute } from './routes';

const RAW_TITLES: Title[] = all as unknown as Title[];

/**
 * Optional preview cap.
 *
 * The full library is ~5,800 titles which expands to tens of thousands of
 * static pages — too much for a low-memory preview sandbox to build at once.
 * Setting PREVIEW_LIMIT (e.g. PREVIEW_LIMIT=600) builds a balanced subset across
 * the three categories so the redesign, themes and obfuscated routes can be
 * previewed. In production CI (no PREVIEW_LIMIT) the *entire* catalogue builds.
 */
const PREVIEW_LIMIT = Number(
  (typeof process !== 'undefined' && process.env && process.env.PREVIEW_LIMIT) || 0
);

function capByCategory(items: Title[], limit: number): Title[] {
  if (!limit || limit <= 0) return items;
  const perCat = Math.max(1, Math.floor(limit / 3));
  const buckets: Record<string, Title[]> = { movie: [], series: [], anime: [] };
  for (const t of items) {
    const b = buckets[t.category];
    if (b && b.length < perCat) b.push(t);
  }
  return [...buckets.movie, ...buckets.series, ...buckets.anime];
}

// Rewrite the stored url to the opaque detail route.
const ALL_TITLES: Title[] = capByCategory(RAW_TITLES, PREVIEW_LIMIT).map((t) => ({
  ...t,
  url: detailRoute(t.category, t.slug),
}));

// Build a slug → Title map for quick lookup
const bySlug = new Map<string, Title>();
for (const t of ALL_TITLES) bySlug.set(t.slug, t);

export function getAllTitles(): Title[] {
  return ALL_TITLES;
}

export function getTitlesByCategory(category: Title['category']): Title[] {
  return ALL_TITLES.filter((t) => t.category === category);
}

export function getTitleBySlug(slug: string): Title | undefined {
  return bySlug.get(slug);
}

/** Tiny entry used in listings / cards */
export function toIndexEntry(t: Title): TitleIndexEntry {
  const genres = splitGenres(t.genre);
  return {
    slug: t.slug,
    clean_title: t.clean_title,
    category: t.category,
    category_label: t.category_label,
    poster: t.poster,
    seasons_count: t.seasons_count,
    episodes_count: t.episodes_count,
    url: detailRoute(t.category, t.slug),
    has_multiple_seasons: t.seasons_count > 1,
    year: t.year || null,
    genres,
  };
}

export function sortByAlpha(titles: Title[]): Title[] {
  return [...titles].sort((a, b) =>
    a.clean_title.localeCompare(b.clean_title, 'ar')
  );
}

export function sortByEpisodes(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => b.episodes_count - a.episodes_count);
}

/** Similar works: prefer overlapping genres, then keep a deterministic order. */
export function getSimilarTitles(current: Title, limit = 12): Title[] {
  const currentGenres = new Set(splitGenres(current.genre));
  const currentCountry = current.country || '';
  const sameCat = getTitlesByCategory(current.category).filter(
    (t) => t.slug !== current.slug
  );
  const hash = [...current.slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const sorted = sameCat
    .map((t, i) => {
      const genreScore = splitGenres(t.genre).reduce(
        (score, genre) => score + (currentGenres.has(genre) ? 1 : 0),
        0
      );
      const countryScore = currentCountry && t.country === current.country ? 1 : 0;
      const yearScore = current.year && t.year === current.year ? 1 : 0;
      return {
        t,
        score: genreScore * 10 + countryScore * 2 + yearScore,
        key: (i * 2654435761 + hash) >>> 0,
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.key - b.key))
    .map((x) => x.t);
  return sorted.slice(0, limit);
}
