// ============================================================================
// إعادة بناء المشتقات — سينما لايف
// ----------------------------------------------------------------------------
// يقرأ src/data/{titles,details}.json (بعد التحويل/الاستيراد) ويعيد توليد:
//   - public/data/details/shard-XX.json   (بالأسماء المُحدّثة)
//   - src/data/home.json                   (المهمة 2ب: أفلام أكثر)
//   - src/data/categories.json + public/data/cat/*.json + meta.json
//   - src/data/search-index.json + public/data/search-index.json (كل الأعمال)
//   - src/data/sitemap-index.json
//   - src/data/stats.json
// لا يلمس shards الحلقات (لا اسم داخلها) إلا إذ حُذف عمل ⇒ ننظّف المفاتيح.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PUBLIC_DATA_DIR, readJSON, writeJSON, ensureDir, shardOf } from './lib-common.mjs';

const SHARDS = 64;
const pad = (i) => String(i).padStart(2, '0');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const save = (f, o) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(o));

console.log('▶ إعادة بناء المشتقات…');
const titles = load('titles.json');
const detailsMap = load('details.json');
const idSet = new Set(Object.keys(titles));

// ---------------------------------------------------------------------------
// 1) shards التفاصيل (بالأسماء المُحدّثة) — تُقرأ في صفحات SSR
// ---------------------------------------------------------------------------
const detailShards = Array.from({ length: SHARDS }, () => ({}));
for (const id in detailsMap) {
  if (!idSet.has(id)) continue; // حُذف من titles ⇒ نتجاهله
  detailShards[shardOf(id, SHARDS)][id] = detailsMap[id];
}
const dDir = path.join(PUBLIC_DATA_DIR, 'details');
fs.rmSync(dDir, { recursive: true, force: true }); ensureDir(dDir);
for (let i = 0; i < SHARDS; i++) writeJSON(path.join(dDir, `shard-${pad(i)}.json`), detailShards[i]);
console.log('  ✔ shards التفاصيل');

// ---------------------------------------------------------------------------
// 2) تنظيف shards الحلقات من الأعمال المحذوفة (نُبقي السيرفرات كما هي)
// ---------------------------------------------------------------------------
const epDir = path.join(PUBLIC_DATA_DIR, 'episodes');
let cleaned = 0;
for (let i = 0; i < SHARDS; i++) {
  const f = path.join(epDir, `shard-${pad(i)}.json`);
  if (!fs.existsSync(f)) continue;
  const shard = JSON.parse(fs.readFileSync(f, 'utf8'));
  let changed = false;
  for (const id in shard) if (!idSet.has(id)) { delete shard[id]; changed = true; cleaned++; }
  if (changed) writeJSON(f, shard);
}
console.log(`  ✔ نظّفنا ${cleaned} عمل محذوف من shards الحلقات`);

