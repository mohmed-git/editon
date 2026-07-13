// ============================================================================
// أدوات مشتركة بين سكربتات الاستيراد — سينما لايف
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'src', 'data');
// ملفات الـ shards الضخمة (details/episodes) تُكتب هنا كأصول ثابتة تُخدَّم مباشرة
// من CDN، ولا تمرّ عبر مُجمِّع الحِزم (bundler) ⇒ لا تضخيم لحزمة الـ Worker.
export const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
export const CACHE_DIR = path.join(ROOT, '.import-cache');
export const REPORTS_DIR = ROOT;

export const CSV_PATH =
  process.env.CSV_PATH ||
  '/home/user/uploaded_files/cinemaplus-catalog-all.csv';

// -------- محلّل CSV صحيح (يدعم الحقول المقتبسة بفواصل داخلية) ----------------
export function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// -------- تنظيف الاسم: فصل الاسم العربي عن الأجنبي واستخراج السنة ------------
// أمثلة من الكتالوج:
//   "أونا Chuunibyou demo Koi ga Shitai! Lite"  → ar="أونا" en="Chuunibyou..."
//   "طر مجددا Fly, Again"                         → ar="طر مجددا" en="Fly, Again"
//   "Baby 2025 مترجم اون لاين"                     → en="Baby" year=2025
const NOISE = /\s*(مترجم(?:ة)?|اون\s*لاين|online|مشاهدة|كامل(?:ة)?|بجودة\s*عالية|HD|4K|بلوراي|BluRay)\s*/gi;

export function cleanTitle(raw) {
  let t = (raw || '').trim();
  // استخرج أول سنة معقولة (1900–2035)
  let year = null;
  const ym = t.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (ym) year = parseInt(ym[1], 10);
  // احذف الضجيج التسويقي
  let cleaned = t.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
  // احذف السنة من الاسم (تبقى محفوظة في year)
  cleaned = cleaned.replace(/\b(19\d{2}|20[0-3]\d)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // افصل الجزء العربي عن اللاتيني
  const arChars = /[\u0600-\u06FF]/;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const arWords = [];
  const enWords = [];
  for (const w of words) {
    if (arChars.test(w)) arWords.push(w);
    else enWords.push(w);
  }
  const ar = arWords.join(' ').trim();
  const en = enWords.join(' ').replace(/[\s,–-]+$/, '').replace(/^[\s,–-]+/, '').trim();
  // اسم البحث في TMDB: نفضّل اللاتيني إن وُجد، وإلا العربي
  const searchName = en || ar || cleaned;
  return { ar, en, year, searchName, cleaned };
}

// -------- التحقق من صلاحية رابط سيرفر كـ iframe صالح -------------------------
export function isValidIframeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname || !parsed.hostname.includes('.')) return false;
    // نرفض الروابط الواضحة أنها ليست مشغّل embed
    if (/\.(jpg|jpeg|png|gif|webp|svg|txt|pdf)$/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

// -------- كتابة JSON ---------------------------------------------------------
export function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}
export function writeJSON(file, obj, pretty = false) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}
export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

// -------- shard: توزيع الحلقات على عدد محدود من الملفات (احترام حد 20k ملف) --
// نستخدم hash بسيط على slug → رقم shard من 0..N-1
export function shardOf(slug, shards = 64) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % shards;
}

// -------- عربنة أرقام المواسم كتابةً (للعناوين الداخلية للحلقات) -------------
export const ORD_AR = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
export function seasonOrdAr(n) {
  return ORD_AR[n] || `${n}`;
}
