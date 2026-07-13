// ============================================================================
// فهرس خرائط الموقع (sitemap.xml) — يشير إلى شرائح فرعية كل 1000 رابط
// ----------------------------------------------------------------------------
// بدل ملف واحد ضخم، نقسّم كل الروابط إلى شرائح sitemap-1.xml ... sitemap-N.xml
// (كل شريحة SITEMAP_CHUNK=1000 رابط). هذا الملف هو الفهرس (<sitemapindex>)
// الذي يشير إليها — وهو ما يجب تقديمه في robots.txt / Search Console.
// ============================================================================
import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/seo';
import { chunkCount } from '../lib/sitemap-data';

export const prerender = true;

export const GET: APIRoute = () => {
  const now = new Date().toISOString().slice(0, 10);
  const count = chunkCount();
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);
  for (let p = 1; p <= count; p++) {
    parts.push(
      `  <sitemap><loc>${SITE_URL}/sitemap-${p}.xml</loc><lastmod>${now}</lastmod></sitemap>`
    );
  }
  parts.push(`</sitemapindex>`);
  return new Response(parts.join('\n') + '\n', {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
