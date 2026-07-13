// ============================================================================
// apply-anime-images.mjs — تطبيق صور الأنمي المجلوبة من AniList على البيانات
// يقرأ /tmp/anime-images-found.json ويحدّث titles.json + details.json
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, 'src', 'data');
const titlesPath = path.join(DATA, 'titles.json');
const detailsPath = path.join(DATA, 'details.json');

const found = JSON.parse(fs.readFileSync('/tmp/anime-images-found.json', 'utf8'));
const titles = JSON.parse(fs.readFileSync(titlesPath, 'utf8'));
const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));

// نسخة احتياطية
fs.writeFileSync('/tmp/titles.before-anime-img.json', JSON.stringify(titles));
fs.writeFileSync('/tmp/details.before-anime-img.json', JSON.stringify(details));

let applied = 0, skippedNoTitle = 0;
for (const id in found) {
  const img = found[id];
  if (!img || !/^https?:\/\//.test(img)) continue;
  if (!titles[id]) { skippedNoTitle++; continue; }
  titles[id].poster = img;
  if (details[id]) details[id].poster = img;
  applied++;
}

fs.writeFileSync(titlesPath, JSON.stringify(titles));
fs.writeFileSync(detailsPath, JSON.stringify(details));

console.log(`✔ طُبِّقت صور الأنمي: ${applied} | تُخطّي (لا عنوان): ${skippedNoTitle}`);
console.log(`   إجمالي الأعمال: ${Object.keys(titles).length}`);
