// ============================================================================
// المرحلة 1: قراءة catalog-ai.csv → كتالوج خام مجمّع
// franchise موحّد → مواسم → حلقات → سيرفرات (مع دمج المكرر وتنظيف العناوين)
// المخرج: .import-cache/catalog-raw.json
// ============================================================================
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { CSV_PATH, CACHE_DIR, ensureDir, writeJSON, isValidIframeUrl } from './00-config.mjs';
import { cleanTitle } from './01-title-clean.mjs';
import { buildFranchiseMap, normalizeBase } from './02-franchise-normalize.mjs';

// محلّل سطر CSV (RFC-4180: يدعم علامات الاقتباس والفواصل داخلها)
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  console.log('📖 قراءة CSV:', CSV_PATH);
  if (!fs.existsSync(CSV_PATH)) { console.error('❌ الملف غير موجود'); process.exit(1); }
  ensureDir(CACHE_DIR);

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  });

  let header = null;
  let col = {};
  let rowCount = 0;

  // المرحلة أ: نقرأ كل الصفوف لأعمال work_id (نحتاج تمريرتين منطقياً،
  // لكن نجمعهما: أولاً نبني قائمة الأعمال لحساب خريطة الـ franchise)
  // نخزّن الصفوف الخام مؤقتاً في الذاكرة كـ work_id => {meta, rows...}
  // مع 985MB RAM: نخزّن فقط ما نحتاجه (سيرفرات مضغوطة).

  const works = new Map(); // work_id => work object

  for await (const line of rl) {
    if (!header) {
      header = parseCSVLine(line.replace(/^\uFEFF/, ''));
      header.forEach((h, i) => { col[h] = i; });
      continue;
    }
    if (!line.trim()) continue;
    const f = parseCSVLine(line);
    if (f.length < 21) continue;
    rowCount++;

    const work_id = f[col.work_id];
    const franchise_key = f[col.franchise_key];
    const base_title = f[col.base_title];
    const full_title = f[col.full_title];
    const entry_type = f[col.entry_type];
    const franchise_entry_no = parseInt(f[col.franchise_entry_no], 10) || 1;
    const season_number = parseInt(f[col.season_number], 10) || 1;
    const category = f[col.category];
    const category_label = f[col.category_label];
    const subcategory = f[col.subcategory] || '';
    const subcategory_label = f[col.subcategory_label] || '';
    const is_new = f[col.is_new] === '1';
    const year = f[col.year] ? parseInt(f[col.year], 10) || null : null;
    const poster = f[col.poster] || '';
    const episode_number = parseInt(f[col.episode_number], 10) || 1;
    const episode_title = f[col.episode_title] || '';

    if (!works.has(work_id)) {
      const c = cleanTitle(full_title, base_title);
      works.set(work_id, {
        work_id,
        franchise_key,
        base_title,
        full_title,
        entry_type,
        franchise_entry_no,
        season_number,       // موسم افتراضي (قد يوجد أكثر داخل seasons)
        category,
        category_label,
        subcategory,
        subcategory_label,
        is_new,
        year: year || c.year,
        poster,
        titleEn: c.titleEn,   // الاسم اللاتيني/الشائع
        titleAr: c.titleAr,   // المُعرّب
        entryKind: c.entryKind || entry_type,
        seasons: {},          // seasonNum => { epNum => {title, servers:[{name,url}]} }
      });
    }
    const w = works.get(work_id);
    const sNum = String(season_number);
    const eNum = String(episode_number);
    if (!w.seasons[sNum]) w.seasons[sNum] = {};
    if (!w.seasons[sNum][eNum]) w.seasons[sNum][eNum] = { title: episode_title, servers: [] };
    const ep = w.seasons[sNum][eNum];

    // اجمع السيرفرات (لحد 24)
    for (let s = 1; s <= 24; s++) {
      const lc = col[`server_${s}_label`];
      const uc = col[`server_${s}_url`];
      if (lc == null || uc == null) break;
      const url = f[uc];
      if (!isValidIframeUrl(url)) continue;
      if (ep.servers.some((x) => x.url === url)) continue;
      ep.servers.push({ name: f[lc] || `سيرفر ${ep.servers.length + 1}`, url });
    }

    if (rowCount % 20000 === 0) console.log(`  … ${rowCount} صف، ${works.size} عمل`);
  }

  console.log(`✅ قُرئ ${rowCount} صف، ${works.size} عمل فريد`);

  // ---- بناء خريطة دمج الـ franchise ----
  const worksArr = [...works.values()];
  const fmap = buildFranchiseMap(worksArr);
  let merged = 0;
  for (const w of worksArr) {
    const canon = fmap.get(w.franchise_key);
    if (canon && canon !== w.franchise_key) { w.franchise_key = canon; merged++; }
  }
  console.log(`🔗 دُمجت ${merged} أعمال في franchises موحّدة`);

  // ---- إحصاءات ----
  const franchises = new Set(worksArr.map((w) => w.franchise_key));
  console.log(`📦 عدد الـ franchises بعد الدمج: ${franchises.size}`);

  // احفظ الكتالوج الخام
  const out = worksArr.map((w) => {
    // حوّل seasons لبنية مرتّبة
    const seasonNums = Object.keys(w.seasons).map(Number).sort((a, b) => a - b);
    let epCount = 0;
    const seasons = seasonNums.map((sn) => {
      const epNums = Object.keys(w.seasons[String(sn)]).map(Number).sort((a, b) => a - b);
      const episodes = epNums.map((en) => {
        const r = w.seasons[String(sn)][String(en)];
        epCount++;
        return { num: en, title: r.title, servers: r.servers };
      });
      return { num: sn, episodes };
    });
    return {
      work_id: w.work_id,
      franchise_key: w.franchise_key,
      full_title: w.full_title,
      base_title: w.base_title,
      titleEn: w.titleEn,
      titleAr: w.titleAr,
      entry_type: w.entry_type,
      entryKind: w.entryKind,
      franchise_entry_no: w.franchise_entry_no,
      season_number: w.season_number,
      category: w.category,
      category_label: w.category_label,
      subcategory: w.subcategory,
      subcategory_label: w.subcategory_label,
      is_new: w.is_new,
      year: w.year,
      poster: w.poster,
      seasons,
      episodeCount: epCount,
      seasonCount: seasons.length,
    };
  });

  writeJSON(path.join(CACHE_DIR, 'catalog-raw.json'), out);
  console.log(`💾 حُفظ catalog-raw.json (${out.length} عمل)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
