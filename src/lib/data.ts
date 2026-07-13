// ============================================================================
// طبقة قراءة البيانات — سينما لايف — (النسخة الخفيفة لـ SSR)
// ----------------------------------------------------------------------------
// هذا الملف يُستورد داخل صفحات SSR (watch/search). لذلك يجب أن يبقى خفيفاً جداً:
//  - لا يستورد details.json/titles.json الضخمة (تُبنى في data-static.ts فقط).
//  - يقرأ shard واحداً فقط عبر dynamic import ⇒ حزمة Worker صغيرة + CPU 10ms.
// الأنواع (interfaces) مُعرّفة هنا ويعيد data-static.ts تصديرها للصفحات الثابتة.
// ============================================================================

import statsData from '../data/stats.json';

export interface TitleCard {
  id: string;
  type: 'movie' | 'series' | 'anime';
  title: string;
  titleEn: string;
  year: number | null;
  rating: number | null;
  poster: string;
  backdrop: string | null;
  genres: string[];
  isNew?: boolean;
}

export interface SeasonInfo { num: number; episodes: number }

/** عضو طاقم التمثيل — اسم + الشخصية + صورة (من TMDB) */
export interface CastMember { name: string; character: string; profile: string | null }

export interface TitleDetail extends TitleCard {
  tmdbId: number | null;
  originalTitle: string;
  voteCount: number;
  ratingSource: string | null;
  tmdbPoster: string | null;
  duration?: string | null;
  runtime: number | null;
  country: string;
  synopsis: string;
  tagline: string;
  cast: CastMember[];
  creators: string[];
  quality: string;
  language: string;
  seasonCount: number;
  episodeCount: number;
  totalValidServers: number;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  popularity: number;
  ready: boolean;
  seasons: SeasonInfo[];
}

export interface Server { id: string; name: string; url: string }

export interface Episode {
  num: number;
  name: string;
  synopsis: string;
  rating: number | null;
  voteCount: number;
  ratingSource: string | null;
  still: string | null;
  airDate: string | null;
  servers: Server[];
}

export const stats = statsData as any;

// -------- عدد الـ shards (يطابق ما ولّده السكربت) ----------------------------
const SHARDS = (stats && stats.shards) || 64;
export function shardOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return String(h % SHARDS).padStart(2, '0');
}

// -------- جلب shard كأصل ثابت (SSR) -----------------------------------------
// الـ shards مخزّنة في public/data ⇒ تُخدَّم من CDN كأصول ثابتة. نجلبها بـ fetch
// وقت الطلب (shard واحد فقط) بدل استيرادها عبر الـ bundler، فلا تتضخّم حزمة
// الـ Worker ولا نتجاوز حد الحجم. الجلب من نفس النطاق (أصل الطلب) سريع.
async function fetchShard<T>(kind: 'details' | 'episodes', id: string, origin: URL): Promise<T | null> {
  const url = new URL(`/data/${kind}/shard-${shardOf(id)}.json`, origin);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getDetailSSR(id: string, origin: URL): Promise<TitleDetail | undefined> {
  const map = await fetchShard<Record<string, TitleDetail>>('details', id, origin);
  return map ? map[id] : undefined;
}

export async function getEpisodes(
  id: string,
  origin: URL
): Promise<Record<string, Episode[]> | null> {
  const shard = await fetchShard<Record<string, Record<string, Episode[]>>>('episodes', id, origin);
  return shard ? shard[id] ?? null : null;
}

// -------- أعمال مشابهة (SSR) ------------------------------------------------
// نجلب فهرس البحث المضغوط (الأعمال المُثراة فقط، خفيف) ونختار من نفس النوع مع
// تقاطع التصنيفات إن وُجد. هذا يبقي الروابط تشير لأعمال ذات صفحات غنية.
let _searchIdxCache: TitleCard[] | null = null;
async function loadSearchIndex(origin: URL): Promise<TitleCard[]> {
  if (_searchIdxCache) return _searchIdxCache;
  try {
    const res = await fetch(new URL('/data/search-index.json', origin).toString());
    if (!res.ok) return [];
    _searchIdxCache = (await res.json()) as TitleCard[];
  } catch {
    _searchIdxCache = [];
  }
  return _searchIdxCache;
}

/** بحث نصي في الفهرس الكامل (يُجلب كأصل ثابت — لا يُحزَّم في الـ Worker) */
export async function searchSSR(q: string, origin: URL, limit = 60): Promise<TitleCard[]> {
  const nq = q.trim().toLowerCase();
  if (!nq) return [];
  const idx = await loadSearchIndex(origin);
  const out: TitleCard[] = [];
  for (const t of idx) {
    if ((t.title || '').toLowerCase().includes(nq) || (t.titleEn || '').toLowerCase().includes(nq)) {
      out.push(t);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// فهرس "المشابهة" مُقسّم حسب النوع (خفيف — نوع واحد فقط لكل طلب)
const _simCache: Record<string, TitleCard[]> = {};
async function loadSimilarIndex(type: string, origin: URL): Promise<TitleCard[]> {
  if (_simCache[type]) return _simCache[type];
  try {
    const res = await fetch(new URL(`/data/similar-${type}.json`, origin).toString());
    _simCache[type] = res.ok ? ((await res.json()) as TitleCard[]) : [];
  } catch {
    _simCache[type] = [];
  }
  return _simCache[type];
}

// -------- فهرس الأقسام (SSR بالترقيم) ---------------------------------------
export interface CatMeta { label: string; type: string | null; total: number; pages: number; pageSize: number }

let _catMetaCache: Record<string, CatMeta> | null = null;
export async function getCategoryMeta(origin: URL): Promise<Record<string, CatMeta>> {
  if (_catMetaCache) return _catMetaCache;
  try {
    const res = await fetch(new URL('/data/cat/meta.json', origin).toString());
    _catMetaCache = res.ok ? ((await res.json()) as Record<string, CatMeta>) : {};
  } catch {
    _catMetaCache = {};
  }
  return _catMetaCache;
}

export async function getCategoryPage(slug: string, page: number, origin: URL): Promise<TitleCard[]> {
  try {
    const res = await fetch(new URL(`/data/cat/${slug}-${page}.json`, origin).toString());
    if (!res.ok) return [];
    return (await res.json()) as TitleCard[];
  } catch {
    return [];
  }
}

export async function similarSSR(
  base: { id: string; type: string; genres?: string[]; year?: number | null },
  origin: URL,
  limit = 6
): Promise<TitleCard[]> {
  const idx = await loadSimilarIndex(base.type, origin);
  const baseGenres = new Set(base.genres || []);
  const baseYear = base.year || null;
  const scored: { c: TitleCard; s: number }[] = [];
  for (const c of idx) {
    if (String(c.id) === String(base.id)) continue;
    if (c.type !== base.type) continue; // نفس النوع دائماً
    let overlap = 0;
    for (const g of c.genres || []) if (baseGenres.has(g)) overlap++;
    // درجة أساسية: تقاطع التصنيفات (أهم عامل) + التقييم.
    // fallback للأعمال بلا تصنيفات: قرب السنة يمنحها تقارباً معقولاً حتى لا يفرغ القسم.
    let s = overlap * 20 + (c.rating || 0);
    if (baseYear && c.year) s += Math.max(0, 6 - Math.abs(c.year - baseYear));
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}