// ---------------------------------------------------------------------------
// 3) الصفحة الرئيسية (المهمة 2ب: قسم الأفلام يشمل غير المُثراة كـ fallback)
// ---------------------------------------------------------------------------
function scorePop(t) {
  const d = detailsMap[t.id] || {};
  return (d.popularity || 0) + (d.voteCount || 0) / 100 + (d.rating || 0);
}
function hasServers(id) {
  // تقدير سريع: totalValidServers من التفاصيل
  return (detailsMap[id]?.totalValidServers || 0) > 0;
}
// بوستر حقيقي (ليس placeholder فارغ)
function hasRealPoster(t) {
  const p = t.poster;
  return !!p && !/placeholder/.test(p);
}
function buildHome() {
  const all = Object.values(titles).map((t) => ({
    ...t,
    _enriched: !!detailsMap[t.id]?.tmdbId,
    _pop: scorePop(t),
    _real: hasRealPoster(t),
  }));
  // المُثراة أولاً حسب الشعبية، ثم غير المُثراة التي لديها بوستر حقيقي
  const enriched = all.filter((t) => t._enriched && t._real).sort((a, b) => b._pop - a._pop);
  const nonEnriched = all.filter((t) => !t._enriched && t._real).sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return (b.rating || 0) - (a.rating || 0) || (b.year || 0) - (a.year || 0);
  });

  // اختيار "جيّد" للواجهة: نُفضّل الأعلى تقييماً/شعبية وله بوستر حقيقي
  const pickType = (type, n) => {
    const e = enriched.filter((t) => t.type === type);
    const ne = nonEnriched.filter((t) => t.type === type);
    return [...e, ...ne].slice(0, n).map((t) => t.id);
  };

  // اختيار "أفلام مختارة" للواجهة — أفلام قويّة/جيّدة تُمثّل واجهة الموقع:
  // بعد الإثراء من TMDB أصبح لدينا شعبية + تقييم موثوق + عدد أصوات،
  // فنختار الأقوى فعلياً (تقييم عالٍ بعدد أصوات كافٍ + شعبية) وله بوستر حقيقي.
  const pickMoviesShowcase = (n) => {
    const d = (id) => detailsMap[id] || {};
    // درجة "القوة": تقييم عالٍ بوزن كبير + عدد أصوات (ثقة) + شعبية معتدلة
    const strength = (t) => {
      const det = d(t.id);
      const rating = t.rating || 0;              // null إذا الأصوات قليلة (سياسة الحد الأدنى)
      const votes = det.voteCount || 0;
      const pop = det.popularity || 0;
      return rating * 12 + Math.min(votes, 8000) / 40 + Math.min(pop, 300) * 0.4;
    };
    // مرشّحون: أفلام مُثراة، تقييم موثوق (>=7) بعدد أصوات كافٍ (>=300)، بوستر حقيقي
    let cand = all.filter((t) =>
      t.type === 'movie' && t._real && t._enriched &&
      (t.rating || 0) >= 7 && (d(t.id).voteCount || 0) >= 300
    );
    // تخفيف تدريجي إن لم نجد ما يكفي
    if (cand.length < n) {
      cand = all.filter((t) => t.type === 'movie' && t._real && t._enriched && (d(t.id).voteCount || 0) >= 100);
    }
    if (cand.length < n) {
      cand = all.filter((t) => t.type === 'movie' && t._real && t._enriched);
    }
    let out = cand.sort((a, b) => strength(b) - strength(a)).slice(0, n);
    // تكملة نهائية لو لم نكفِ
    if (out.length < n) {
      for (const t of all) { if (out.length >= n) break; if (t.type === 'movie' && t._real && !out.includes(t)) out.push(t); }
    }
    return out.slice(0, n).map((t) => t.id);
  };

  // اختيار "أنمي مختار": أنمي قوي (تقييم موثوق) وحديث نسبياً + بوستر حقيقي.
  // نمزج الشعبية + التقييم + دفعة للحداثة، ونتجنّب القديم جداً.
  const pickAnimeShowcase = (n) => {
    const d = (id) => detailsMap[id] || {};
    const score = (t) => {
      const det = d(t.id);
      const votes = det.voteCount || 0;
      const rating = t.rating || 0;              // بعد fix-ratings: 0 إن كانت الأصوات قليلة
      const pop = det.popularity || 0;
      const recency = t.year ? Math.max(0, t.year - 2005) : 0; // دفعة للأحدث
      return pop * 0.5 + rating * 8 + Math.min(votes, 2000) / 100 + recency * 1.2;
    };
    const cand = all
      .filter((t) => t.type === 'anime' && t._real && t._enriched)
      .filter((t) => (t.year || 0) >= 2010)      // حديثة نسبياً
      .sort((a, b) => score(b) - score(a));
    let out = cand.slice(0, n);
    if (out.length < n) {
      // كمّل بأي أنمي مُثرى قوي بغض النظر عن السنة
      const extra = all.filter((t) => t.type === 'anime' && t._real && t._enriched && !out.includes(t))
        .sort((a, b) => score(b) - score(a));
      out = out.concat(extra).slice(0, n);
    }
    return out.slice(0, n).map((t) => t.id);
  };

  const trending = enriched.slice(0, 24).map((t) => t.id);
  const heroCand = enriched.find((t) => t.backdrop) || enriched[0];

  // "أحدث الأفلام" — دقّة باليوم والشهر وليس السنة فقط:
  // بعد الإثراء أصبح لدينا releaseDate (YYYY-MM-DD) من TMDB، فنرتّب تنازلياً
  // بالتاريخ الكامل ليظهر فعلاً أحدث فيلم (مثل Supergirl الصادر حديثاً).
  // نستبعد الأفلام المستقبلية (لم تُصدَر بعد) لتفادي إصدارات لم تنزل.
  const todayStr = new Date().toISOString().slice(0, 10);
  const relDate = (t) => {
    const rd = detailsMap[t.id]?.releaseDate;
    if (rd && /^\d{4}-\d{2}-\d{2}$/.test(rd)) return rd;
    // fallback: سنة فقط ⇒ نعتبرها منتصف السنة كي لا تتقدّم على تواريخ دقيقة
    return t.year ? `${t.year}-01-01` : '0000-00-00';
  };
  // نستبعد الأفلام "المجهولة تماماً" (بلا أصوات وشعبية شبه معدومة) لتفادي عناوين غريبة،
  // مع الإبقاء على الأحدث فعلاً (مثل Supergirl) الذي له شعبية/أصوات.
  const known = (t) => {
    const det = detailsMap[t.id] || {};
    return (det.voteCount || 0) >= 20 || (det.popularity || 0) >= 15;
  };
  const latestMovies = all
    .filter((t) => t.type === 'movie' && t._real && t._enriched)
    .filter((t) => relDate(t) <= todayStr)   // لا نُظهر أفلاماً لم تُصدَر بعد
    .filter(known)                            // نتجنّب الأفلام الغريبة/المجهولة
    .sort((a, b) => {
      const da = relDate(a), db = relDate(b);
      if (db !== da) return db < da ? -1 : 1;   // التاريخ الأحدث أولاً
      return b._pop - a._pop;                     // عند التساوي: الأشهر أولاً
    })
    .slice(0, 24)
    .map((t) => t.id);

  return {
    hero: heroCand ? heroCand.id : null,
    rows: [
      { title: 'الأكثر رواجاً', slug: 'trending', items: trending },
      { title: 'أفلام مختارة', slug: 'movie', items: pickMoviesShowcase(24) },
      { title: 'مسلسلات مختارة', slug: 'series', items: pickType('series', 24) },
      { title: 'أنمي مختار', slug: 'anime', items: pickAnimeShowcase(24) },
      { title: 'أحدث الأفلام', slug: 'movie', items: latestMovies },
    ].filter((r) => r.items.length),
  };
}
save('home.json', buildHome());
console.log('  ✔ home.json');

