// ============================================================================
// تحويل البيانات — سينما لايف
// ----------------------------------------------------------------------------
// (1) قلب الأسماء: تصبح الأسماء الأجنبية (الأصلية) هي الاسم الأساسي المعروض،
//     والعربي يُحفظ كاسم ثانوي (للبحث ثنائي اللغة). لا نغيّر الـ id إطلاقاً حتى
//     لا تنكسر الروابط/الفهرسة.
// (2) حذف الأعمال المحظورة (blocklist) نهائياً من titles + details.
//     المشتقات (home/categories/shards/search-index) تُعاد لاحقاً بسكربت البناء.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { isBlockedName } from './blocklist.mjs';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data');

const hasArabic = (s) => /[\u0600-\u06FF]/.test(s || '');
const hasLatin = (s) => /[a-zA-Z]/.test(s || '');
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ').replace(/\s+/g, ' ').trim();

function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
function saveJSON(f, obj) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(obj)); }

console.log('▶ قراءة البيانات…');
const titles = loadJSON('titles.json');
const details = loadJSON('details.json');

// ---------------------------------------------------------------------------
// (2) الحذف: نحدّد المعرّفات المحظورة أولاً
// ---------------------------------------------------------------------------
const blockedIds = new Set();
for (const id in titles) {
  const t = titles[id];
  const d = details[id];
  const cand = [t.title, t.titleEn, d?.originalTitle].filter(Boolean);
  if (cand.some((nm) => isBlockedName(nm))) blockedIds.add(id);
}
console.log(`  محظور للحذف: ${blockedIds.size} عمل`);
for (const id of blockedIds) {
  console.log('   ✗', titles[id]?.title, '|', titles[id]?.titleEn, '(', id, ')');
  delete titles[id];
  delete details[id];
}

// ---------------------------------------------------------------------------
// (1) قلب الأسماء للإنجليزي (الاسم الأصلي أولاً)
// ---------------------------------------------------------------------------
let flipped = 0, keptArabic = 0, alreadyEn = 0;
for (const id in titles) {
  const t = titles[id];
  const d = details[id];
  // المصدر الأجنبي المفضّل: titleEn ثم originalTitle
  let en = (t.titleEn || '').trim();
  const orig = (d?.originalTitle || '').trim();
  if ((!en || !hasLatin(en)) && orig && hasLatin(orig)) en = orig;

  if (!hasArabic(t.title)) { alreadyEn++; continue; } // الاسم أصلاً أجنبي — لا شيء

  const enUsable = en && hasLatin(en) && norm(en) !== norm(t.title);
  if (enUsable) {
    const ar = t.title;              // نحفظ العربي كثانوي
    t.title = en;                    // الأساسي = الأجنبي
    t.titleEn = ar;                  // نضع العربي في titleEn (يبقى قابلاً للبحث)
    if (d) { d.title = en; d.titleEn = ar; }
    flipped++;
  } else {
    keptArabic++; // عمل عربي أصيل بلا اسم أجنبي — يبقى كما هو
  }
}

console.log(`  قُلبت للإنجليزي: ${flipped} | بقيت عربية (أصيلة): ${keptArabic} | إنجليزية أصلاً: ${alreadyEn}`);

saveJSON('titles.json', titles);
saveJSON('details.json', details);
console.log(`✔ حُفظ. إجمالي الأعمال الآن: ${Object.keys(titles).length}`);
