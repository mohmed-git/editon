// ============================================================================
// دمج السيرفرات من ملفات الاستيراد — سينما لايف (المهام 4 و5)
// ----------------------------------------------------------------------------
// USAGE:
//   node scripts/merge-servers.mjs topcinemaa   # المهمة 4
//   node scripts/merge-servers.mjs witanime     # المهمة 5
//
// المنطق:
//  1) اقرأ الأعمدة المفيدة فقط حسب الملف.
//  2) طابق كل صف باسم عمل موجود (بالإنجليزي/العربي) مع مراعاة النوع.
//  3) إن وُجد: أضف السيرفرات (حتى 10) إلى الحلقة (موسم/رقم) في shard الحلقات،
//     دون تكرار url، ومع احترام حظر الأعمال الممنوعة.
//  4) إن لم يوجد: أنشئ العمل (titles+details+حلقاته) — ما لم يكن محظوراً.
//  5) الأعمال بلا صورة تُسجّل في reports/needs-images-<src>.csv.
// لا يستدعي أي API. يعمل بالكامل على البيانات المحلية.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { parseCSVLine, isValidIframeUrl, shardOf, ensureDir } from './lib-common.mjs';
import { buildMatchIndex, matchWork, extractWorkName, detectType, normKey, isJunkWorkName } from './lib-match.mjs';
import { isBlockedName } from './blocklist.mjs';

const SRC = process.argv[2];
if (!['topcinemaa', 'witanime'].includes(SRC)) {
  console.error('Usage: node scripts/merge-servers.mjs <topcinemaa|witanime>');
  process.exit(1);
}
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data');
const EP_DIR = path.join(ROOT, 'public', 'data', 'episodes');
const REPORTS = path.join(ROOT, 'reports');
ensureDir(REPORTS);
const CSV_PATH = SRC === 'topcinemaa'
  ? '/home/user/uploaded_files/topcinemaa_final.csv'
  : '/home/user/uploaded_files/witanime_full.csv';
const SHARDS = 64;
const pad = (i) => String(i).padStart(2, '0');

// ---- تحميل البيانات ----
console.log(`▶ [${SRC}] تحميل البيانات…`);
const titles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'titles.json'), 'utf8'));
const details = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'details.json'), 'utf8'));
const index = buildMatchIndex(titles, details);

// ---- تحميل shards الحلقات في الذاكرة (لإضافة السيرفرات) ----
const epShards = {}; // shardNum -> object
function loadShard(sh) {
  if (epShards[sh] != null) return epShards[sh];
  const f = path.join(EP_DIR, `shard-${pad(sh)}.json`);
  epShards[sh] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  return epShards[sh];
}

// ---- تجميع صفوف CSV حسب العمل ----
const lines = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/);
const header = parseCSVLine(lines[0]);
const H = {}; header.forEach((c, i) => (H[c] = i));

// يستخرج {name, type, year, season, episode, servers[], poster} من صف
function parseRow(cells) {
  if (SRC === 'topcinemaa') {
    const rawName = cells[H.category] || cells[H.clean_title] || '';
    const type = detectType(rawName) || detectType(cells[H.clean_title]) || 'series';
    const season = parseInt(cells[H.season] || '1', 10) || 1;
    const episode = parseInt(cells[H.episode] || '1', 10) || 1;
    const poster = (cells[H.poster] || '').trim();
    const servers = [];
    for (let i = 1; i <= 10; i++) {
      const u = (cells[H['server' + i]] || '').trim();
      if (u && isValidIframeUrl(u)) servers.push({ name: `سيرفر ${servers.length + 1}`, url: u });
    }
    const ym = rawName.match(/(19|20)\d{2}/);
    return { rawName, type, year: ym ? parseInt(ym[0]) : null, season, episode, servers, poster };
  }
  // witanime
  const rawName = cells[H.anime_title] || '';
  const type = 'anime';
  const season = parseInt(cells[H.season] || '1', 10) || 1;
  const episode = parseInt(cells[H.episode] || '1', 10) || 1;
  const poster = (cells[H.poster] || '').trim();
  const genresRaw = (cells[H.genres] || '').trim();
  const servers = [];
  for (let i = 1; i <= 10; i++) {
    const u = (cells[H['server' + i + '_url']] || '').trim();
    const nm = (cells[H['server' + i + '_name']] || '').trim();
    if (u && isValidIframeUrl(u)) servers.push({ name: nm || `سيرفر ${servers.length + 1}`, url: u });
  }
  return { rawName, type, year: null, season, episode, servers, poster, genresRaw, status: cells[H.status] || '' };
}

