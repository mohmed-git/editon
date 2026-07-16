// ============================================================================
// خريطة الموقع (sitemap.xml) — تُولَّد ثابتة وقت البناء
// ----------------------------------------------------------------------------
// تشمل: الرئيسية + الأقسام + صفحات كل الأعمال (10,439) لأنها كلها تُخدَّم SSR.
// نقرأ فهرساً خفيفاً [id, priority] عبر fs (وليس details.json/titles.json
// الضخمين) لتفادي استنفاد الذاكرة أثناء البناء. الحد 50,000 رابط/ملف — آمن.
// ============================================================================
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_URL } from '../lib/seo';

export const prerender = true;

export const GET: APIRoute = () => {
  const now = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

  const url = (loc: string, pr: string, cf: string) =>
    `  <url><loc>${loc}</loc><lastmod>${now}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`;

  parts.push(url(`${SITE_URL}/`, '1.0', 'daily'));

  // الأقسام + صفحات ترقيمها الثابتة (تحسين تغطية الفهرسة)
  const CAT_PAGE_SIZE = 60;
  let catCounts: Record<string, number> = {};
  try {
    const catFile = path.join(process.cwd(), 'src', 'data', 'categories.json');
    const cats = JSON.parse(fs.readFileSync(catFile, 'utf8')) as Record<string, { items?: unknown[] }>;
    for (const [slug, v] of Object.entries(cats)) {
      catCounts[slug] = Array.isArray(v.items) ? v.items.length : 0;
    }
  } catch {
    catCounts = { movie: 0, series: 0, anime: 0, trending: 0 };
  }
  for (const slug of ['movie', 'series', 'anime', 'trending']) {
    parts.push(url(`${SITE_URL}/category/${slug}`, '0.8', 'daily'));
    const pages = Math.max(1, Math.ceil((catCounts[slug] || 0) / CAT_PAGE_SIZE));
    for (let p = 2; p <= pages; p++) {
      parts.push(url(`${SITE_URL}/category/${slug}/${p}`, '0.5', 'weekly'));
    }
  }

  // فهرس خفيف [id, priority]
  const idxFile = path.join(process.cwd(), 'src', 'data', 'sitemap-index.json');
  let sm: [string, string][] = [];
  try {
    sm = JSON.parse(fs.readFileSync(idxFile, 'utf8')) as [string, string][];
  } catch {
    sm = [];
  }
  for (const [id, pr] of sm) {
    parts.push(url(`${SITE_URL}/title/${id}`, pr, 'weekly'));
  }

  parts.push(`</urlset>`);
  return new Response(parts.join('\n') + '\n', {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
