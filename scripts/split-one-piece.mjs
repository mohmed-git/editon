// ============================================================================
// فصل One Piece: مسلسل حيّ (live-action) + أنمي بدون مواسم
// ----------------------------------------------------------------------------
// الوضع الحالي (one-piece-2, type=anime):
//   - S1: 1167 حلقة → أول 8 = المسلسل الحيّ (أسماء حقيقية، 10 سيرفرات)، 9+ = أنمي
//   - S2: 23 حلقة   → أول 8 = المسلسل الحيّ م2 (8 سيرفرات)، 63+ = أنمي
//   - S3..S22: كلها أنمي
//
// المطلوب:
//   1) عمل جديد "one-piece-live" (type=series): م1 = أول 8 من S1، م2 = أول 8 من S2
//   2) "one-piece-2" يبقى أنمي لكن بدون مواسم: تُدمج كل حلقات الأنمي في تسلسل
//      واحد (season 1) ويُعاد ترقيمها 1..N (الحلقة 9 من S1 تصبح الحلقة 1).
// ============================================================================
import fs from 'fs';
import { shardOf } from './lib-common.mjs';

const SHARDS = 64;
const ANIME_ID = 'one-piece-2';
const LIVE_ID = 'one-piece-live';

const titles = JSON.parse(fs.readFileSync('src/data/titles.json', 'utf8'));
const details = JSON.parse(fs.readFileSync('src/data/details.json', 'utf8'));

// نسخ احتياطية
fs.writeFileSync('/tmp/titles.before-onepiece.json', JSON.stringify(titles));
fs.writeFileSync('/tmp/details.before-onepiece.json', JSON.stringify(details));

const animeShardPath = `public/data/episodes/shard-${shardOf(ANIME_ID, SHARDS)}.json`;
const liveShardNum = shardOf(LIVE_ID, SHARDS);
const liveShardPath = `public/data/episodes/shard-${liveShardNum}.json`;

const animeShard = JSON.parse(fs.readFileSync(animeShardPath, 'utf8'));
fs.writeFileSync('/tmp/episodes-anime-shard.before-onepiece.json', JSON.stringify(animeShard));

const eps = animeShard[ANIME_ID];
if (!eps) throw new Error(`لا توجد حلقات لـ ${ANIME_ID} في ${animeShardPath}`);

const seasonNums = Object.keys(eps).map(Number).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// 1) استخراج حلقات المسلسل الحيّ: أول 8 من S1 و أول 8 من S2
// ---------------------------------------------------------------------------
const liveS1 = (eps['1'] || []).filter((ep) => ep.num >= 1 && ep.num <= 8)
  .map((ep) => ({ ...ep }));
const liveS2 = (eps['2'] || []).filter((ep) => ep.num >= 1 && ep.num <= 8)
  .map((ep) => ({ ...ep }));

console.log(`مسلسل حيّ: م1 = ${liveS1.length} حلقة، م2 = ${liveS2.length} حلقة`);

// ---------------------------------------------------------------------------
// 2) استخراج حلقات الأنمي ودمجها في تسلسل واحد بترتيب زمني وإعادة ترقيم 1..N
//    الترتيب: S1(num>=9) ثم S2(num>8) ثم S3..S22 كاملة، ثم renumber.
// ---------------------------------------------------------------------------
const animeEpisodes = [];
for (const s of seasonNums) {
  const arr = eps[String(s)] || [];
  for (const ep of arr) {
    if (s === 1 && ep.num < 9) continue;      // أول 8 من S1 = مسلسل حيّ
    if (s === 2 && ep.num <= 8) continue;     // أول 8 من S2 = مسلسل حيّ
    animeEpisodes.push(ep);
  }
}
// إعادة الترقيم 1..N (الحفاظ على الترتيب الحالي = زمني)
const renumbered = animeEpisodes.map((ep, i) => ({ ...ep, num: i + 1 }));
console.log(`أنمي: إجمالي ${renumbered.length} حلقة (بدون مواسم، season=1)`);

// ---------------------------------------------------------------------------
// 3) كتابة حلقات الأنمي الجديدة (season واحد فقط) في shard الأنمي
// ---------------------------------------------------------------------------
animeShard[ANIME_ID] = { '1': renumbered };
fs.writeFileSync(animeShardPath, JSON.stringify(animeShard));
console.log(`✔ حُدِّث ${animeShardPath} — one-piece-2 أصبح موسماً واحداً بـ ${renumbered.length} حلقة`);

