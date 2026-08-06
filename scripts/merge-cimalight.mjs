// ============================================================================
// دمج سيرفرات cimalight الجديدة — سينما لايف (الدفعة 24)
// ----------------------------------------------------------------------------
// يقرأ ملفين مرفوعين:
//   1) الأفلام:   result.csv
//        col1 = اسم الفيلم | col2..5 تُتجاهل | col6..18 = روابط سيرفرات
//   2) المسلسلات: series_with_servers_all (1).csv
//        col1 = اسم المسلسل | col2 = موسم | col3 = حلقة | col4,5 تُتجاهل
//        col6 = عنوان الحلقة | col7..27 = روابط سيرفرات
//
// المنطق:
//   - طابِق كل عمل باسمه (عربي/إنجليزي) مع مراعاة النوع والسنة (matchWork).
//   - موجود  → أضف السيرفرات الجديدة بين سيرفرات الحلقة/الفيلم (بلا تكرار url).
//   - غير موجود → سجّله في reports/new-works-<src>.csv (يُنشأ ويُثرى لاحقاً بـ TMDB).
//
// لا يستدعي أي API. يعمل بالكامل على البيانات المحلية.
// ملاحظة: يرفع حد السيرفرات لكل حلقة إلى MAX_SERVERS (افتراضي 20) لاستيعاب
//         سيرفراتك الجديدة فوق الموجودة.
//
// USAGE:
//   node scripts/merge-cimalight.mjs movies   # الأفلام (result.csv)
//   node scripts/merge-cimalight.mjs series   # المسلسلات
//   node scripts/merge-cimalight.mjs both     # الاثنان بالتتابع
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { parseCSVLine, isValidIframeUrl, shardOf, ensureDir } from './lib-common.mjs';
import { buildMatchIndex, matchWork, extractWorkName, detectType, normKey, isJunkWorkName } from './lib-match.mjs';

const MODE = process.argv[2] || 'both';
if (!['movies', 'series', 'both'].includes(MODE)) {
  console.error('Usage: node scripts/merge-cimalight.mjs <movies|series|both>');
  process.exit(1);
}

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'src', 'data');
const EP_DIR = path.join(ROOT, 'public', 'data', 'episodes');
const REPORTS = path.join(ROOT, 'reports');
ensureDir(REPORTS);

const MOVIES_CSV = '/home/user/uploaded_files/result.csv';
const SERIES_CSV = '/home/user/uploaded_files/series_with_servers_all (1).csv';
const MAX_SERVERS = parseInt(process.env.MAX_SERVERS || '20', 10);
const pad = (i) => String(i).padStart(2, '0');

// ---- تحميل البيانات (مرة واحدة) ----
console.log('▶ تحميل titles/details…');
const titles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'titles.json'), 'utf8'));
const details = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'details.json'), 'utf8'));
const index = buildMatchIndex(titles, details);

// shards الحلقات في الذاكرة
const epShards = {};
function loadShard(sh) {
  if (epShards[sh] != null) return epShards[sh];
  const f = path.join(EP_DIR, `shard-${pad(sh)}.json`);
  epShards[sh] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  return epShards[sh];
}

const touchedShards = new Set();
const touchedIds = new Set();

// مطابقة قوية: تجرّب الاسم كما هو، ثم منزوع السنة (السنة داخل الاسم تكسر المطابقة).
// تُعيد نفس شكل matchWork ({id, ambiguous, count}) أو null.
function matchWorkSmart(name, opts = {}) {
  let m = matchWork(index, titles, name, opts);
  if (m) return m;
  // انزع أي سنة (19xx/20xx) من الاسم وأعد المحاولة
  const noYear = name.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (noYear !== name) {
    m = matchWork(index, titles, noYear, opts);
    if (m) return m;
  }
  return null;
}