// نجمّع: workKey -> { rawName, type, poster, genresRaw, episodes: Map(season -> Map(ep -> servers[])) }
const works = new Map();
let rowCount = 0, blockedRows = 0;
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cells = parseCSVLine(lines[i]);
  const r = parseRow(cells);
  if (!r.rawName) continue;
  rowCount++;
  const workName = extractWorkName(r.rawName);
  if (isBlockedName(workName) || isBlockedName(r.rawName)) { blockedRows++; continue; }
  if (isJunkWorkName(r.rawName)) { blockedRows++; continue; } // صفحات تصنيف من المصدر
  const key = normKey(workName) + '|' + r.type;
  let w = works.get(key);
  if (!w) { w = { rawName: r.rawName, name: workName, type: r.type, year: r.year, poster: r.poster, genresRaw: r.genresRaw, seasons: new Map() }; works.set(key, w); }
  if (!w.poster && r.poster) w.poster = r.poster;
  if (r.year && !w.year) w.year = r.year;
  let sMap = w.seasons.get(r.season);
  if (!sMap) { sMap = new Map(); w.seasons.set(r.season, sMap); }
  const prev = sMap.get(r.episode) || [];
  sMap.set(r.episode, prev.concat(r.servers));
}
console.log(`  صفوف: ${rowCount} | أعمال فريدة: ${works.size} | صفوف محظورة تُجوهلت: ${blockedRows}`);

// ---- مساعد: توليد id فريد لعمل جديد ----
function slugify(name, year) {
  const base = normKey(name).replace(/\s+/g, '-').slice(0, 80) || 'work';
  let id = year ? `${base}-${year}` : base;
  let n = 2;
  while (titles[id]) { id = `${base}-${year || ''}-${n++}`.replace(/--+/g, '-'); }
  return id;
}

// ---- الدمج ----
let addedServers = 0, matchedWorks = 0, createdWorks = 0, ambiguousWorks = 0;
const touchedShards = new Set();
const needImages = []; // أعمال جديدة بلا صورة صالحة
const createdList = [];
const touchedIds = new Set(); // كل الأعمال التي مسّناها (لتحديث totalValidServers)