// ---------------------------------------------------------------------------
// 4) كتابة حلقات المسلسل الحيّ في shard المسلسل (قد يكون نفس الملف أو ملف آخر)
// ---------------------------------------------------------------------------
let liveShard;
if (liveShardNum === shardOf(ANIME_ID, SHARDS)) {
  liveShard = animeShard; // نفس الملف
} else {
  liveShard = fs.existsSync(liveShardPath)
    ? JSON.parse(fs.readFileSync(liveShardPath, 'utf8'))
    : {};
  fs.writeFileSync('/tmp/episodes-live-shard.before-onepiece.json', JSON.stringify(liveShard));
}
liveShard[LIVE_ID] = {
  '1': liveS1.map((ep, i) => ({ ...ep, num: i + 1 })),
  '2': liveS2.map((ep, i) => ({ ...ep, num: i + 1 })),
};
fs.writeFileSync(liveShardPath, JSON.stringify(liveShard));
console.log(`✔ حُدِّث ${liveShardPath} — one-piece-live (م1=${liveS1.length}, م2=${liveS2.length})`);

// ---------------------------------------------------------------------------
// 5) تحديث titles.json / details.json
// ---------------------------------------------------------------------------
const animeTitle = titles[ANIME_ID];
const animeDetail = details[ANIME_ID];

// 5أ) الأنمي: تحديث العنوان (إزالة "التمثيلية")، seasons موسم واحد
titles[ANIME_ID] = {
  ...animeTitle,
  title: 'One Piece',
  titleEn: 'ون بيس',
  // البوستر الحالي (TMDB) مقبول للأنمي؛ نُبقيه
};
details[ANIME_ID] = {
  ...animeDetail,
  title: 'One Piece',
  titleEn: 'ون بيس',
  type: 'anime',
  synopsis: 'انطلق القرصان الشاب "مونكي دي لوفي" مع طاقمه في رحلة ملحمية عبر البحار بحثاً عن الكنز الأسطوري "ون بيس" ليصبح ملك القراصنة، في واحدة من أشهر سلاسل الأنمي على الإطلاق.',
  seasons: [{ num: 1, episodes: renumbered.length }],
  numberOfSeasons: 1,
  seasonCount: 1,
  episodeCount: renumbered.length,
  numberOfEpisodes: renumbered.length,
};

// 5ب) المسلسل الحيّ: عمل جديد
const liveEpCount = liveS1.length + liveS2.length;
titles[LIVE_ID] = {
  id: LIVE_ID,
  type: 'series',
  title: 'One Piece (مسلسل)',
  titleEn: 'ون بيس - المسلسل التمثيلي',
  year: animeTitle.year || 2023,
  rating: animeTitle.rating != null ? animeTitle.rating : (animeDetail && animeDetail.rating) || null,
  poster: animeTitle.poster,
  backdrop: animeTitle.backdrop,
  genres: animeTitle.genres || ['حركة ومغامرة'],
  isNew: true,
};
details[LIVE_ID] = {
  id: LIVE_ID,
  type: 'series',
  tmdbId: animeDetail ? animeDetail.tmdbId : null,
  title: 'One Piece (مسلسل)',
  titleEn: 'ون بيس - المسلسل التمثيلي',
  originalTitle: 'ONE PIECE',
  year: animeTitle.year || 2023,
  rating: animeDetail ? animeDetail.rating : null,
  voteCount: animeDetail ? animeDetail.voteCount : 0,
  ratingSource: 'TMDB',
  poster: animeTitle.poster,
  tmdbPoster: animeDetail ? animeDetail.tmdbPoster : animeTitle.poster,
  backdrop: animeTitle.backdrop,
  genres: animeTitle.genres || ['حركة ومغامرة'],
  country: 'United States of America',
  synopsis: 'النسخة التمثيلية الحيّة (Live-Action) من ون بيس: يخوض القرصان الشاب "مونكي دي لوفي" وطاقمه المتنوّع مغامرة ملحمية بحثاً عن الكنز الأسطوري، في اقتباس واقعي من سلسلة المانغا الشهيرة.',
  tagline: '',
  runtime: null,
  cast: animeDetail ? animeDetail.cast : [],
  creators: animeDetail ? animeDetail.creators : [],
  quality: 'HD',
  language: 'مترجم',
  seasonCount: 2,
  episodeCount: liveEpCount,
  totalValidServers: null,
  numberOfSeasons: 2,
  numberOfEpisodes: liveEpCount,
  popularity: animeDetail ? animeDetail.popularity : 0,
  ready: true,
  seasons: [
    { num: 1, episodes: liveS1.length },
    { num: 2, episodes: liveS2.length },
  ],
};

fs.writeFileSync('src/data/titles.json', JSON.stringify(titles));
fs.writeFileSync('src/data/details.json', JSON.stringify(details));
console.log('✔ حُدِّث titles.json و details.json');
console.log('\nتم فصل One Piece بنجاح:');
console.log(`  • ${ANIME_ID} (أنمي، موسم واحد، ${renumbered.length} حلقة)`);
console.log(`  • ${LIVE_ID} (مسلسل، موسمان، ${liveEpCount} حلقة)`);