// إحصاءات إجمالية
const stat = {
  movies: { rows: 0, matched: 0, ambiguous: 0, notFound: 0, addedServers: 0 },
  series: { rows: 0, matched: 0, ambiguous: 0, notFound: 0, addedServers: 0 },
};
const newWorks = { movies: [], series: [] };
// الأعمال الجديدة كاملة بسيرفراتها — لإنشائها وإثرائها لاحقاً
// key = normKey(name)+'|'+type  →  { name, rawName, type, year, seasons: { [s]: { [ep]: {title, servers:[url]} } } }
const newWorksFull = new Map();
function recordNewWork(name, rawName, type, year, season, episode, epTitle, servers) {
  const key = normKey(name) + '|' + type;
  let w = newWorksFull.get(key);
  if (!w) { w = { name, rawName, type, year: year || null, seasons: {} }; newWorksFull.set(key, w); }
  if (!w.year && year) w.year = year;
  const sk = String(season);
  if (!w.seasons[sk]) w.seasons[sk] = {};
  const ek = String(episode);
  if (!w.seasons[sk][ek]) w.seasons[sk][ek] = { title: epTitle || '', servers: [] };
  const set = new Set(w.seasons[sk][ek].servers);
  for (const u of servers) if (!set.has(u)) { w.seasons[sk][ek].servers.push(u); set.add(u); }
}

// يضيف مصفوفة سيرفرات إلى حلقة (موسم/رقم) لعمل مطابق، دون تكرار url، حتى MAX_SERVERS
function addServersToEpisode(id, seasonNum, epNum, servers, epTitle) {
  const sh = shardOf(id);
  const shard = loadShard(sh);
  touchedShards.add(sh);
  touchedIds.add(id);
  if (!shard[id]) shard[id] = {};
  const bySeason = shard[id];
  const key = String(seasonNum);
  if (!bySeason[key]) bySeason[key] = [];
  const epArr = bySeason[key];
  let ep = epArr.find((e) => e.num === epNum);
  if (!ep) {
    ep = { num: epNum, name: epTitle || `الحلقة ${epNum}`, synopsis: '', rating: null, voteCount: 0, ratingSource: null, still: null, airDate: null, servers: [] };
    epArr.push(ep);
    epArr.sort((a, b) => a.num - b.num);
  }
  const existing = new Set(ep.servers.map((s) => s.url));
  let added = 0;
  for (const url of servers) {
    if (existing.has(url)) continue;
    if (ep.servers.length >= MAX_SERVERS) break;
    ep.servers.push({ id: ep.servers.length + 1, name: `سيرفر ${ep.servers.length + 1}`, url });
    existing.add(url);
    added++;
  }
  return added;
}

// إعادة ترقيم أسماء السيرفرات وترتيب ids بعد الدمج (تنظيف)
function renumberServers(id) {
  const sh = shardOf(id);
  const shard = epShards[sh];
  if (!shard || !shard[id]) return;
  for (const arr of Object.values(shard[id])) {
    for (const ep of arr) {
      ep.servers.forEach((s, i) => { s.id = i + 1; s.name = `سيرفر ${i + 1}`; });
    }
  }
}

// ---------------- الأفلام ----------------
function processMovies() {
  console.log('▶ معالجة الأفلام (result.csv)…');
  const lines = fs.readFileSync(MOVIES_CSV, 'utf8').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCSVLine(lines[i]);
    const rawName = (c[0] || '').trim();
    if (!rawName) continue;
    stat.movies.rows++;
    // سيرفرات: col6..18  (index 5..17)
    const servers = [];
    for (let j = 5; j <= 17; j++) {
      const u = (c[j] || '').trim();
      if (u && isValidIframeUrl(u)) servers.push(u);
    }
    if (!servers.length) continue;
    if (isJunkWorkName(rawName)) continue;
    const ym = rawName.match(/(19|20)\d{2}/);
    const year = ym ? parseInt(ym[0], 10) : null;
    // الأفلام غالباً type=movie
    const m = matchWorkSmart(rawName, { type: 'movie', year });
    if (m) {
      stat.movies.matched++;
      if (m.ambiguous) stat.movies.ambiguous++;
      // الفيلم مخزّن كـ season "1" / episode num=1
      stat.movies.addedServers += addServersToEpisode(m.id, 1, 1, servers, null);
    } else {
      stat.movies.notFound++;
      const nm = extractWorkName(rawName);
      newWorks.movies.push({ name: nm, rawName, year: year || '', servers: servers.length });
      recordNewWork(nm, rawName, 'movie', year, 1, 1, null, servers);
    }
  }
}

