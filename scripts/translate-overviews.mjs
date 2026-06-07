#!/usr/bin/env node
/**
 * translate-overviews.mjs
 * Translates English-only TMDB overviews (lang:'en') in the cache into Arabic
 * using the free Google Translate gtx endpoint, then stores the result as
 * { ar: <translated>, lang: 'ar-mt', en: <original> } so the build step can use
 * a real Arabic plot for every work that had any source text.
 *
 * Resumable: only processes entries whose lang === 'en'. Safe to re-run.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '.cache', 'tmdb-overviews.json');

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;

async function translate(text) {
  // Google Translate may truncate very long text; split into <=1800 char chunks at sentence boundaries.
  const chunks = [];
  let rest = text.trim();
  while (rest.length > 1800) {
    let cut = rest.lastIndexOf('. ', 1800);
    if (cut < 500) cut = 1800;
    chunks.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest) chunks.push(rest);

  const out = [];
  for (const chunk of chunks) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(chunk)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000)); return translate(text); }
      throw new Error('translate http ' + res.status);
    }
    const data = await res.json();
    const sentences = (data[0] || []).map((s) => s[0]).join('');
    out.push(sentences);
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

async function main() {
  const cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  let todo = Object.keys(cache).filter((k) => cache[k].lang === 'en' && cache[k].en);
  if (limitArg > 0) todo = todo.slice(0, limitArg);

  console.log(`English-only entries to translate: ${todo.length}`);
  let done = 0, fail = 0, save = 0;

  for (const key of todo) {
    try {
      const ar = await translate(cache[key].en);
      if (ar && /[\u0600-\u06FF]/.test(ar)) {
        cache[key] = { ar, en: cache[key].en, lang: 'ar-mt' };
      } else {
        fail++;
      }
    } catch (e) {
      fail++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    done++; save++;
    if (save >= 25) {
      await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
      save = 0;
      process.stdout.write(`\r  progress: ${done}/${todo.length} (fail:${fail})   `);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  console.log(`\nDONE. translated: ${done - fail} | failed: ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
