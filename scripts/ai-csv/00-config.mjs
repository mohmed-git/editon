// ============================================================================
// إعدادات مشتركة لخط أنابيب إعادة البناء من catalog-ai.csv
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'src', 'data');
export const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
export const CACHE_DIR = path.join(ROOT, '.import-cache');

export const CSV_PATH =
  process.env.CSV_PATH ||
  '/home/user/uploaded_files/cinemaplus-catalog-ai.csv';

// قراءة توكن TMDB من .dev.vars أو من البيئة
export function tmdbToken() {
  if (process.env.TMDB_TOKEN) return process.env.TMDB_TOKEN;
  try {
    const t = fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8');
    const m = t.match(/TMDB_TOKEN\s*=\s*"?([^"\n]+)"?/);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

export function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
export function writeJSON(file, obj, pretty = false) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}
export function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// تجزئة العنصر إلى shard (نفس منطق الموقع الحالي)
export function shardOf(id, shards = 64) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % shards;
}

// تحقق من صلاحية رابط سيرفر
export function isValidIframeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (u.length < 12) return false;
  return true;
}
