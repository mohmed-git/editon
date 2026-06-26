// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// اسم الموقع ورابطه للنشر
export const SITE_NAME = 'CinemaPlus';
export const SITE_URL = 'https://cinemanaplus.site';

/** @param {string} page */
function shouldIncludeInSitemap(page) {
  const pathname = page.startsWith('http') ? new URL(page).pathname : page;
  const normalized = pathname.replace(/\/$/, '');

  // Exclude the opaque streaming gateway (/g/...) and the 404 page.
  // NOTE: episode pages (/d|n/.../c/.../e/...) are now SSR (prerender = false)
  // so Astro's static sitemap can never see them. They are emitted by a
  // dedicated /episodes-sitemap.xml endpoint (wired in via `customPages`).
  return !normalized.startsWith('/g/') && normalized !== '/404';
}

export default defineConfig({
  site: SITE_URL,
  // Hybrid model: every page is STATIC by default (prerendered at build time);
  // only routes that explicitly opt in with `export const prerender = false`
  // (the episode pages) run as on-demand SSR on the Cloudflare edge.
  // In Astro 5 the old `output: 'hybrid'` is expressed as `output: 'static' + adapter`.
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  session: {
    driver: 'memory',
  },
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  integrations: [
    tailwind({
      applyBaseStyles: true,
    }),
    sitemap({
      i18n: {
        defaultLocale: 'ar',
        locales: { ar: 'ar-SA' },
      },
      filter: shouldIncludeInSitemap,
      entryLimit: 1000,
      // The SSR episode pages are invisible to the static crawler, so we feed
      // their dedicated sitemap into the sitemap index manually.
      customPages: [`${SITE_URL}/episodes-sitemap.xml`],
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  vite: {
    build: {
      cssMinify: true,
      minify: 'esbuild',
    },
    ssr: {
      noExternal: ['fuse.js'],
    },
  },
});
