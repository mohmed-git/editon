/**
 * Runtime episode-title loader for the SSR episode pages.
 *
 * CRITICAL: the SSR episode routes must NOT import all.json (86MB) nor bundle
 * 2.4k per-title shards through Vite (that produces thousands of dynamic-import
 * chunks and cripples the build). Instead the shards are emitted by
 * scripts/build-episode-shards.mjs as PLAIN STATIC assets under
 * public/_data/episodes/<file>.json, and we fetch the single needed shard at
 * request time.
 *
 * The manifest (slug→file map) is also fetched at runtime from a static asset
 * instead of being bundled into the Worker — this keeps the Worker lean.
 */
import type { Title } from './types';
import { detailRoute } from './routes';

// Per-isolate cache for the manifest and title data.
let manifestCache: Record<string, string> | null = null;

async function getManifest(requestUrl: URL): Promise<Record<string, string>> {
  if (manifestCache) return manifestCache;
  const url = new URL('/_data/episode-manifest.json', requestUrl.origin);
  const res = await fetch(url);
  if (!res.ok) {
    manifestCache = {};
    return manifestCache;
  }
  manifestCache = (await res.json()) as Record<string, string>;
  return manifestCache;
}

function normalize(raw: Title): Title {
  return {
    ...raw,
    url: detailRoute(raw.category, raw.slug),
    relatedAnimeSeasons: raw.relatedAnimeSeasons?.map((s) => ({
      ...s,
      url: detailRoute('anime', s.slug),
    })),
  };
}

/**
 * Load a single episodic Title by slug at request time.
 *
 * @param slug      the title slug from the route params
 * @param requestUrl the incoming request URL (Astro.url) — used as the origin
 *                   to fetch the static shard from the same Pages deployment.
 * Returns undefined for unknown / non-episodic slugs or a missing shard.
 */
export async function loadEpisodicTitle(
  slug: string,
  requestUrl: URL
): Promise<Title | undefined> {
  const manifest = await getManifest(requestUrl);
  const file = manifest[slug];
  if (!file) return undefined;

  const assetUrl = new URL(`/_data/episodes/${file}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) return undefined;

  const raw = (await res.json()) as Title;
  return normalize(raw);
}
