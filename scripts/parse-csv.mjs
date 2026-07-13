// ============================================================================
// المرحلة 1: تحليل CSV → بنية JSON خام (عمل → مواسم → حلقات → سيرفرات)
// ----------------------------------------------------------------------------
// يقرأ الملف الضخم سطراً سطراً (streaming) لتجنّب استهلاك الذاكرة.
// المخرج: .import-cache/raw-catalog.json  — يُستهلك لاحقاً بواسطة enrich-tmdb.mjs
//
// كل صف CSV = (عمل + موسم + رقم حلقة + سيرفر واحد). عدة صفوف بنفس
// slug+season+episode تعني عدة سيرفرات لنفس الحلقة → نجمّعها.
// نتحقق أثناء ذلك من صلاحية رابط كل سيرفر كـ iframe.
// ============================================================================
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import {
  CSV_PATH,
  CACHE_DIR,
  parseCSVLine,
  cleanTitle,
  isValidIframeUrl,
  ensureDir,
  writeJSON,
} from './lib-common.mjs';

async function main() {
  console.log('📖 تحليل CSV:', CSV_PATH);
  if (!fs.existsSync(CSV_PATH)) {
    console.error('❌ ملف CSV غير موجود:', CSV_PATH);
    process.exit(1);
  }
  ensureDir(CACHE_DIR);

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  });

  let header = null;
  let rowCount = 0;
  let badRows = 0;
  let invalidServers = 0;

  // slug -> work
  const works = new Map();

  for await (const line of rl) {
    if (!header) {
      header = parseCSVLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const f = parseCSVLine(line);
    if (f.length < 14) {
      badRows++;
      continue;
    }
    rowCount++;
    const [
      slug, title, category, , subcategory, subcategory_label,
      is_new, year, poster, season, episode, episode_title,
      server_label, server_url,
    ] = f;

    if (!works.has(slug)) {
      const c = cleanTitle(title);
      works.set(slug, {
        slug,
        rawTitle: title,
        titleAr: c.ar,
        titleEn: c.en,
        searchName: c.searchName,
        csvYear: year ? parseInt(year, 10) || (c.year ?? null) : (c.year ?? null),
        category, // anime | movie | series
        subcategory: subcategory || null,
        subcategoryLabel: subcategory_label || null,
        isNew: is_new === '1',
        poster: poster || null,
        // seasons: { [seasonNum]: { [episodeNum]: { title, servers:[] } } }
        seasons: {},
      });
    }
    const w = works.get(slug);
    const sNum = String(parseInt(season, 10) || 0);
    const eNum = String(parseInt(episode, 10) || 0);
    if (!w.seasons[sNum]) w.seasons[sNum] = {};
    if (!w.seasons[sNum][eNum]) {
      w.seasons[sNum][eNum] = { title: episode_title || '', servers: [] };
    }
    const ep = w.seasons[sNum][eNum];
    const valid = isValidIframeUrl(server_url);
    if (!valid) invalidServers++;
    // نتجنّب تكرار نفس الرابط
    if (!ep.servers.some((s) => s.url === server_url)) {
      ep.servers.push({
        label: server_label || `سيرفر ${ep.servers.length + 1}`,
        url: server_url,
        valid,
      });
    }

    if (rowCount % 50000 === 0) {
      console.log(`  … ${rowCount} صف، ${works.size} عمل حتى الآن`);
    }
  }

  // إحصاءات لكل عمل + تحويل seasons لبنية مرتّبة
  let totalEpisodes = 0;
  let worksNoValidServer = 0;
  const catalog = [];
  for (const [, w] of works) {
    const seasonNums = Object.keys(w.seasons).map(Number).sort((a, b) => a - b);
    let epCount = 0;
    let hasValidServer = false;
    const seasonsArr = [];
    for (const sn of seasonNums) {
      const epNums = Object.keys(w.seasons[String(sn)]).map(Number).sort((a, b) => a - b);
      const episodes = [];
      for (const en of epNums) {
        const raw = w.seasons[String(sn)][String(en)];
        const validServers = raw.servers.filter((s) => s.valid);
        if (validServers.length) hasValidServer = true;
        episodes.push({
          num: en,
          csvTitle: raw.title,
          servers: raw.servers,
          validServerCount: validServers.length,
        });
        epCount++;
      }
      seasonsArr.push({ num: sn, episodes });
    }
    totalEpisodes += epCount;
    if (!hasValidServer) worksNoValidServer++;
    catalog.push({
      slug: w.slug,
      rawTitle: w.rawTitle,
      titleAr: w.titleAr,
      titleEn: w.titleEn,
      searchName: w.searchName,
      csvYear: w.csvYear,
      category: w.category,
      subcategory: w.subcategory,
      subcategoryLabel: w.subcategoryLabel,
      isNew: w.isNew,
      poster: w.poster,
      seasonCount: seasonNums.length,
      episodeCount: epCount,
      hasValidServer,
      hasPoster: !!w.poster,
      seasons: seasonsArr,
    });
  }

  const byCat = {};
  for (const c of catalog) byCat[c.category] = (byCat[c.category] || 0) + 1;

  const out = path.join(CACHE_DIR, 'raw-catalog.json');
  writeJSON(out, catalog);

  console.log('\n✅ انتهى تحليل CSV');
  console.log('  صفوف:', rowCount, '| صفوف تالفة:', badRows);
  console.log('  أعمال فريدة:', catalog.length);
  console.log('  حلقات فريدة:', totalEpisodes);
  console.log('  سيرفرات غير صالحة (iframe):', invalidServers);
  console.log('  أعمال بلا سيرفر صالح:', worksNoValidServer);
  console.log('  التوزيع:', byCat);
  console.log('  المخرج:', out, `(${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
