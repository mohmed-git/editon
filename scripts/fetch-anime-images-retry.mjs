// جولة ثانية: مطابقة أدق للـ 20 أنمي المتبقية بأسماء أبسط
import fs from 'node:fs';
const remaining = JSON.parse(fs.readFileSync('/tmp/still-missing-after-anilist.json', 'utf8'));
const OUT = '/tmp/anime-images-found.json';
const found = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERY = `query($s:String){Page(perPage:1){media(search:$s,type:ANIME,sort:SEARCH_MATCH){title{romaji english}coverImage{extraLarge large}}}}`;
async function search(name) {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { s: name } }),
    });
    if (res.status === 429) { await sleep(2500); return search(name); }
    if (!res.ok) return null;
    const j = await res.json();
    const m = j?.data?.Page?.media?.[0];
    return m?.coverImage?.extraLarge || m?.coverImage?.large || null;
  } catch { return null; }
}

// عدّة محاولات بأسماء متدرّجة البساطة
function candidates(name) {
  const c = [];
  let s = String(name);
  s = s.replace(/[’']/g, "'");
  c.push(s);
  // إزالة كل ما بعد أول : أو - أو (
  const cut = s.split(/[:\-(]/)[0].trim();
  if (cut && cut !== s) c.push(cut);
  // إزالة الحواشي والحركات
  const noDia = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (noDia !== s) c.push(noDia);
  // إزالة كلمات movie/the/season/part الشائعة
  const simple = s.replace(/\b(the\s+)?movie\s*\d*\b/gi, ' ').replace(/[:!?’']/g, ' ').replace(/\s+/g, ' ').trim();
  if (simple && !c.includes(simple)) c.push(simple);
  // إزالة السنوات والأقواس والتكرارات
  const noYear = s.replace(/\(\d{4}\)/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[:!?’'()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noYear && !c.includes(noYear)) c.push(noYear);
  // أول 3 كلمات فقط (للأسماء الطويلة جداً)
  const first3 = noYear.split(' ').slice(0, 3).join(' ');
  if (first3 && !c.includes(first3)) c.push(first3);
  return [...new Set(c)];
}

let ok = 0;
for (const a of remaining) {
  if (found[a.id]) continue;
  let img = null;
  for (const cand of candidates(a.name)) {
    img = await search(cand);
    await sleep(600);
    if (img) break;
  }
  if (img) { found[a.id] = img; ok++; console.log('✔', a.id); fs.writeFileSync(OUT, JSON.stringify(found, null, 2)); }
  else console.log('✘', a.id, '|', a.name);
}
fs.writeFileSync(OUT, JSON.stringify(found, null, 2));
console.log(`\nجولة ثانية: أضيف ${ok} | الإجمالي الآن ${Object.keys(found).length}`);