for (const [key, w] of works) {
  const m = matchWork(index, titles, w.rawName, { type: w.type, year: w.year });
  let id;
  if (m) {
    id = m.id;
    matchedWorks++;
    if (m.ambiguous) ambiguousWorks++;
  } else {
    // إنشاء عمل جديد
    id = slugify(w.name, w.year);
    const poster = (w.poster && /^https?:\/\//.test(w.poster)) ? w.poster : '';
    const genres = w.genresRaw ? w.genresRaw.split(/[,،|]/).map((g) => g.trim()).filter(Boolean).slice(0, 6) : [];
    const isAnime = w.type === 'anime';
    const isMovie = w.type === 'movie';
    titles[id] = {
      id, type: w.type, title: w.name, titleEn: w.name, year: w.year || null,
      rating: null, poster: poster || '/static/placeholder-poster.svg', backdrop: null,
      genres, isNew: true,
    };
    const seasonNums = [...w.seasons.keys()].sort((a, b) => a - b);
    let epCount = 0; for (const s of w.seasons.values()) epCount += s.size;
    details[id] = {
      id, type: w.type, tmdbId: null, title: w.name, titleEn: w.name, originalTitle: w.name,
      year: w.year || null, rating: null, voteCount: 0, ratingSource: null,
      poster: poster || '/static/placeholder-poster.svg', tmdbPoster: null, backdrop: null,
      genres, country: '', synopsis: '', tagline: '', runtime: null, cast: [], creators: [],
      quality: 'HD', language: 'مترجم',
      seasonCount: seasonNums.length, episodeCount: epCount, totalValidServers: 0,
      numberOfSeasons: isMovie ? null : seasonNums.length, numberOfEpisodes: isMovie ? null : epCount,
      popularity: 0, ready: !!poster,
      seasons: seasonNums.map((n) => ({ num: n, episodes: w.seasons.get(n).size })),
    };
    // أضِف للفهرس حتى لا يُنشأ مكرر لاحقاً في نفس التشغيل
    const k = normKey(w.name);
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(id);
    createdWorks++;
    createdList.push({ id, name: w.name, type: w.type, year: w.year || '' });
    if (!poster) needImages.push({ id, name: w.name, type: w.type, year: w.year || '' });
  }

  touchedIds.add(id);
  // أضف السيرفرات إلى shard الحلقات
  const sh = shardOf(id, SHARDS);
  const shard = loadShard(sh);
  touchedShards.add(sh);
  if (!shard[id]) shard[id] = {};
  const bySeason = shard[id];
  for (const [seasonNum, epMap] of w.seasons) {
    const key2 = String(seasonNum);
    if (!bySeason[key2]) bySeason[key2] = [];
    const epArr = bySeason[key2];
    for (const [epNum, servers] of epMap) {
      let ep = epArr.find((e) => e.num === epNum);
      if (!ep) {
        ep = { num: epNum, name: `الحلقة ${epNum}`, synopsis: '', rating: null, voteCount: 0, ratingSource: null, still: null, airDate: null, servers: [] };
        epArr.push(ep);
      }
      const existingUrls = new Set(ep.servers.map((s) => s.url));
      for (const sv of servers) {
        if (existingUrls.has(sv.url)) continue;
        if (ep.servers.length >= 10) break; // احترام حد 10 سيرفرات
        ep.servers.push({ id: `s${ep.servers.length + 1}`, name: sv.name, url: sv.url });
        existingUrls.add(sv.url);
        addedServers++;
      }
    }
    epArr.sort((a, b) => a.num - b.num);
  }
}

// ---- تحديث totalValidServers في details للأعمال المُنشأة/المُعدّلة ----
for (const id of touchedIds) {
  const sh = shardOf(id, SHARDS);
  const shard = epShards[sh];
  if (!shard || !shard[id]) continue;
  let total = 0;
  for (const seasonArr of Object.values(shard[id])) for (const ep of seasonArr) total += ep.servers.length;
  if (details[id]) details[id].totalValidServers = total;
}

// ---- كتابة النتائج ----
for (const sh of touchedShards) {
  fs.writeFileSync(path.join(EP_DIR, `shard-${pad(sh)}.json`), JSON.stringify(epShards[sh]));
}
fs.writeFileSync(path.join(DATA_DIR, 'titles.json'), JSON.stringify(titles));
fs.writeFileSync(path.join(DATA_DIR, 'details.json'), JSON.stringify(details));

// تقرير الصور الناقصة
const csvOut = ['id,name,type,year'];
for (const n of needImages) csvOut.push(`${n.id},"${n.name.replace(/"/g, '""')}",${n.type},${n.year}`);
fs.writeFileSync(path.join(REPORTS, `needs-images-${SRC}.csv`), csvOut.join('\n'));

console.log(`✔ [${SRC}] اكتمل:`);
console.log(`   مطابق (أُضيفت سيرفرات): ${matchedWorks} | غامض التطابق: ${ambiguousWorks}`);
console.log(`   جديد (أُنشئ): ${createdWorks} | سيرفرات مُضافة: ${addedServers}`);
console.log(`   أعمال بلا صورة (needs-images-${SRC}.csv): ${needImages.length}`);
console.log(`   إجمالي الأعمال الآن: ${Object.keys(titles).length}`);