// ---------------------------------------------------------------------------
// 4) الأقسام (كل الأعمال) + ملفات cat المرقّمة
// ---------------------------------------------------------------------------
function buildCategories() {
  const all = Object.values(titles).map((t) => ({
    ...t,
    _enriched: !!detailsMap[t.id]?.tmdbId,
    popularity: detailsMap[t.id]?.popularity || 0,
    voteCount: detailsMap[t.id]?.voteCount || 0,
  })).sort((a, b) => {
    if (a._enriched !== b._enriched) return a._enriched ? -1 : 1;
    if (a._enriched) return scorePop(b) - scorePop(a);
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return (a.title || '').localeCompare(b.title || '', 'en');
  });
  const cats = {
    movie: { label: 'أفلام', type: 'movie' },
    series: { label: 'مسلسلات', type: 'series' },
    anime: { label: 'أنمي', type: 'anime' },
    trending: { label: 'الأكثر رواجاً', type: null },
  };
  const out = {};
  for (const [slug, c] of Object.entries(cats)) {
    let list = c.type ? all.filter((t) => t.type === c.type) : all.filter((t) => t._enriched).slice(0, 200);
    out[slug] = { label: c.label, type: c.type, items: list.map((t) => t.id) };
  }
  return out;
}
const categories = buildCategories();
save('categories.json', categories);

const CAT_PAGE = 60;
const catDir = path.join(PUBLIC_DATA_DIR, 'cat');
fs.rmSync(catDir, { recursive: true, force: true }); ensureDir(catDir);
const catMeta = {};
for (const slug in categories) {
  const ids = categories[slug].items;
  const cards = ids.map((id) => {
    const t = titles[id];
    return { id, type: t.type, title: t.title, titleEn: t.titleEn, year: t.year, rating: t.rating, poster: t.poster, backdrop: t.backdrop, genres: t.genres || [] };
  });
  const pages = Math.max(1, Math.ceil(cards.length / CAT_PAGE));
  for (let p = 0; p < pages; p++) {
    writeJSON(path.join(catDir, `${slug}-${p + 1}.json`), cards.slice(p * CAT_PAGE, (p + 1) * CAT_PAGE));
  }
  catMeta[slug] = { label: categories[slug].label, type: categories[slug].type, total: cards.length, pages, pageSize: CAT_PAGE };
}

