import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const sourceFile = process.argv[2] || 'C:/Users/tometo.man/Downloads/cleaned_witanime_full_with_posters_no_urls.csv';
const today = new Date().toISOString().slice(0, 10);

function cleanTitle(value) {
  return String(value || '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return cleanTitle(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(?:^|\s)(anime|انمي|أنمي|الموسم|season|tv|ova|ona|movie|film)(?:\s|$)/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitGenres(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,\u060C/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function uniqueGenres(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    for (const genre of splitGenres(row.genres)) {
      const key = genre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(genre);
    }
  }
  return result;
}

function seedFrom(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(items, seed, offset = 0) {
  return items[(seed + offset) % items.length];
}

function hasGenre(genres, patterns) {
  return genres.some((genre) => patterns.some((pattern) => genre.includes(pattern)));
}

function profileFor(genres) {
  if (hasGenre(genres, ['رعب', 'غموض', 'نفسي', 'خارق'])) {
    return {
      focus: 'سر غامض يضغط على الشخصيات ويدفعها لكشف ما تخفيه الأماكن والذكريات',
      movement: 'يتقدم الإيقاع عبر أسئلة صغيرة وخطر يتضح تدريجيًا بدل الاعتماد على مواجهة واحدة',
      value: 'يناسب محبي الأجواء المشحونة والتفاصيل التي تحتاج متابعة دقيقة',
      teaser: 'غموض يتصاعد مع كل حلقة',
    };
  }
  if (hasGenre(genres, ['أكشن', 'شونين', 'قتال', 'قوة', 'عسكري'])) {
    return {
      focus: 'صراع مباشر يختبر القوة والولاء وقدرة الأبطال على تجاوز خصوم أقسى',
      movement: 'تتحرك الحلقات بين تدريب ومواجهات وتغيرات تكشف ثمن الانتصار',
      value: 'يناسب من يحب المعارك الواضحة وتطور الشخصيات خطوة بعد خطوة',
      teaser: 'مواجهات قوية وتطور سريع للأبطال',
    };
  }
  if (hasGenre(genres, ['رياضي', 'رياضة'])) {
    return {
      focus: 'رحلة فريق أو لاعب يحاول تحويل الموهبة إلى نتيجة داخل منافسة صعبة',
      movement: 'يعطي مساحة للتدريب والخصومة وروح الفريق قبل لحظة الحسم',
      value: 'يناسب محبي الحماس الرياضي والشخصيات التي تنضج عبر الخسارة والفوز',
      teaser: 'منافسة رياضية بطموح واضح',
    };
  }
  if (hasGenre(genres, ['رومانسي', 'رومانس', 'شوجو'])) {
    return {
      focus: 'علاقة تتغير ببطء بين شخصيات تحاول فهم مشاعرها وسط سوء فهم وقرارات يومية',
      movement: 'يعتمد على النظرات والمواقف الصغيرة أكثر من الأحداث الضخمة',
      value: 'يناسب من يبحث عن رومانسية هادئة وشخصيات قريبة من الحياة اليومية',
      teaser: 'رومانسية هادئة ومواقف قريبة',
    };
  }
  if (hasGenre(genres, ['كوميدي', 'كوميديا', 'ساخر'])) {
    return {
      focus: 'مواقف يومية أو غير مألوفة تتحول إلى كوميديا بسبب ردود فعل الشخصيات وتناقضاتها',
      movement: 'يمزج بين حلقات خفيفة ومشاهد تكشف طباع الأبطال بدون تعقيد زائد',
      value: 'يناسب المشاهدة الخفيفة عندما تريد عملا سريع الدخول ومباشر النبرة',
      teaser: 'كوميديا خفيفة بشخصيات مرنة',
    };
  }
  if (hasGenre(genres, ['خيال', 'فانتازيا', 'سحر', 'ايسيكاي', 'لعبة'])) {
    return {
      focus: 'انتقال إلى عالم بقواعد مختلفة يفرض على الشخصيات تعلم النجاة وفهم نظام القوة فيه',
      movement: 'يبني عالمه عبر المهمات والتحالفات واكتشاف القوانين التي تحكم المغامرة',
      value: 'يناسب محبي العوالم الواسعة والمغامرات التي تكبر مع كل موسم',
      teaser: 'عالم خيالي بقواعد ومغامرات',
    };
  }
  if (hasGenre(genres, ['مدرسي', 'مدرسة', 'شريحة', 'حياة'])) {
    return {
      focus: 'تفاصيل يومية داخل المدرسة أو الحياة القريبة من الشخصيات وما تصنعه من صداقات وقرارات',
      movement: 'يتقدم بهدوء عبر مواقف متتابعة تكشف طباع كل شخصية',
      value: 'يناسب من يحب الحكايات الهادئة التي تعتمد على العلاقات أكثر من الصخب',
      teaser: 'حكاية يومية بعلاقات واضحة',
    };
  }
  if (hasGenre(genres, ['دراما', 'تراجيدي'])) {
    return {
      focus: 'اختيارات شخصية صعبة تترك أثرها على العلاقات وتغير نظرة الأبطال لأنفسهم',
      movement: 'يعتمد على التدرج العاطفي ومواقف تكشف ما يخسره كل طرف وما يحاول إنقاذه',
      value: 'يناسب من يفضل الدراما الواضحة والصراعات الإنسانية المباشرة',
      teaser: 'دراما شخصية باختيارات صعبة',
    };
  }
  return {
    focus: 'حكاية أنمي تتحرك بين شخصيات متعددة وأحداث تتدرج حسب طبيعة كل حلقة',
    movement: 'يعطي لكل موسم مساحة لتوضيح العلاقات والصراع قبل الانتقال إلى الحلقة التالية',
    value: 'يناسب من يريد متابعة مرتبة حسب الموسم والحلقة مع ترجمة عربية واضحة',
    teaser: 'حلقات مترجمة بترتيب واضح',
  };
}

function countEpisodes(rows, fallback) {
  const seasons = new Map();
  for (const row of rows) {
    const season = Number.parseInt(row.season || '1', 10) || 1;
    const episode = Number.parseInt(row.episode || '1', 10) || 1;
    if (!seasons.has(season)) seasons.set(season, new Set());
    seasons.get(season).add(episode);
  }
  const episodes = [...seasons.values()].reduce((total, set) => total + set.size, 0);
  return {
    seasonsCount: seasons.size || fallback.seasonsCount || 1,
    episodesCount: episodes || fallback.episodesCount || 1,
  };
}

function joinGenres(genres) {
  return genres.slice(0, 4).join('، ') || 'أنمي';
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function trimChars(value, max) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : cut.length).trim()}…`;
}

function buildStory(title, group, rows) {
  const name = cleanTitle(title.clean_title || group.name);
  const genres = uniqueGenres(rows);
  const genreText = joinGenres(genres);
  const profile = profileFor(genres);
  const seed = seedFrom(title.slug || name);
  const counts = countEpisodes(rows, {
    seasonsCount: title.seasons_count,
    episodesCount: title.episodes_count,
  });
  const seasonText = formatCount(counts.seasonsCount, 'موسم', 'مواسم');
  const episodeText = formatCount(counts.episodesCount, 'حلقة', 'حلقة');
  const status = cleanTitle(rows.find((row) => row.status)?.status);
  const statusText = status ? `وتوضح بيانات المصدر أن حالة العرض هي ${status}.` : '';

  const openings = [
    `يدور أنمي ${name} حول ${profile.focus}.`,
    `تبدأ قصة ${name} من ${profile.focus}.`,
    `في أنمي ${name} تتحرك الحكاية حول ${profile.focus}.`,
    `يعتمد ${name} على ${profile.focus}.`,
  ];
  const middle = [
    `ينتمي العمل إلى أجواء ${genreText}، لذلك ${profile.movement}.`,
    `تصنيف ${genreText} يظهر في طريقة بناء الحلقات، حيث ${profile.movement}.`,
    `تمنح تصنيفات ${genreText} العمل نبرة واضحة، فهو ${profile.movement}.`,
  ];
  const endings = [
    `يتوفر العمل على CINMAPRO بترتيب يشمل ${seasonText} و${episodeText} مع روابط مشاهدة محدثة. ${profile.value}.`,
    `صفحة CINMAPRO ترتب ${seasonText} و${episodeText} لتبدأ من الحلقة المناسبة دون بحث طويل. ${profile.value}.`,
    `يمكن متابعة ${name} على CINMAPRO عبر ${seasonText} و${episodeText} بروابط حديثة وسريعة. ${profile.value}.`,
  ];

  return [
    pick(openings, seed),
    pick(middle, seed, 3),
    statusText,
    pick(endings, seed, 7),
  ].filter(Boolean).join(' ');
}

function buildHighlights(title, rows) {
  const name = cleanTitle(title.clean_title);
  const genres = uniqueGenres(rows);
  const profile = profileFor(genres);
  const genreText = joinGenres(genres);
  return `يميز ${name} أنه يستخدم أجواء ${genreText} في بناء متابعة واضحة لا تترك الحلقات مبعثرة. ${profile.movement}. كما أن ترتيب المواسم والحلقات في CINMAPRO يجعل الوصول للحلقة المطلوبة أسرع من البحث داخل روابط متفرقة.`;
}

function buildMeta(title, rows) {
  const name = cleanTitle(title.clean_title);
  const genres = uniqueGenres(rows);
  const profile = profileFor(genres);
  const year = title.year ? ` ${title.year}` : '';
  return trimChars(`${name} أنمي${year} | ${profile.teaser} | شاهد الحلقات مترجمة HD على CINMAPRO`, 155);
}

async function readGroups() {
  const rawCsv = await fs.readFile(sourceFile);
  const rows = parse(rawCsv, { columns: true, bom: true, skip_empty_lines: true });
  const groups = new Map();
  for (const row of rows) {
    const name = cleanTitle(row.anime_title);
    if (!name) continue;
    const key = normalizeTitle(name);
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key).rows.push(row);
  }
  return groups;
}

async function main() {
  const groups = await readGroups();
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json'));
  let scannedAnime = 0;
  let updated = 0;
  let skippedNoGroup = 0;

  for (const file of files) {
    const fullPath = path.join(titlesDir, file);
    const title = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    if (title.category !== 'anime') continue;
    scannedAnime += 1;

    const key = normalizeTitle(title.clean_title || title.raw_name || title.slug);
    const group = groups.get(key) || {
      name: cleanTitle(title.clean_title || title.raw_name || title.slug),
      rows: [{ genres: title.genre || '', status: title.status || '', season: '1', episode: '1' }],
    };
    if (!groups.has(key)) skippedNoGroup += 1;

    const looksImported = title.story == null
      || title.story === ''
      || title.description?.includes('متوفر على CINMAPRO بترجمة عربية وروابط مشاهدة مرتبة');
    if (!looksImported) continue;

    const story = buildStory(title, group, group.rows);
    const highlights = buildHighlights(title, group.rows);
    title.story = story;
    title.description = story;
    title.note = 'تم إثراء بيانات هذا الأنمي من ملف Witanime مع استبعاد السيرفرات التالفة.';
    title.seoContent ||= {};
    title.seoContent.generatedAt = today;
    title.seoContent.arabicTitle ||= cleanTitle(title.clean_title || group.name);
    title.seoContent.mainDescription = story;
    title.seoContent.metaDescription = buildMeta(title, group.rows);
    title.seoContent.highlights = highlights;
    title.seoContent.beforeWatchingPoints = [
      'ابدأ من الحلقة الأولى إذا كان الأنمي قصصيًا أو يعتمد على تطور الشخصيات.',
      'اختر السيرفرات الأولى لأنها أضيفت من القائمة الأحدث بعد تنظيف الروابط التالفة.',
      'المشاهدة بجودة عالية أفضل خصوصًا في الأعمال التي تعتمد على الحركة أو التفاصيل البصرية.',
    ];

    await fs.writeFile(fullPath, `${JSON.stringify(title, null, 2)}\n`, 'utf8');
    updated += 1;
  }

  console.log(JSON.stringify({
    sourceFile,
    scannedAnime,
    updated,
    skippedNoGroup,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
