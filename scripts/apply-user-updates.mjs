// ============================================================================
// apply-user-updates.mjs — تطبيق تحديثات المستخدم على titles.json + details.json
//   1) إضافة صور الأعمال من reports/needs-images-filled.csv
//   2) إضافة تصنيفات الأفلام الجغرافية (أجنبي/هندي/آسيوي/تركي/نتفليكس) من الكاش
// يُشغَّل مرة واحدة. لا يلمس الحلقات. بعده شغّل rebuild-derived.mjs
// ============================================================================
import fs from 'node:fs';

const TP = 'src/data/titles.json';
const DP = 'src/data/details.json';
const CSV = 'reports/needs-images-filled.csv';
const SUBMAP = '/tmp/movie-subcat.json';

function parseCSVLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur); return out;
}

const titles = JSON.parse(fs.readFileSync(TP, 'utf8'));
const details = JSON.parse(fs.readFileSync(DP, 'utf8'));

// ---- 1) صور الأعمال ---------------------------------------------------------
let imgApplied = 0, imgSkippedMissing = 0;
if (fs.existsSync(CSV)) {
  const lines = fs.readFileSync(CSV, 'utf8').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const id = (c[0] || '').trim();
    const img = (c[5] || '').trim();
    if (!id || !img || !/^https?:\/\//.test(img)) continue;
    if (!titles[id]) { imgSkippedMissing++; continue; }
    titles[id].poster = img;
    if (details[id]) details[id].poster = img;
    imgApplied++;
  }
}
console.log(`صور مُطبَّقة: ${imgApplied} | متخطّاة (id غير موجود): ${imgSkippedMissing}`);

// ---- 2) تصنيفات الأفلام الجغرافية ------------------------------------------
// الأفلام غير مُثراة من TMDB (بلا genres). نستخدم التصنيف الجغرافي كفلتر مفيد.
let movieGenreApplied = 0;
if (fs.existsSync(SUBMAP)) {
  const subMap = JSON.parse(fs.readFileSync(SUBMAP, 'utf8'));
  for (const id in titles) {
    const t = titles[id];
    if (t.type !== 'movie') continue;
    if (t.genres && t.genres.length) continue; // لا نلمس ما له تصنيفات
    const label = subMap[id];
    if (label) {
      t.genres = [label];
      if (details[id]) details[id].genres = [label];
      movieGenreApplied++;
    }
  }
}
console.log(`تصنيفات أفلام جغرافية مُطبَّقة: ${movieGenreApplied}`);

fs.writeFileSync(TP, JSON.stringify(titles));
fs.writeFileSync(DP, JSON.stringify(details));
console.log(`✔ حُفظ. إجمالي الأعمال: ${Object.keys(titles).length}`);
