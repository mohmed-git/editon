// ============================================================================
// شرائح خريطة الموقع (sitemap-1.xml ... sitemap-N.xml) — كل شريحة 1000 رابط
// ----------------------------------------------------------------------------
// تُولَّد ثابتة وقت البناء عبر getStaticPaths. الفهرس sitemap.xml يشير إليها.
// ============================================================================
import type { APIRoute, GetStaticPaths } from 'astro';
import { chunkCount, chunkUrls } from '../lib/sitemap-data';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => {
  const count = chunkCount();
  const paths = [];
  for (let p = 1; p <= count; p++) {
    paths.push({ params: { page: String(p) } });
  }
  return paths;
};

export const GET: APIRoute = ({ params }) => {
  const now = new Date().toISOString().slice(0, 10);
  const page = parseInt(String(params.page || '1'), 10) || 1;
  const urls = chunkUrls(page);

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);
  for (const u of urls) {
    parts.push(
      `  <url><loc>${u.loc}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    );
  }
  parts.push(`</urlset>`);
  return new Response(parts.join('\n') + '\n', {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
