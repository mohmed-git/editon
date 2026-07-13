// ============================================================================
// حذف قسم "إيتشي" (Ecchi) والأعمال غير اللائقة — سينما لايف
// ----------------------------------------------------------------------------
// يحذف من titles.json و details.json كل عمل:
//   - مصنّف "ايتشي" (Ecchi) أو "hentai"
//   - العملان المحددان يدوياً (yowayowa-sensei, haite-kudasai-takamine-san)
// ثم ينظّف shards الحلقات، ويزيل تصنيف "ايتشي" من بقية الأعمال (احتياطاً).
// إعادة البناء (categories/cat/search-index...) تتم عبر rebuild-derived.mjs بعده.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PUBLIC_DATA_DIR, shardOf } from './lib-common.mjs';

const SHARDS = 64;
const pad = (i) => String(i).padStart(2, '0');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const save = (f, o) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(o));

console.log('▶ حذف قسم إيتشي والأعمال غير اللائقة…');

const titles = load('titles.json');
const details = load('details.json');

// نسخ احتياطية
fs.writeFileSync('/tmp/titles.before-remove.json', JSON.stringify(titles));
fs.writeFileSync('/tmp/details.before-remove.json', JSON.stringify(details));

// قوائم/أنماط الحذف
const ECCHI_RE = /ايتشي|إيتشي|ecchi/i;
const HENTAI_RE = /hentai|هنتاي|إباحي/i;
const MANUAL_IDS = ['yowayowa-sensei', 'haite-kudasai-takamine-san'];

const toDelete = new Set(MANUAL_IDS.filter((id) => titles[id]));

for (const [id, x] of Object.entries(titles)) {
  const genres = (x.genres || []).join('|');
  const title = ((x.title || '') + ' ' + (x.titleEn || ''));
  if (ECCHI_RE.test(genres) || HENTAI_RE.test(genres) || HENTAI_RE.test(title)) {
    toDelete.add(id);
  }
}

console.log(`  • سيُحذف ${toDelete.size} عمل.`);

// 1) حذف من titles و details
for (const id of toDelete) {
  delete titles[id];
  delete details[id];
}

// 2) إزالة تصنيف "ايتشي" من بقية الأعمال الباقية (احتياطاً لتنظيف الفلاتر)
let cleanedGenres = 0;
for (const [id, x] of Object.entries(titles)) {
  if (Array.isArray(x.genres) && x.genres.some((g) => ECCHI_RE.test(g))) {
    x.genres = x.genres.filter((g) => !ECCHI_RE.test(g));
    if (details[id] && Array.isArray(details[id].genres)) {
      details[id].genres = details[id].genres.filter((g) => !ECCHI_RE.test(g));
    }
    cleanedGenres++;
  }
}
console.log(`  • نُظّف تصنيف "ايتشي" من ${cleanedGenres} عمل باقٍ (إن وُجد).`);

save('titles.json', titles);
save('details.json', details);
console.log('  ✔ حُفظ titles.json و details.json');

// 3) تنظيف shards الحلقات من الأعمال المحذوفة
const epDir = path.join(PUBLIC_DATA_DIR, 'episodes');
let removedFromShards = 0;
const shardsTouched = new Set();
for (const id of toDelete) shardsTouched.add(shardOf(id, SHARDS));
for (const s of shardsTouched) {
  const f = path.join(epDir, `shard-${pad(s)}.json`);
  if (!fs.existsSync(f)) continue;
  const shard = JSON.parse(fs.readFileSync(f, 'utf8'));
  let changed = false;
  for (const id of toDelete) {
    if (shard[id]) { delete shard[id]; changed = true; removedFromShards++; }
  }
  if (changed) fs.writeFileSync(f, JSON.stringify(shard));
}
console.log(`  ✔ حُذف ${removedFromShards} عمل من shards الحلقات`);

console.log(`✔ تمّ. المتبقّي: ${Object.keys(titles).length} عمل. شغّل الآن: node scripts/rebuild-derived.mjs`);
