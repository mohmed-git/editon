// ============================================================================
// build-images-report.mjs — تقرير نهائي لحالة الصور الناقصة
// يدمج: قائمة الأعمال التي احتاجت صوراً + الصور من المستخدم + الصور من AniList
// ويكتب reports/images-final-report.csv
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const titles = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/titles.json'), 'utf8'));
const anilist = JSON.parse(fs.readFileSync('/tmp/anime-images-found.json', 'utf8'));

// الأعمال الأصلية التي احتاجت صوراً (من ملف المستخدم المرفوع)
const filledCsv = fs.readFileSync(path.join(ROOT, 'reports/needs-images-filled.csv'), 'utf8').trim().split('\n');
const header = filledCsv.shift();
const userImages = {}; // id -> url من المستخدم
for (const line of filledCsv) {
  // parse بسيط (لا فواصل داخل الحقول عدا الاسم — نتعامل بحذر)
  const cols = line.split(',');
  const id = cols[0];
  const url = cols[5];
  if (url && /^https?:\/\//.test(url)) userImages[id] = url;
}

// كل الأعمال التي احتاجت صوراً = مفاتيح الـ CSV
const needIds = filledCsv.map((l) => l.split(',')[0]);
// أضف أي أعمال في CSV بالاسم
const nameMap = {};
for (const l of filledCsv) { const c = l.split(','); nameMap[c[0]] = c[1]; }

const out = ['id,name,type,poster_source,final_status,image_url'];
let fromUser = 0, fromAnilist = 0, stillMissing = 0;
for (const id of needIds) {
  const t = titles[id];
  const name = (nameMap[id] || (t && t.title) || '').replace(/,/g, ' ');
  const type = t ? t.type : 'anime';
  const poster = t ? t.poster : '';
  let src = 'none', status = 'still_missing', url = '';
  const hasImg = poster && !/placeholder/.test(poster);
  if (hasImg) {
    url = poster;
    if (userImages[id] && userImages[id] === poster) { src = 'user'; fromUser++; }
    else if (userImages[id]) { src = 'user'; fromUser++; }
    else if (anilist[id]) { src = 'anilist'; fromAnilist++; }
    else { src = 'existing'; }
    status = 'ok';
  } else {
    stillMissing++;
  }
  out.push([id, name, type, src, status, url].join(','));
}

fs.writeFileSync(path.join(ROOT, 'reports/images-final-report.csv'), out.join('\n') + '\n');
console.log('تقرير الصور النهائي:');
console.log('  إجمالي احتاج صوراً:', needIds.length);
console.log('  من المستخدم:', fromUser);
console.log('  من AniList:', fromAnilist);
console.log('  ما زال ناقصاً:', stillMissing);
console.log('  حُفظ في reports/images-final-report.csv');
