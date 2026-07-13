// ============================================================================
// طبقة قراءة البيانات — سينما لايف — (النسخة الثقيلة للصفحات الثابتة فقط)
// ----------------------------------------------------------------------------
// تُستورد فقط داخل صفحات prerender=true (index / category / title). كل البيانات
// الضخمة تُقرأ من القرص عبر fs وقت البناء (Node) — لا تمرّ عبر مُجمِّع الحِزم
// (rollup/esbuild) إطلاقاً، فلا يتضخّم البناء ولا حزمة الـ Worker.
// ممنوع استيراد هذا الملف من صفحات SSR (watch/search).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import type { TitleCard, TitleDetail, Episode } from './data';
import { shardOf } from './data';

export type { TitleCard, TitleDetail, Episode, SeasonInfo, Server, CastMember } from './data';

// نحلّ المسارات نسبةً لجذر المشروع (cwd وقت البناء) لأن هذه الوحدة تُحزَّم
// إلى dist/_worker.js/chunks/ ويصبح import.meta.url مضلِّلاً. القراءة تحدث
// فقط وقت البناء (prerender) لصفحات ثابتة، فـ cwd = جذر المشروع.
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data');
const EPISODES_DIR = path.join(ROOT, 'public', 'data', 'episodes');

function loadJSON<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
}

// تُحمّل مرة واحدة وقت البناء (وحدة مُخزّنة/مُفردة)
export const titles = loadJSON<Record<string, TitleCard>>('titles.json');
export const categories = loadJSON<Record<string, any>>('categories.json');
export const home = loadJSON<any>('home.json');
const detailsFullMap = loadJSON<Record<string, TitleDetail>>('details.json');

// -------- الوصول للبطاقات (build-time) --------------------------------------
export function getTitle(id: string): TitleCard | undefined {
  return titles[id];
}
export function allTitleIds(): string[] {
  return Object.keys(titles);
}
export function allCategorySlugs(): string[] {
  return Object.keys(categories);
}
export function expandCards(ids: string[]): TitleCard[] {
  return ids.map((id) => titles[id]).filter(Boolean);
}

// معرّفات الأعمال المُثراة من TMDB فقط (الدفعة الجاهزة للنشر).
// نولّد لها صفحات ثابتة. باقي الأعمال تُخدَّم SSR حتى تُثرى لاحقاً — يبقي عدد
// الملفات الثابتة منخفضاً جداً (< 20,000) وزمن البناء عملياً.
export function enrichedTitleIds(): string[] {
  const out: string[] = [];
  for (const id in detailsFullMap) {
    if (detailsFullMap[id]?.tmdbId) out.push(id);
  }
  return out;
}

// -------- التفاصيل الكاملة (build-time) -------------------------------------
export function getDetail(id: string): TitleDetail | undefined {
  return detailsFullMap[id];
}

// -------- أعمال مشابهة (نفس النوع + تقاطع تصنيفات) — build-time --------------
export function similarTitles(id: string, limit = 6): TitleCard[] {
  const base = titles[id];
  if (!base) return [];
  const baseGenres = new Set(base.genres || []);
  const scored: { c: TitleCard; s: number }[] = [];
  // نقصر المقارنة على الأعمال المُثراة (لها صفحة ثابتة) لتفادي روابط ميتة
  for (const key in detailsFullMap) {
    if (key === id) continue;
    if (!detailsFullMap[key]?.tmdbId) continue;
    const c = titles[key];
    if (!c || c.type !== base.type) continue;
    let overlap = 0;
    for (const g of c.genres || []) if (baseGenres.has(g)) overlap++;
    if (overlap === 0 && baseGenres.size > 0) continue;
    scored.push({ c, s: overlap * 10 + (c.rating || 0) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}

// -------- الحلقات build-time للصفحات الثابتة (قراءة من public/data عبر fs) -----
const _shardCache = new Map<string, Record<string, Record<string, Episode[]>>>();
export function getEpisodesStatic(id: string): Record<string, Episode[]> | null {
  const sh = shardOf(id);
  let shard = _shardCache.get(sh);
  if (!shard) {
    const file = path.join(EPISODES_DIR, `shard-${sh}.json`);
    if (!fs.existsSync(file)) return null;
    shard = JSON.parse(fs.readFileSync(file, 'utf8'));
    _shardCache.set(sh, shard!);
  }
  return shard![id] ?? null;
}

// ============================================================================
// أقسام/تصنيفات — build-time (Static)
// ----------------------------------------------------------------------------
// نبني بطاقات القسم + الفهرس المضغوط + الميتا مباشرةً من `categories` + `titles`
// المُحمّلة في الذاكرة وقت البناء. لا fetch وقت الطلب ولا ملفات JSON وسيطة ⇒
// كل صفحة قسم تُطبع HTML كامل بصورها الصحيحة وقت البناء (يحل مشكلة كاش الـ CDN).
// ============================================================================
export const CAT_PAGE_SIZE = 60;

export interface CatMetaStatic {
  slug: string;
  label: string;
  type: string | null;
  total: number;
  pages: number;
  pageSize: number;
  genres: string[];
  years: number[];
}

// صف مضغوط للفلترة client-side: [id, title, titleEn, year, rating, poster, genresJoined]
export type CatIndexRow = [string, string, string, number, number, string, string];

function catIdsOf(slug: string): string[] {
  const c = categories[slug];
  return (c && c.items) || [];
}

/** بطاقات صفحة واحدة من القسم (build-time). page يبدأ من 1. */
export function catPageCards(slug: string, page: number): TitleCard[] {
  const ids = catIdsOf(slug);
  const start = (page - 1) * CAT_PAGE_SIZE;
  return ids
    .slice(start, start + CAT_PAGE_SIZE)
    .map((id) => titles[id])
    .filter(Boolean);
}

/** الفهرس المضغوط الكامل للقسم (للفلترة/الترتيب client-side). */
export function catIndexRows(slug: string): CatIndexRow[] {
  const rows: CatIndexRow[] = [];
  for (const id of catIdsOf(slug)) {
    const t = titles[id];
    if (!t) continue;
    const gs = (t.genres && t.genres.length ? t.genres : []).slice(0, 4);
    rows.push([id, t.title || '', t.titleEn || '', t.year || 0, t.rating || 0, t.poster || '', gs.join('|')]);
  }
  return rows;
}

/** ميتا القسم: العدد، الصفحات، التصنيفات، السنوات (build-time). */
export function catMetaStatic(slug: string): CatMetaStatic {
  const c = categories[slug] || {};
  const ids = catIdsOf(slug);
  const genreCount: Record<string, number> = {};
  const yearSet = new Set<number>();
  for (const id of ids) {
    const t = titles[id];
    if (!t) continue;
    const gs = (t.genres && t.genres.length ? t.genres : []).slice(0, 4);
    for (const g of gs) if (g) genreCount[g] = (genreCount[g] || 0) + 1;
    if (t.year) yearSet.add(t.year);
  }
  const genres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([g]) => g);
  const years = Array.from(yearSet)
    .filter((y) => y > 1900)
    .sort((a, b) => b - a);
  const total = ids.length;
  return {
    slug,
    label: c.label || slug,
    type: c.type ?? null,
    total,
    pages: Math.max(1, Math.ceil(total / CAT_PAGE_SIZE)),
    pageSize: CAT_PAGE_SIZE,
    genres,
    years,
  };
}