// ---------------- المسلسلات ----------------
function processSeries() {
  console.log('▶ معالجة المسلسلات…');
  const lines = fs.readFileSync(SERIES_CSV, 'utf8').split(/\r?\n/);
  // نتتبّع الأعمال غير الموجودة مرة واحدة لكل مسلسل
  const notFoundSeen = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCSVLine(lines[i]);
    const rawName = (c[0] || '').trim();
    if (!rawName) continue;
    stat.series.rows++;
    const season = parseInt(c[1] || '1', 10) || 1;
    const episode = parseInt(c[2] || '1', 10) || 1;
    const epTitle = (c[5] || '').trim();
    // سيرفرات: col7..27  (index 6..26)
    const servers = [];
    for (let j = 6; j <= 26; j++) {
      const u = (c[j] || '').trim();
      if (u && isValidIframeUrl(u)) servers.push(u);
    }
    if (!servers.length) continue;
    if (isJunkWorkName(rawName)) continue;
    // النوع: قد يكون انمي أو مسلسل — نكتشفه من الاسم، ونجرّب النوعين عند المطابقة
    const detected = detectType(rawName); // anime | series | movie | null
    let m = null;
    for (const t of [detected, 'anime', 'series'].filter((v, k, a) => v && a.indexOf(v) === k)) {
      m = matchWorkSmart(rawName, { type: t });
      if (m) break;
    }
    if (!m) m = matchWorkSmart(rawName, {}); // بلا قيد نوع كملاذ أخير
    if (m) {
      stat.series.matched++;
      if (m.ambiguous) stat.series.ambiguous++;
      stat.series.addedServers += addServersToEpisode(m.id, season, episode, servers, epTitle);
    } else {
      const nm = extractWorkName(rawName);
      const type = detected || 'series';
      recordNewWork(nm, rawName, type, null, season, episode, epTitle, servers);
      const key = normKey(nm);
      if (!notFoundSeen.has(key)) {
        notFoundSeen.add(key);
        stat.series.notFound++;
        newWorks.series.push({ name: nm, rawName, type });
      }
    }
  }
}

// ---- التشغيل ----
if (MODE === 'movies' || MODE === 'both') processMovies();
if (MODE === 'series' || MODE === 'both') processSeries();

// إعادة ترقيم السيرفرات وتحديث totalValidServers
for (const id of touchedIds) {
  renumberServers(id);
  const sh = shardOf(id);
  const shard = epShards[sh];
  if (!shard || !shard[id]) continue;
  let total = 0;
  for (const arr of Object.values(shard[id])) for (const ep of arr) total += ep.servers.length;
  if (details[id]) details[id].totalValidServers = total;
}

// ---- كتابة الـ shards المعدّلة فقط ----
for (const sh of touchedShards) {
  fs.writeFileSync(path.join(EP_DIR, `shard-${pad(sh)}.json`), JSON.stringify(epShards[sh]));
}
fs.writeFileSync(path.join(DATA_DIR, 'details.json'), JSON.stringify(details));

// ---- تقارير الأعمال غير الموجودة ----
function writeNewReport(kind, arr) {
  const out = ['name,rawName,type_or_year,servers'];
  for (const n of arr) out.push(`"${(n.name || '').replace(/"/g, '""')}","${(n.rawName || '').replace(/"/g, '""')}","${n.type || n.year || ''}","${n.servers || ''}"`);
  fs.writeFileSync(path.join(REPORTS, `new-works-${kind}.csv`), out.join('\n'));
}
writeNewReport('movies', newWorks.movies);
writeNewReport('series', newWorks.series);

// ملف الأعمال الجديدة الكامل (بسيرفراتها) — يُستهلك في سكربت الإنشاء/الإثراء
fs.writeFileSync(path.join(REPORTS, 'new-works-full.json'), JSON.stringify([...newWorksFull.values()]));
console.log(`أعمال جديدة كاملة محفوظة: ${newWorksFull.size} → reports/new-works-full.json`);

// ---- الملخص ----
console.log('\n════════ ملخص الدمج ════════');
if (MODE === 'movies' || MODE === 'both') {
  const s = stat.movies;
  console.log(`أفلام:   صفوف=${s.rows} | مطابق=${s.matched} (غامض=${s.ambiguous}) | غير موجود=${s.notFound} | سيرفرات مُضافة=${s.addedServers}`);
}
if (MODE === 'series' || MODE === 'both') {
  const s = stat.series;
  console.log(`مسلسلات: صفوف=${s.rows} | مطابق=${s.matched} (غامض=${s.ambiguous}) | مسلسلات غير موجودة=${s.notFound} | سيرفرات مُضافة=${s.addedServers}`);
}
console.log(`shards معدّلة: ${touchedShards.size} | أعمال ملموسة: ${touchedIds.size}`);
console.log(`تقارير: reports/new-works-movies.csv , reports/new-works-series.csv`);
