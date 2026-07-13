// ============================================================================
// إصلاح أنمي One Piece: دمج الحلقات المكررة + صورة/معلومات الأنمي الحقيقية
// ----------------------------------------------------------------------------
// المشاكل:
//   1) عدد الحلقات = 2247 لكنها تحوي تكراراً ضخماً (نفس رقم الحلقة من مصادر
//      مختلفة). الأرقام الحقيقية الفريدة = نطاق 9..1167. المطلوب: دمج كل نسخ
//      نفس رقم الحلقة في حلقة واحدة (تجميع سيرفراتها) وإعادة ترقيم 1..N.
//   2) صورة العمل لا تزال صورة المسلسل التمثيلي (TMDB movie 111110) — يجب
//      استبدالها بصورة الأنمي الحقيقي (TMDB tv 37854).
//   3) معلومات صفحة الأنمي هي معلومات المسلسل — يجب استبدالها ببيانات الأنمي.
// ============================================================================
import fs from 'fs';
import { shardOf } from './lib-common.mjs';

const SHARDS = 64;
const ANIME_ID = 'one-piece-2';
const IMG = 'https://image.tmdb.org/t/p';

const titles = JSON.parse(fs.readFileSync('src/data/titles.json', 'utf8'));
const details = JSON.parse(fs.readFileSync('src/data/details.json', 'utf8'));
const opAnime = JSON.parse(fs.readFileSync('/tmp/op-anime.json', 'utf8'));

fs.writeFileSync('/tmp/titles.before-opfix.json', JSON.stringify(titles));
fs.writeFileSync('/tmp/details.before-opfix.json', JSON.stringify(details));

const shardPath = `public/data/episodes/shard-${shardOf(ANIME_ID, SHARDS)}.json`;
const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
fs.writeFileSync('/tmp/episodes-anime.before-opfix.json', JSON.stringify(shard[ANIME_ID]));

const eps = shard[ANIME_ID]['1'] || [];
console.log(`الحلقات قبل الدمج: ${eps.length}`);

// ---------------------------------------------------------------------------
// 1) استخراج رقم الحلقة الحقيقي من الاسم ودمج التكرارات
// ---------------------------------------------------------------------------
const realNum = (name) => {
  const m = (name || '').match(/الحلقة\s+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

// دمج السيرفرات (إزالة المكرر بالرابط)
const mergeServers = (a, b) => {
  const seen = new Set();
  const out = [];
  for (const s of [...(a || []), ...(b || [])]) {
    const key = (s && s.url) || JSON.stringify(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const byNum = new Map(); // realNum -> episode (merged)
let noNum = 0;
for (const ep of eps) {
  const rn = realNum(ep.name);
  if (rn == null) { noNum++; continue; }
  if (byNum.has(rn)) {
    const prev = byNum.get(rn);
    prev.servers = mergeServers(prev.servers, ep.servers);
    // احتفظ بأفضل اسم/تفاصيل (الأطول غالباً أفضل)
    if ((ep.name || '').length > (prev.name || '').length) prev.name = ep.name;
    if (!prev.synopsis && ep.synopsis) prev.synopsis = ep.synopsis;
    if (!prev.still && ep.still) prev.still = ep.still;
  } else {
    byNum.set(rn, { ...ep });
  }
}
console.log(`حلقات بلا رقم في الاسم (تجاهلناها): ${noNum}`);
console.log(`أرقام حلقات فريدة بعد الدمج: ${byNum.size}`);

// رتّب حسب الرقم الحقيقي وأعد الترقيم 1..N
const sorted = [...byNum.entries()].sort((a, b) => a[0] - b[0]);
const merged = sorted.map(([rn, ep], i) => ({
  ...ep,
  num: i + 1,
  // نُبقي رقم الحلقة الأصلي في الاسم كما هو (يعكس تسلسل الأنمي الحقيقي)
}));
console.log(`الحلقات بعد الدمج وإعادة الترقيم: ${merged.length}`);
console.log(`  أول حلقة: [${merged[0].num}] ${merged[0].name} (srv:${(merged[0].servers || []).length})`);
console.log(`  آخر حلقة: [${merged[merged.length - 1].num}] ${merged[merged.length - 1].name}`);

// إجمالي السيرفرات
const totalServers = merged.reduce((s, e) => s + (e.servers || []).length, 0);
console.log(`إجمالي السيرفرات بعد الدمج: ${totalServers}`);

shard[ANIME_ID] = { '1': merged };
fs.writeFileSync(shardPath, JSON.stringify(shard));
console.log(`✔ حُدِّث ${shardPath}`);

// ---------------------------------------------------------------------------
// 2 + 3) تحديث صورة ومعلومات الأنمي من TMDB (tv 37854)
// ---------------------------------------------------------------------------
const poster = opAnime.poster_path ? `${IMG}/w500${opAnime.poster_path}` : titles[ANIME_ID].poster;
const backdrop = opAnime.backdrop_path ? `${IMG}/w1280${opAnime.backdrop_path}` : null;
const genres = (opAnime.genres || []).map((g) => g.name);
const cast = (opAnime.credits?.cast || []).slice(0, 10).map((c) => c.name);
const rating = opAnime.vote_average ? Math.round(opAnime.vote_average * 10) / 10 : null;
const votes = opAnime.vote_count || 0;

titles[ANIME_ID] = {
  ...titles[ANIME_ID],
  title: 'One Piece',
  titleEn: 'ون بيس',
  year: opAnime.first_air_date ? parseInt(opAnime.first_air_date.slice(0, 4), 10) : titles[ANIME_ID].year,
  rating: votes >= 50 ? rating : null,
  poster,
  backdrop,
  genres: genres.length ? genres : titles[ANIME_ID].genres,
};

const epCount = merged.length;
details[ANIME_ID] = {
  ...details[ANIME_ID],
  tmdbId: 37854,
  title: 'One Piece',
  titleEn: 'ون بيس',
  originalTitle: opAnime.original_name || 'ワンピース',
  type: 'anime',
  year: opAnime.first_air_date ? parseInt(opAnime.first_air_date.slice(0, 4), 10) : details[ANIME_ID].year,
  rating: rating,
  ratingRaw: rating,
  voteCount: votes,
  ratingSource: 'TMDB',
  poster,
  tmdbPoster: poster,
  backdrop,
  genres: genres.length ? genres : details[ANIME_ID].genres,
  country: (opAnime.origin_country && opAnime.origin_country[0]) || 'Japan',
  synopsis: opAnime.overview || details[ANIME_ID].synopsis,
  cast,
  creators: (opAnime.created_by || []).map((c) => c.name),
  popularity: opAnime.popularity || details[ANIME_ID].popularity,
  seasons: [{ num: 1, episodes: epCount }],
  numberOfSeasons: 1,
  seasonCount: 1,
  episodeCount: epCount,
  numberOfEpisodes: epCount,
  totalValidServers: totalServers,
  ready: true,
};
// إن كانت الأصوات كافية نُظهر التقييم، وإلا نُخفيه (اتساقاً مع سياسة fix-ratings)
if (votes < 50) { titles[ANIME_ID].rating = null; details[ANIME_ID].rating = null; }

fs.writeFileSync('src/data/titles.json', JSON.stringify(titles));
fs.writeFileSync('src/data/details.json', JSON.stringify(details));
console.log('✔ حُدِّث titles.json و details.json ببيانات الأنمي الحقيقي (TMDB tv 37854)');
console.log(`\nالنتيجة: أنمي One Piece — ${epCount} حلقة فريدة، تقييم ${titles[ANIME_ID].rating}, بوستر أنمي.`);
