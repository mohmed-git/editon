// ============================================================================
// fetch-anime-images.mjs — جلب بوسترات الأنمي الناقصة من AniList (مجاني بلا مفتاح)
// يقرأ /tmp/still-no-img.json (أعمال بلا صورة) ويبحث بالاسم الروماجي.
// يكتب النتائج في /tmp/anime-images-found.json ثم يُطبّقها على titles/details.
// ============================================================================
import fs from 'node:fs';

const list = JSON.parse(fs.readFileSync('/tmp/still-no-img.json', 'utf8'));
const anime = list.filter((x) => x.type === 'anime');
console.log('أنمي بلا صورة:', anime.length);

// تنظيف اسم البحث: نزيل مؤشرات المواسم/الأجزاء واللواحق لتحسين المطابقة
function cleanSearch(name) {
  let s = String(name || '');
  s = s.replace(/\(\d{4}\)/g, ' ');
  s = s.replace(/\b(\d+(st|nd|rd|th))\s+season\b/gi, ' ');
  s = s.replace(/\bseason\s*\d+\b/gi, ' ');
  s = s.replace(/\bpart\s*\d+\b/gi, ' ');
  s = s.replace(/\b(2nd|3rd|4th)\b/gi, ' ');
  s = s.replace(/[:!?]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const QUERY = `query($s:String){
  Page(perPage:1){ media(search:$s, type:ANIME, sort:SEARCH_MATCH){
    title{ romaji english } coverImage{ extraLarge large } }}}`;

async function search(name) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { s: name } }),
    });
    if (res.status === 429) { await sleep(2000); return search(name); }
    if (!res.ok) return null;
    const j = await res.json();
    const m = j?.data?.Page?.media?.[0];
    if (!m) return null;
    const img = m.coverImage?.extraLarge || m.coverImage?.large;
    return img || null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUT = '/tmp/anime-images-found.json';
// استئناف: حمّل ما وُجد سابقاً
const found = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
let ok = Object.keys(found).length, fail = 0;
for (let i = 0; i < anime.length; i++) {
  const a = anime[i];
  if (found[a.id]) continue; // مُنجز سابقاً
  let img = await search(cleanSearch(a.name));
  if (!img && cleanSearch(a.name) !== a.name) img = await search(a.name); // محاولة بالاسم الكامل
  if (img) { found[a.id] = img; ok++; }
  else fail++;
  if ((i + 1) % 20 === 0) { console.log(`  ${i + 1}/${anime.length} — وُجد: ${ok} | فشل: ${fail}`); fs.writeFileSync(OUT, JSON.stringify(found, null, 2)); }
  await sleep(500); // لطيف على AniList
}
fs.writeFileSync('/tmp/anime-images-found.json', JSON.stringify(found, null, 2));
console.log(`\n✔ اكتمل. وُجدت صور لـ ${ok} أنمي | تعذّر ${fail}. حُفظ في /tmp/anime-images-found.json`);
