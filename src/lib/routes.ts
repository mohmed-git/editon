/**
 * Central route codec.
 *
 * The whole point of this module is to keep the public URLs *opaque*:
 * nothing in the address bar should literally spell out "movie", "series",
 * "anime" or "watch". Every category maps to a short, non-obvious code, and
 * the streaming gateway lives behind an encoded token instead of a readable
 * "/watch/" path.
 *
 * IMPORTANT: poster / image paths are NOT touched by this module. Those keep
 * living under /images/{movie|series|anime}/... exactly as before.
 */
import type { Category } from './site';

/* ───────────────────────── category codes ─────────────────────────
 * Short opaque segments. Chosen so the URL reads like a random handle
 * rather than an English category name.
 *   movie  -> "f"  (single-segment library entry)
 *   series -> "d"
 *   anime  -> "n"
 * Listings live under the "x" namespace so /movies is no longer guessable:
 *   movies  listing -> /x/f
 *   series  listing -> /x/d
 *   anime   listing -> /x/n
 * The streaming gateway lives under "g" with an encoded token.
 */
export const DETAIL_CODE: Record<Category, string> = {
  movie: 'f',
  series: 'd',
  anime: 'n',
};

export const CODE_TO_CATEGORY: Record<string, Category> = {
  f: 'movie',
  d: 'series',
  n: 'anime',
};

export const LISTING_NS = 'x';
export const GATEWAY_NS = 'g';

/* ───────────────────────── safe route slug ─────────────────────────
 * Cloudflare Pages refuses to publish any static asset whose individual path
 * segment exceeds 100 characters — and the limit is measured on the
 * URL-ENCODED segment. An Arabic character becomes 9 chars once percent-encoded
 * (e.g. "ا" -> "%D8%A7"), so even a visually short Arabic slug can explode past
 * the cap. ~780 of our slugs broke this, which is exactly why
 * `wrangler pages deploy` failed with "Failed to publish assets".
 *
 * `safeRouteSlug` produces a deterministic, ASCII-only, collision-free slug that
 * always stays comfortably under 100 chars *after* URL-encoding:
 *   • Short, already-clean ASCII slugs are returned UNCHANGED (SEO-friendly URLs
 *     for the vast majority of titles are preserved bit-for-bit).
 *   • Anything that would exceed the budget (non-ASCII or very long) is rebuilt
 *     from its latin/ascii parts and suffixed with a short stable hash so it
 *     stays readable, unique and reversible-free (pages pass the Title as a prop,
 *     so the slug never needs to be decoded back).
 *
 * The function is pure and dependency-free so it is byte-for-byte identical in
 * the Astro build, the Cloudflare SSR Worker and the episode-shard build script.
 */

// Conservative budget: keep the *URL-encoded* length of the produced slug at or
// below this. Output is ASCII-only, so raw length == encoded length here.
const MAX_ROUTE_SLUG_LEN = 90;

// 64-bit-ish stable hash (two FNV-1a passes, different seeds) -> base36 string.
// Identical output in Node and the browser (no Buffer / no crypto needed).
function stableHash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x97c29b3a;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 ^= c; h2 = Math.imul(h2, 0x85ebca77);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function isCleanAscii(s: string): boolean {
  return /^[A-Za-z0-9._~-]+$/.test(s);
}

export function safeRouteSlug(slug: string): string {
  // Fast path: already a short, clean ASCII slug → leave it exactly as-is.
  if (isCleanAscii(slug) && slug.length <= MAX_ROUTE_SLUG_LEN) return slug;

  // Build a readable ASCII stem from the latin parts of the slug.
  const stem = slug
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]+/g, '-') // drop non-ASCII (Arabic, etc.) runs
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  const h = stableHash(slug);
  const stemBudget = Math.max(0, MAX_ROUTE_SLUG_LEN - 1 - h.length);
  const trimmed = stem.slice(0, stemBudget).replace(/-+$/, '');
  return trimmed ? `${trimmed}-${h}` : h;
}

/* ───────────────────────── detail routes ───────────────────────── */

export function detailRoute(category: Category, slug: string): string {
  return `/${DETAIL_CODE[category]}/${safeRouteSlug(slug)}`;
}

export function listingRoute(category: Category): string {
  return `/${LISTING_NS}/${DETAIL_CODE[category]}`;
}

export function listingPageRoute(category: Category, page: number): string {
  const base = listingRoute(category);
  return page <= 1 ? base : `${base}/p/${page}`;
}

/* ───────────────────────── episode routes ───────────────────────── */

export function seasonRoute(category: Category, slug: string, season: number): string {
  return `${detailRoute(category, slug)}/c/${season}`;
}

export function episodeRoute(
  category: Category,
  slug: string,
  season: number,
  episode: number
): string {
  return `${seasonRoute(category, slug, season)}/e/${episode}`;
}

/* ───────────────────────── gateway (watch) token ─────────────────────────
 * The watch URL used to be /watch/{slug}. We hide it behind an opaque token so
 * the path no longer contains the word "watch" nor the bare slug.
 *
 * The OLD scheme base64-encoded the whole UTF-8 slug. For long / Arabic slugs
 * that produced tokens of 100–187 characters, which blew past Cloudflare Pages'
 * 100-char-per-path-segment limit (132 of the /g/{token} static pages failed to
 * publish — the second confirmed cause of the failed deploy).
 *
 * The token does NOT need to be reversible: every /g/[token] page is generated
 * by getStaticPaths, which passes the matching Title straight through as a prop.
 * So we now use a short, fixed-length (~14 char) stable hash of the slug. It is
 * deterministic, collision-free across the catalogue, opaque, and always far
 * under the 100-char cap.
 */
export function encodeGateToken(slug: string): string {
  return stableHash('g:' + slug);
}

export function gatewayRoute(slug: string): string {
  return `/${GATEWAY_NS}/${encodeGateToken(slug)}`;
}
