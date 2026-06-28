/**
 * Runtime loaders for the freshly-ingested (CSV) works.
 *
 * These works are flagged `is_new` and are served ON-DEMAND (SSR), never built
 * statically — there are ~12k of them, which would blow Cloudflare Pages'
 * 20k-file limit and the low-memory build. Following the exact same pattern as
 * episodeData.ts / similarLite.ts, the build emits:
 *   - public/_data/new/<file>.json     full detail shard per new work
 *   - public/_data/subcat/<sub>.json   slim card index per sub-category
 * and a tiny slug→file manifest is bundled. We fetch only what a request needs,
 * so the Worker stays well under the 3 MB limit.
 */
import type { Title } from './types';
import { newDetailRoute } from './routes';
import subcatCounts from '../data/generated/subcat-counts.json';

export const SUBCAT_COUNTS = subcatCounts as Record<string, number>;

/**
 * Shard filename for a slug — base64url(utf8(slug)). This MUST match
 * scripts/build-episode-shards.mjs `slugToFile`. Computed directly so we never
 * bundle the (700KB) slug→file manifest into the Worker.
 */
function slugToFile(slug: string): string {
  // btoa needs a binary string; build it from UTF-8 bytes.
  const bytes = new TextEncoder().encode(slug);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface SubcatCard {
  slug: string;
  clean_title: string;
  category: Title['category'];
  category_label: string;
  subcategory: string | null;
  subcategory_label: string | null;
  poster: string | null;
  year: string | null;
  episodes_count: number;
  seasons_count: number;
  genre: string | null;
  rating: number;
  votes: number;
  sort_rating: number;
  sort_recent: number;
  is_new: true;
  url?: string;
}

function normalize(raw: Title): Title {
  return {
    ...raw,
    url: newDetailRoute(raw.slug),
  };
}

/** Load a single NEW work's full detail by slug at request time. */
export async function loadNewWork(slug: string, requestUrl: URL): Promise<Title | undefined> {
  if (!slug) return undefined;
  const assetUrl = new URL(`/_data/new/${slugToFile(slug)}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) return undefined; // unknown / non-new slug → 404 at the page level
  return normalize((await res.json()) as Title);
}

const subcatCache = new Map<string, SubcatCard[]>();

/** Load the slim card index for one sub-category at request time. */
export async function loadSubcat(sub: string, requestUrl: URL): Promise<SubcatCard[]> {
  if (subcatCache.has(sub)) return subcatCache.get(sub)!;
  const assetUrl = new URL(`/_data/subcat/${sub}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) return [];
  const list = (await res.json()) as SubcatCard[];
  for (const e of list) e.url = newDetailRoute(e.slug);
  subcatCache.set(sub, list);
  return list;
}
