/**
 * Filters & pagination helpers for movies/series/anime listings.
 *
 * - Normalizes genres (cleans separators, deduplicates).
 * - Extracts year buckets (decades + recent years).
 * - Provides pagination utilities.
 */
import type { Title } from './types';

export const PAGE_SIZE = 36; // posters per page (3..6 cols ⇒ 6 rows)

/* ─────────────────────────  GENRES  ───────────────────────── */

// Canonical Arabic genres we promote in the UI (in display order)
export const PRIMARY_GENRES = [
  'اكشن',
  'كوميدي',
  'دراما',
  'رعب',
  'اثارة',
  'رومانسي',
  'جريمة',
  'غموض',
  'مغامرة',
  'خيال علمي',
  'فانتازيا',
  'وثائقي',
  'تاريخي',
  'سيرة ذاتية',
  'كرتون',
  'عائلي',
] as const;

export type PrimaryGenre = (typeof PRIMARY_GENRES)[number];

/** Split a raw `genre` string ("اكشن / دراما، كوميدي") into clean tokens */
export function splitGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\/،,•·]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/** Slugify a genre name into a stable URL token (uses transliteration map for primary ones) */
const GENRE_SLUG_MAP: Record<string, string> = {
  اكشن: 'action',
  كوميدي: 'comedy',
  دراما: 'drama',
  رعب: 'horror',
  اثارة: 'thriller',
  رومانسي: 'romance',
  جريمة: 'crime',
  غموض: 'mystery',
  مغامرة: 'adventure',
  'خيال علمي': 'sci-fi',
  فانتازيا: 'fantasy',
  وثائقي: 'documentary',
  تاريخي: 'history',
  'سيرة ذاتية': 'biography',
  كرتون: 'animation',
  عائلي: 'family',
};

export function genreSlug(genre: string): string {
  const trimmed = genre.trim();
  return GENRE_SLUG_MAP[trimmed] || encodeURIComponent(trimmed);
}

export function genreFromSlug(slug: string): string | null {
  // reverse lookup against PRIMARY_GENRES
  for (const [ar, en] of Object.entries(GENRE_SLUG_MAP)) {
    if (en === slug) return ar;
  }
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

/** Build a genre → count map for a list of titles */
export function buildGenreCounts(titles: Title[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of titles) {
    for (const g of splitGenres(t.genre)) {
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  return counts;
}

/** Title matches a genre filter (case-insensitive substring match for resilience) */
export function titleHasGenre(t: Title, genre: string): boolean {
  if (!genre) return true;
  const tokens = splitGenres(t.genre);
  return tokens.some((g) => g === genre);
}

/* ─────────────────────────  YEARS  ───────────────────────── */

export interface YearBucket {
  key: string; // e.g. "2024" or "2010s"
  label: string; // display label
  match: (year: string | null | undefined) => boolean;
}

/** Build the standard set of year buckets we expose in the UI */
export function buildYearBuckets(titles: Title[]): YearBucket[] {
  const yearSet = new Set<number>();
  for (const t of titles) {
    const y = Number(t.year);
    if (Number.isFinite(y) && y >= 1900 && y <= 2100) yearSet.add(y);
  }
  const allYears = [...yearSet].sort((a, b) => b - a);
  const recent = allYears.slice(0, 6);

  const buckets: YearBucket[] = recent.map((y) => ({
    key: String(y),
    label: String(y),
    match: (yr) => Number(yr) === y,
  }));

  // Decades for older content
  const decades = new Set<number>();
  for (const y of allYears) decades.add(Math.floor(y / 10) * 10);
  for (const d of [...decades].sort((a, b) => b - a)) {
    // skip a decade if all its years already appeared in `recent`
    const hasOlder = allYears.some(
      (y) => y >= d && y < d + 10 && !recent.includes(y)
    );
    if (!hasOlder) continue;
    buckets.push({
      key: `${d}s`,
      label: `${d}s`,
      match: (yr) => {
        const n = Number(yr);
        return Number.isFinite(n) && n >= d && n < d + 10;
      },
    });
  }
  return buckets;
}

export function findYearBucket(
  buckets: YearBucket[],
  key: string | null | undefined
): YearBucket | null {
  if (!key) return null;
  return buckets.find((b) => b.key === key) || null;
}

/* ─────────────────────────  PAGINATION  ───────────────────────── */

export interface PageInfo {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  start: number;
  end: number;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize = PAGE_SIZE
): { slice: T[]; info: PageInfo } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page | 0), totalPages);
  const start = (p - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    slice: items.slice(start, end),
    info: { page: p, totalPages, pageSize, total, start, end },
  };
}

/** Build the [1, …, n] page numbers with ellipses (e.g. [1, '…', 5, 6, 7, '…', 12]) */
export function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('…');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('…');
  out.push(total);
  return out;
}

/* ─────────────────  COMBINED FILTER  ─────────────────── */

export interface FilterOptions {
  genre?: string | null;
  yearKey?: string | null; // matches a YearBucket.key
  yearBuckets?: YearBucket[];
}

export function applyFilters(
  titles: Title[],
  opts: FilterOptions
): Title[] {
  const { genre, yearKey, yearBuckets } = opts;
  const bucket = yearKey && yearBuckets ? findYearBucket(yearBuckets, yearKey) : null;
  return titles.filter((t) => {
    if (genre && !titleHasGenre(t, genre)) return false;
    if (bucket && !bucket.match(t.year)) return false;
    return true;
  });
}