// ---------------------------------------------------------------------------
// 4ب) فهرس فلترة كامل لكل قسم (خفيف) — للفلترة/الترتيب على كامل القسم في المتصفح
//     يحوي كل أعمال القسم بحقول مختصرة جداً + قائمة التصنيفات والسنوات المتاحة.
// ---------------------------------------------------------------------------
const filterMeta = {};
for (const slug in categories) {
  const ids = categories[slug].items;
  // مصفوفة مضغوطة: [id, title, titleEn, year, rating, poster, genresJoined]
  const rows = [];
  const genreCount = {};
  const yearSet = new Set();
  for (const id of ids) {
    const t = titles[id];
    const gs = (t.genres && t.genres.length ? t.genres : (detailsMap[id]?.genres || [])).slice(0, 4);
    for (const g of gs) if (g) genreCount[g] = (genreCount[g] || 0) + 1;
    if (t.year) yearSet.add(t.year);
    rows.push([id, t.title || '', t.titleEn || '', t.year || 0, t.rating || 0, t.poster || '', gs.join('|')]);
  }
  writeJSON(path.join(catDir, `index-${slug}.json`), rows);
  // التصنيفات مرتّبة حسب التكرار (الأكثر أولاً)، حتى 30
  const genres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([g]) => g);
  const years = Array.from(yearSet).filter((y) => y > 1900).sort((a, b) => b - a);
  filterMeta[slug] = { genres, years };
}
// ندمج filterMeta داخل meta.json لكل قسم
for (const slug in catMeta) {
  catMeta[slug].genres = filterMeta[slug]?.genres || [];
  catMeta[slug].years = filterMeta[slug]?.years || [];
}
writeJSON(path.join(catDir, 'meta.json'), catMeta);
console.log('  ✔ categories + cat/* + فهارس الفلترة');

// ---------------------------------------------------------------------------
// 5) فهرس البحث (المهمة 3: كل الأعمال — ليعمل البحث + المشابهة للأفلام غير المُثراة)
// ---------------------------------------------------------------------------
const searchIndex = Object.values(titles).map((t) => ({
  id: t.id,
  type: t.type,
  title: t.title,
  titleEn: t.titleEn,
  year: t.year,
  rating: t.rating,
  poster: t.poster,
  genres: (t.genres && t.genres.length ? t.genres : (detailsMap[t.id]?.genres || [])).slice(0, 4),
}));
save('search-index.json', searchIndex);
writeJSON(path.join(PUBLIC_DATA_DIR, 'search-index.json'), searchIndex);
console.log(`  ✔ search-index (${searchIndex.length} عمل — كل الأعمال)`);

// فهارس "أعمال مشابهة" مقسّمة حسب النوع — تُقرأ في صفحة العمل (SSR). كل ملف يحوي
// نوعاً واحداً فقط فلا نُحمّل الفهرس الكامل (2.5MB) في الـ Worker لكل طلب.
// نبقيها خفيفة: مُثراة أولاً (بيانات غنية) ثم عيّنة من غير المُثراة الأعلى تقييماً.
const SIM_PER_TYPE = 1200;
for (const type of ['movie', 'series', 'anime']) {
  const list = searchIndex.filter((t) => t.type === type).sort((a, b) => {
    const ae = !!detailsMap[a.id]?.tmdbId, be = !!detailsMap[b.id]?.tmdbId;
    if (ae !== be) return ae ? -1 : 1;
    return (b.rating || 0) - (a.rating || 0);
  }).slice(0, SIM_PER_TYPE);
  writeJSON(path.join(PUBLIC_DATA_DIR, `similar-${type}.json`), list);
  console.log(`  ✔ similar-${type} (${list.length})`);
}

// ---------------------------------------------------------------------------
// 6) sitemap-index + stats
// ---------------------------------------------------------------------------
const sm = [];
for (const id in titles) {
  const d = detailsMap[id];
  const enriched = !!(d && d.tmdbId);
  const pr = enriched ? ((d.popularity || 0) > 50 ? '0.9' : '0.7') : '0.5';
  sm.push([id, pr]);
}
save('sitemap-index.json', sm);

const byType = {}; let enrichedCount = 0;
for (const id in titles) {
  byType[titles[id].type] = (byType[titles[id].type] || 0) + 1;
  if (detailsMap[id]?.tmdbId) enrichedCount++;
}
save('stats.json', {
  totalTitles: Object.keys(titles).length,
  byType, enriched: enrichedCount, unready: 0, shards: SHARDS,
  generatedAt: new Date().toISOString(),
});
console.log('  ✔ sitemap + stats. الإجمالي:', Object.keys(titles).length, '| مُثرى:', enrichedCount, '| byType:', byType);
console.log('✔ تمّت إعادة البناء.');
