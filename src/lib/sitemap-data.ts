// ============================================================================
// بناء قائمة كل روابط خريطة الموقع (مشترك بين فهرس الخرائط والشرائح)
// ----------------------------------------------------------------------------
// نقرأ فهرساً خفيفاً [id, priority] عبر fs (وليس details.json/titles.json
// الضخمين) لتفادي استنفاد الذاكرة أثناء البناء.
// الروابط مقسّمة إلى شرائح كل SITEMAP_CHUNK رابط في ملف فرعي.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { SITE_URL } from './seo';

export const SITEMAP_CHUNK = 1000;

export interface SitemapEntry {
  loc: string;
  priority: string;
  changefreq: string;
}

let _cache: SitemapEntry[] | null = null;

/** يبني قائمة كل روابط الموقع (الرئيسية + الأقسام + كل الأعمال). */
export function buildAllUrls(): SitemapEntry[] {
  if (_cache) return _cache;

  const entries: SitemapEntry[] = [];

  // 1) الرئيسية
  entries.push({ loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily' });

  // 2) الأقسام + صفحات ترقيمها الثابتة
  const CAT_PAGE_SIZE = 60;
  let catCounts: Record<string, number> = {};
  try {
    const catFile = path.join(process.cwd(), 'src', 'data', 'categories.json');
    const cats = JSON.parse(fs.readFileSync(catFile, 'utf8')) as Record<
      string,
      { items?: unknown[] }
    >;
    for (const [slug, v] of Object.entries(cats)) {
      catCounts[slug] = Array.isArray(v.items) ? v.items.length : 0;
    }
  } catch {
    catCounts = { movie: 0, series: 0, anime: 0, trending: 0 };
  }
  for (const slug of ['movie', 'series', 'anime', 'trending']) {
    entries.push({ loc: `${SITE_URL}/category/${slug}`, priority: '0.8', changefreq: 'daily' });
    const pages = Math.max(1, Math.ceil((catCounts[slug] || 0) / CAT_PAGE_SIZE));
    for (let p = 2; p <= pages; p++) {
      entries.push({
        loc: `${SITE_URL}/category/${slug}/${p}`,
        priority: '0.5',
        changefreq: 'weekly',
      });
    }
  }

  // 3) كل الأعمال — من الفهرس الخفيف [id, priority]
  const idxFile = path.join(process.cwd(), 'src', 'data', 'sitemap-index.json');
  let sm: [string, string][] = [];
  try {
    sm = JSON.parse(fs.readFileSync(idxFile, 'utf8')) as [string, string][];
  } catch {
    sm = [];
  }
  for (const [id, pr] of sm) {
    entries.push({ loc: `${SITE_URL}/title/${id}`, priority: pr, changefreq: 'weekly' });
  }

  _cache = entries;
  return entries;
}

/** عدد الشرائح (كل SITEMAP_CHUNK رابط). */
export function chunkCount(): number {
  const total = buildAllUrls().length;
  return Math.max(1, Math.ceil(total / SITEMAP_CHUNK));
}

/** روابط شريحة رقم page (يبدأ من 1). */
export function chunkUrls(page: number): SitemapEntry[] {
  const all = buildAllUrls();
  const start = (page - 1) * SITEMAP_CHUNK;
  return all.slice(start, start + SITEMAP_CHUNK);
}
