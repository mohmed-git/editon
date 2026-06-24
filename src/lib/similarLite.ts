/**
 * Lightweight "similar titles" for the SSR episode pages.
 *
 * The static `getSimilarTitles` in titles.ts pulls from all.json (86MB) — too
 * heavy for an SSR Worker. This variant reads the slim pre-built index.json
 * (~5MB, card-level fields only) and reproduces the same scoring used by the
 * static pages, returning ready-to-render TitleIndexEntry objects.
 */
import type { Category, TitleIndexEntry } from './types';
import indexData from '../data/generated/index.json';
import { splitGenres } from './detailContent';
import { detailRoute } from './routes';

interface RawIndexEntry {
  slug: string;
  clean_title: string;
  category: Category;
  category_label: string;
  url: string;
  poster: string | null;
  year?: string | null;
  episodes_count: number;
  seasons_count: number;
  has_multiple_seasons: boolean;
  genre?: string | null;
  description?: string;
  rating?: number;
  votes?: number;
  sort_rating?: number;
  sort_recent?: number;
  is_special?: boolean;
  country?: string | null;
}

const INDEX = indexData as unknown as RawIndexEntry[];

function toEntry(e: RawIndexEntry): TitleIndexEntry {
  const genres = splitGenres(e.genre);
  return {
    slug: e.slug,
    clean_title: e.clean_title,
    category: e.category,
    category_label: e.category_label,
    poster: e.poster,
    seasons_count: e.seasons_count,
    episodes_count: e.episodes_count,
    url: detailRoute(e.category, e.slug),
    has_multiple_seasons: e.seasons_count > 1,
    year: e.year ?? null,
    genres,
    rating: e.rating ?? 0,
    votes: e.votes ?? 0,
    sort_rating: e.sort_rating ?? 0,
    sort_recent: e.sort_recent ?? 0,
    is_special: !!e.is_special,
  };
}

/**
 * Same heuristic as titles.ts#getSimilarTitles: prefer overlapping genres,
 * then country / year, with a deterministic tiebreak.
 */
export function getSimilarTitlesLite(
  currentSlug: string,
  currentCategory: Category,
  currentGenre: string | null | undefined,
  currentCountry: string | null | undefined,
  currentYear: string | null | undefined,
  limit = 12
): TitleIndexEntry[] {
  const currentGenres = new Set(splitGenres(currentGenre));
  const sameCat = INDEX.filter((t) => t.category === currentCategory && t.slug !== currentSlug);
  const hash = [...currentSlug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);

  return sameCat
    .map((t, i) => {
      const genreScore = splitGenres(t.genre).reduce(
        (score, g) => score + (currentGenres.has(g) ? 1 : 0),
        0
      );
      const countryScore = currentCountry && t.country === currentCountry ? 1 : 0;
      const yearScore = currentYear && t.year === currentYear ? 1 : 0;
      return {
        t,
        score: genreScore * 10 + countryScore * 2 + yearScore,
        key: (i * 2654435761 + hash) >>> 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.key - b.key)
    .slice(0, limit)
    .map((x) => toEntry(x.t));
}
