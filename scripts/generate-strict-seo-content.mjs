import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const cachePath = path.join(rootDir, 'scripts', '.strict-seo-cache.json');
const generatedAt = new Date().toISOString().slice(0, 10);
const BRAND = 'CINMAPRO';

const TYPE_LABEL = {
  movie: 'فيلم',
  series: 'مسلسل',
  anime: 'أنمي',
};

const GENRE_AR = {
  Action: 'أكشن',
  Adventure: 'مغامرة',
  Animation: 'أنمي',
  Biography: 'سيرة ذاتية',
  Comedy: 'كوميديا',
  Crime: 'جريمة',
  Documentary: 'وثائقي',
  Drama: 'دراما',
  Family: 'عائلي',
  Fantasy: 'فانتازيا',
  History: 'تاريخي',
  Horror: 'رعب',
  Music: 'موسيقي',
  Musical: 'استعراضي',
  Mystery: 'غموض',
  News: 'إخباري',
  Romance: 'رومانسي',
  'Sci-Fi': 'خيال علمي',
  Short: 'قصير',
  Sport: 'رياضي',
  Thriller: 'إثارة',
  War: 'حربي',
  Western: 'غرب أمريكي',
};

const COUNTRY_AR = {
  Argentina: 'الأرجنتين',
  Australia: 'أستراليا',
  Belgium: 'بلجيكا',
  Brazil: 'البرازيل',
  Canada: 'كندا',
  China: 'الصين',
  Colombia: 'كولومبيا',
  Denmark: 'الدنمارك',
  France: 'فرنسا',
  Germany: 'ألمانيا',
  India: 'الهند',
  Ireland: 'أيرلندا',
  Italy: 'إيطاليا',
  Japan: 'اليابان',
  Mexico: 'المكسيك',
  Netherlands: 'هولندا',
  'New Zealand': 'نيوزيلندا',
  Philippines: 'الفلبين',
  Poland: 'بولندا',
  Spain: 'إسبانيا',
  Sweden: 'السويد',
  Thailand: 'تايلند',
  Ukraine: 'أوكرانيا',
  'United Kingdom': 'المملكة المتحدة',
  'United States': 'الولايات المتحدة الأمريكية',
  'South Africa': 'جنوب أفريقيا',
};

const LANGUAGE_AR = {
  Arabic: 'العربية',
  Chinese: 'الصينية',
  Danish: 'الدنماركية',
  English: 'الإنجليزية',
  French: 'الفرنسية',
  German: 'الألمانية',
  Italian: 'الإيطالية',
  Japanese: 'اليابانية',
  Korean: 'الكورية',
  Portuguese: 'البرتغالية',
  Spanish: 'الإسبانية',
  Swedish: 'السويدية',
};

const ACRONYM_AR = {
  AI: 'الذكاء الاصطناعي',
  CIA: 'وكالة الاستخبارات',
  FBI: 'مكتب التحقيقات الفدرالي',
  NASA: 'ناسا',
  NYPD: 'شرطة نيويورك',
  SWAT: 'قوات التدخل',
  USA: 'الولايات المتحدة',
};

const BANNED = [
  'ويجد',
  'نفسه أمام اختبار',
  'لا يعتمد العمل على عنوانه فقط',
  'الأجواء هنا',
  'ولذلك لا يظهر التصنيف كوسم تسويقي',
  'يمنح مساحة أكبر للتأمل',
  'تجربة سينمائية فاخرة',
  'تجربة سينمائية',
  'يقدم هذا العمل',
  'لا تبدو القصة',
];

const TITLE_ALIASES = {
  'ao-no-exorcist': 'Blue Exorcist',
  'tensei-shitara-slime-datta-ken': 'That Time I Got Reincarnated as a Slime',
};

const ARABIC_TITLE_OVERRIDES = {
  'tensei-shitara-slime-datta-ken': 'حولت إلى سلايم',
};

const PRIMARY_CHARACTER_OVERRIDES = {
  '1-million-followers-2024-مترجم-اون-لاين': 'كاريسا',
  'abbott-elementary': 'جانين تيغز',
  'ao-no-exorcist': 'رين أوكومورا',
  'blue-lock': 'يويتشي إيساغي',
  'boku-no-hero-academia': 'إيزوكو ميدوريا',
  'bungou-stray-dogs': 'أتسوشي ناكاجيما',
  'diamond-no-ace-act-ii': 'إيجون ساوامورا',
  'dr-stone': 'سينكو',
  'elsbeth': 'إلزبيث تاسيوني',
  'golden-kamuy': 'سايتشي سوغيموتو',
  'jujutsu-kaisen': 'يوجي إيتادوري',
  'one-punch-man': 'سايتاما',
  'oshi-no-ko': 'أكوا وروبي',
  'record-of-ragnarok': 'برونهيلد',
  'sousou-no-frieren': 'فريرين',
  'tensei-shitara-slime-datta-ken': 'ساتورو ميكامي',
  'xian-wang-de-richang-shenghuo': 'وانغ لينغ',
  'yami-shibai': 'راوي القصص',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSuffixes(value) {
  return normalize(value)
    .replace(/مترجمة?/gu, ' ')
    .replace(/(?:اون|أون)\s*لاين/gu, ' ')
    .replace(/(?:اون|أون|لاين)/gu, ' ')
    .replace(/(?:فيلم|مسلسل|انمي|أنمي)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(title) {
  if (TITLE_ALIASES[title.slug]) return TITLE_ALIASES[title.slug];
  let name = stripSuffixes(title.clean_title || title.raw_name || title.slug);
  if (title.year) name = name.replace(new RegExp(`\\b${title.year}\\b`, 'g'), '').trim();
  return normalize(name || title.slug.replaceAll('-', ' '));
}

function asciiKey(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’:.!?,\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTypeOk(category, type) {
  const normalized = String(type || '').toLowerCase();
  if (category === 'movie') return ['movie', 'tvmovie', 'short'].includes(normalized);
  return ['tvseries', 'tvminiseries'].includes(normalized);
}

function yearScore(category, titleYear, candidateYear) {
  if (!titleYear || !candidateYear) return 0;
  const input = Number(titleYear);
  const found = Number(candidateYear);
  if (!Number.isFinite(input) || !Number.isFinite(found)) return 0;
  if (category === 'movie') {
    if (input === found) return 35;
    const diff = Math.abs(input - found);
    return Math.max(0, 18 - diff * 6);
  }
  return found <= input ? 8 : -8;
}

async function readCache() {
  try {
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    cache.translations ||= {};
    cache.imdbSearch ||= {};
    cache.imdbSuggest ||= {};
    cache.imdbTitle ||= {};
    return cache;
  } catch {
    return { translations: {}, imdbSearch: {}, imdbSuggest: {}, imdbTitle: {} };
  }
}

async function writeCache(cache) {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CINMAPRO SEO content verification',
          'Accept-Language': 'en-US,en;q=0.8,ar;q=0.7',
        },
      });
      if (response.ok) return await response.json();
      if (response.status === 429) await sleep(1800 * attempt);
    } catch {
      // Retry below.
    }
    await sleep(350 * attempt);
  }
  return null;
}

async function imdbSuggest(title, cache) {
  const name = baseTitle(title);
  const key = `${title.category}:${name}`;
  if (!cache.imdbSuggest[key]?.d?.length) {
    const first = encodeURIComponent((name[0] || 'a').toLowerCase());
    const query = encodeURIComponent(name);
    cache.imdbSuggest[key] = await fetchJson(`https://v2.sg.media-imdb.com/suggestion/${first}/${query}.json`, 5);
    await sleep(180);
  }
  const results = cache.imdbSuggest[key]?.d || [];
  const wanted = asciiKey(name);
  let best = null;
  let bestScore = -Infinity;
  for (const item of results) {
    if (!item?.id?.startsWith?.('tt')) continue;
    const candidate = asciiKey(item.l || '');
    let score = 0;
    if (titleTypeOk(title.category, item.qid || item.q)) score += 60;
    if (candidate === wanted) score += 70;
    else if (candidate.includes(wanted) || wanted.includes(candidate)) score += 28;
    score += yearScore(title.category, title.year, item.y);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    type: best.qid || best.q || null,
    primaryTitle: best.l || name,
    originalTitle: best.l || name,
    startYear: best.y || null,
  };
}

async function imdbSearch(title, cache) {
  const name = baseTitle(title);
  const key = `${title.category}:${name}`;
  if (!cache.imdbSearch[key]?.titles?.length) {
    const url = `https://api.imdbapi.dev/search/titles?query=${encodeURIComponent(name)}`;
    cache.imdbSearch[key] = await fetchJson(url);
    await sleep(120);
  }
  const results = cache.imdbSearch[key]?.titles || [];
  if (!results.length) return imdbSuggest(title, cache);
  const wanted = asciiKey(name);
  let best = null;
  let bestScore = -Infinity;

  for (const item of results) {
    if (!item?.id) continue;
    const candidate = asciiKey(item.primaryTitle || item.originalTitle || '');
    let score = 0;
    if (titleTypeOk(title.category, item.type)) score += 60;
    if (candidate === wanted) score += 70;
    else if (candidate.includes(wanted) || wanted.includes(candidate)) score += 28;
    score += yearScore(title.category, title.year, item.startYear);
    if (String(item.id).startsWith('tt')) score += 5;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best || results.find((item) => item?.id?.startsWith?.('tt')) || null;
}

async function imdbTitle(imdbId, cache) {
  if (!imdbId) return null;
  if (!cache.imdbTitle[imdbId]?.id) {
    cache.imdbTitle[imdbId] = await fetchJson(`https://api.imdbapi.dev/titles/${imdbId}`);
    await sleep(120);
  }
  return cache.imdbTitle[imdbId];
}

async function translate(text, cache) {
  const clean = normalize(text);
  if (!clean) return '';
  if (cache.translations[clean]) return cache.translations[clean];
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(clean)}`;
  try {
    const data = await fetchJson(url, 2);
    const translated = data?.[0]?.map((chunk) => chunk[0]).join('') || '';
    cache.translations[clean] = normalize(translated);
  } catch {
    cache.translations[clean] = '';
  }
  await sleep(100);
  return cache.translations[clean];
}

const LETTERS = {
  a: 'ا',
  b: 'ب',
  c: 'ك',
  d: 'د',
  e: 'ي',
  f: 'ف',
  g: 'غ',
  h: 'ه',
  i: 'ي',
  j: 'ج',
  k: 'ك',
  l: 'ل',
  m: 'م',
  n: 'ن',
  o: 'و',
  p: 'ب',
  q: 'ك',
  r: 'ر',
  s: 'س',
  t: 'ت',
  u: 'و',
  v: 'ف',
  w: 'و',
  x: 'كس',
  y: 'ي',
  z: 'ز',
};

const WORD_AR = {
  about: 'عن',
  absolution: 'الغفران',
  accidental: 'العرضي',
  acid: 'الحمض',
  adagio: 'أداجيو',
  afraid: 'خائف',
  aftermath: 'العواقب',
  allegiance: 'الولاء',
  alpha: 'ألفا',
  animals: 'الحيوانات',
  away: 'بعيدًا',
  blue: 'الأزرق',
  brady: 'برادي',
  camera: 'كاميرا',
  cameras: 'كاميرات',
  chef: 'طاهية',
  complete: 'كامل',
  creature: 'مخلوق',
  dark: 'الظلام',
  days: 'أيام',
  deadly: 'قاتل',
  desperate: 'يائسة',
  different: 'مختلف',
  divide: 'انقسام',
  everything: 'كل شيء',
  family: 'العائلة',
  followers: 'متابع',
  forest: 'الغابة',
  good: 'جيد',
  great: 'كبير',
  halloween: 'الهالوين',
  haunted: 'مسكون',
  haunting: 'مطاردة',
  hours: 'ساعات',
  journey: 'رحلة',
  knight: 'فارس',
  love: 'حب',
  million: 'مليون',
  midnight: 'منتصف الليل',
  mistake: 'خطأ',
  new: 'جديد',
  part: 'جزء',
  pressure: 'ضغط',
  quiet: 'هادئ',
  real: 'حقيقي',
  revenge: 'انتقام',
  royal: 'ملكي',
  sacrifice: 'تضحية',
  seconds: 'ثوان',
  seduced: 'مغواة',
  song: 'أغنية',
  southern: 'جنوبي',
  story: 'قصة',
  summer: 'صيف',
  threat: 'تهديد',
  underground: 'تحت الأرض',
  vampire: 'مصاص دماء',
  widow: 'أرملة',
  windows: 'نوافذ',
  winning: 'فائز',
};

function transliterateWord(word) {
  const raw = String(word || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Script=Latin}0-9]/gu, '');
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (ACRONYM_AR[upper]) return ACRONYM_AR[upper];
  const lower = raw.toLowerCase();
  if (WORD_AR[lower]) return WORD_AR[lower];
  if (/^\d+$/.test(raw)) return raw;
  let out = '';
  for (let i = 0; i < lower.length; i += 1) {
    const two = lower.slice(i, i + 2);
    const three = lower.slice(i, i + 3);
    if (three === 'sch') {
      out += 'ش';
      i += 2;
      continue;
    }
    if (two === 'sh') {
      out += 'ش';
      i += 1;
      continue;
    }
    if (two === 'ch') {
      out += 'تش';
      i += 1;
      continue;
    }
    if (two === 'th') {
      out += 'ث';
      i += 1;
      continue;
    }
    if (two === 'ph') {
      out += 'ف';
      i += 1;
      continue;
    }
    if (two === 'ck') {
      out += 'ك';
      i += 1;
      continue;
    }
    out += LETTERS[lower[i]] || '';
  }
  return out.replace(/اا+/g, 'ا').replace(/يي+/g, 'ي').replace(/وو+/g, 'و') || raw;
}

function arabicizeLatin(text) {
  return normalize(text)
    .replace(/\bAI\b/g, ACRONYM_AR.AI)
    .replace(/\bCIA\b/g, ACRONYM_AR.CIA)
    .replace(/\bFBI\b/g, ACRONYM_AR.FBI)
    .replace(/\bNASA\b/g, ACRONYM_AR.NASA)
    .replace(/\bNYPD\b/g, ACRONYM_AR.NYPD)
    .replace(/\bUSA\b/g, ACRONYM_AR.USA)
    .replace(/\p{Script=Latin}[\p{Script=Latin}0-9'’.-]*/gu, (word) => {
      if (word === BRAND || word === 'HD') return word;
      return transliterateWord(word);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

async function arabicTitleFor(title, facts, cache) {
  if (ARABIC_TITLE_OVERRIDES[title.slug]) return ARABIC_TITLE_OVERRIDES[title.slug];
  const english = facts?.primaryTitle || baseTitle(title);
  const translated = await translate(english, cache);
  const candidate = arabicizeLatin(translated || english)
    .replace(/\s+مترجم.*$/u, '')
    .replace(/\s+اون\s+لاين.*$/u, '')
    .trim();
  return candidate || arabicizeLatin(english);
}

function arabicGenres(category, facts, title) {
  const fromImdb = (facts?.genres || []).map((genre) => GENRE_AR[genre] || arabicizeLatin(genre)).filter(Boolean);
  const current = normalize(title.genre)
    .split(/[\/،,]+/)
    .map((genre) => normalize(genre))
    .filter(Boolean);
  const genres = fromImdb.length ? fromImdb : current;
  if (category === 'anime' && !genres.includes('أنمي')) genres.unshift('أنمي');
  return [...new Set(genres)].slice(0, 5);
}

function arabicCountry(facts, fallback) {
  const countries = (facts?.originCountries || [])
    .map((country) => COUNTRY_AR[country.name] || arabicizeLatin(country.name))
    .filter(Boolean);
  return countries.length ? countries.join('، ') : normalize(fallback || '');
}

function arabicLanguage(facts, fallback) {
  const languages = (facts?.spokenLanguages || [])
    .map((language) => LANGUAGE_AR[language.name] || arabicizeLatin(language.name))
    .filter(Boolean);
  return languages.length ? languages.slice(0, 2).join('، ') : normalize(fallback || 'مترجم');
}

function runtimeLabel(facts, fallback) {
  if (!facts?.runtimeSeconds) return fallback || null;
  const minutes = Math.round(Number(facts.runtimeSeconds) / 60);
  if (!minutes) return fallback || null;
  return `${minutes} دقيقة`;
}

function peopleArabic(list = []) {
  return list
    .map((person) => arabicizeLatin(person.displayName || person.name || ''))
    .filter(Boolean)
    .slice(0, 5)
    .join('، ');
}

function extractCapitalNames(plot) {
  const text = normalize(plot);
  const matches = text.match(/\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2}/g) || [];
  const skip = new Set([
    'After',
    'An',
    'And',
    'As',
    'At',
    'During',
    'Follows',
    'For',
    'From',
    'In',
    'On',
    'The',
    'They',
    'This',
    'When',
    'While',
    'Who',
    'Who Is',
    'Who Is Invited',
    'World War',
    'New York',
    'United States',
    'United Kingdom',
    'Thailand',
    'Things',
    'Every',
    'Gods',
    "Gods' Council",
    'Council',
    'History',
    'Philadelphia',
  ]);
  return matches
    .map((name) => name.replace(/[.,:;!?]+$/g, '').trim())
    .filter((name) => name.length > 2 && !skip.has(name) && !/^(IMDb|TV|HD|NYPD|FBI|CIA|NASA)$/i.test(name));
}

function primaryCharacter(title, facts, arabicTitle) {
  if (PRIMARY_CHARACTER_OVERRIDES[title.slug]) return PRIMARY_CHARACTER_OVERRIDES[title.slug];
  const plot = normalize(facts?.plot || '');
  const lowerPlot = plot.toLowerCase();
  if (lowerPlot.includes('humanity') && lowerPlot.includes('gods')) return 'البشرية';
  if (lowerPlot.includes('dedicated teachers') || lowerPlot.includes('group of teachers')) return 'معلمو المدرسة';
  const explicit = [
    /(?:named|called)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})/,
    /(?:attorney|detective|doctor|surgeon|officer|agent|pilot|widow|teacher|student|writer|astronaut|chef|teenager|mother|father|woman|man|girl|boy)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,1})/,
    /(?:Attorney|Detective|Doctor|Surgeon|Officer|Agent|Pilot|Widow|Teacher|Student|Writer|Astronaut|Chef|Teenager|Mother|Father|Woman|Man|Girl|Boy)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,1})/,
  ];
  for (const pattern of explicit) {
    const match = plot.match(pattern);
    if (match?.[1]) return arabicizeLatin(match[1]);
  }
  const names = extractCapitalNames(plot);
  const titleName = facts?.primaryTitle || baseTitle(title);
  const titleWords = asciiKey(titleName).split(' ').filter(Boolean);
  const namedFromTitle = names.find((name) => titleWords.some((word) => asciiKey(name).includes(word)));
  if (namedFromTitle) return arabicizeLatin(namedFromTitle);
  if (names[0]) return arabicizeLatin(names[0]);
  if (/^[\p{L}\s]+$/u.test(arabicTitle) && arabicTitle.split(/\s+/).length <= 3) return arabicTitle;
  return `بطل ${arabicTitle}`;
}

function hasGenre(genres, keys) {
  return genres.some((genre) => keys.some((key) => genre.includes(key)));
}

function challengeFor(genres, category) {
  if (category === 'anime' && hasGenre(genres, ['رياضي'])) return 'رهانًا رياضيًا يكبر مع كل مواجهة';
  if (category === 'anime' && hasGenre(genres, ['أكشن', 'مغامرة'])) return 'خصومًا أقوى وأسئلة عن معنى القوة والاختيار';
  if (hasGenre(genres, ['رعب'])) return 'خطرًا يقترب ببطء ويحوّل التفاصيل الصغيرة إلى مصدر قلق';
  if (hasGenre(genres, ['جريمة', 'غموض'])) return 'قضية مربكة تكشف وجوهًا مخفية للشخصيات';
  if (hasGenre(genres, ['خيال علمي'])) return 'فكرة غير مألوفة تغيّر قواعد الواقع حوله';
  if (hasGenre(genres, ['كوميديا'])) return 'مواقف محرجة تكشف طباع الشخصيات أكثر مما تخفيها';
  if (hasGenre(genres, ['رومانسي'])) return 'اختيارات عاطفية تصطدم بما يريده القلب وما تفرضه الظروف';
  if (hasGenre(genres, ['دراما'])) return 'قرارًا شخصيًا يغيّر علاقاته ومن يثق به';
  if (hasGenre(genres, ['أكشن'])) return 'مطاردة حادة تفرض عليه قرارات سريعة';
  return 'حدثًا محوريًا يفتح أمامه سلسلة قرارات صعبة';
}

function craftAngle(genres, category) {
  if (category === 'anime') return 'ترتيب الحلقات يجعل التحولات أوضح، خصوصًا عندما تعود تفصيلة صغيرة لتغيّر معنى مواجهة لاحقة';
  if (hasGenre(genres, ['رعب'])) return 'القوة في طريقة تأخير المعلومة وبناء الخوف من المكان قبل لحظة الصدمة';
  if (hasGenre(genres, ['جريمة', 'غموض'])) return 'الحكاية تضع القرائن في المقدمة، ثم تجعل كل اعتراف أو صمت جزءًا من التحقيق';
  if (hasGenre(genres, ['كوميديا'])) return 'النكتة تنبع من طباع الشخصيات والمواقف اليومية، لا من تعليق عابر يمكن نقله إلى عمل آخر';
  if (hasGenre(genres, ['خيال علمي', 'فانتازيا'])) return 'العالم المتخيل له قواعد واضحة، ولذلك يصبح فهمها جزءًا من متعة المتابعة';
  if (hasGenre(genres, ['رومانسي'])) return 'العلاقات لا تتحرك بخط مستقيم؛ كل اقتراب يترك أثرًا على القرار التالي';
  if (hasGenre(genres, ['أكشن'])) return 'تصميم الحركة يخدم الخطر الأساسي، فلا تأتي المطاردة منفصلة عن هدف الشخصية';
  return 'التركيز على العلاقات والاختيارات يجعل القصة مرتبطة بتفاصيل لا تظهر كلها في الملخص القصير';
}

function familyPoint(genres) {
  if (hasGenre(genres, ['رعب', 'جريمة', 'إثارة'])) return 'لا يناسب المشاهدة العائلية الصغيرة غالبًا؛ راجع التصنيف العمري بسبب التوتر أو العنف أو التحقيقات.';
  if (hasGenre(genres, ['كوميديا', 'عائلي', 'أنمي', 'رياضي'])) return 'قد يناسب العائلة مع مراجعة التصنيف العمري، لأن بعض الحلقات أو النكات قد تحتاج تقديرًا مسبقًا.';
  return 'ملاءمته للعائلة تعتمد على عمر المشاهد وطبيعة الموضوع، لذلك يفضل مراجعة التصنيف قبل التشغيل.';
}

function continuityPoint(title, arabicTitle, category) {
  const name = asciiKey(baseTitle(title));
  if (name.includes('after everything')) return 'يفضل معرفة الأجزاء السابقة من السلسلة حتى تكون علاقة الشخصيات وخلفياتها أوضح.';
  if (name.includes('quiet place')) return 'يمكن متابعة الحكاية كمدخل منفصل، لكن معرفة عالم السلسلة تجعل الخطر وقواعد الصمت أوضح.';
  if (category === 'movie') return `لا يحتاج ${arabicTitle} إلى مشاهدة عمل سابق إلا إذا كنت تريد معرفة سياق السلسلة عند وجوده.`;
  return 'الأفضل البدء من الموسم الأول لأن العلاقات وتطور الشخصيات مرتبطان بترتيب الحلقات.';
}

function qualityPoint(category) {
  if (category === 'anime') return 'أفضل مشاهدة تكون بدقة عالية حتى تظهر الترجمة، تفاصيل الرسم، وحركة المشاهد السريعة بوضوح.';
  return 'أفضل جودة للمشاهدة هي عالية الوضوح مع ترجمة واضحة، خصوصًا إذا كانت الصورة أو التفاصيل جزءًا من التوتر.';
}

function hookFor(genres, seed) {
  const hooks = [];
  if (hasGenre(genres, ['رعب'])) hooks.push('خطر يقترب من الشخصيات دون إنذار واضح');
  if (hasGenre(genres, ['جريمة', 'غموض'])) hooks.push('تحقيق يكشف أسرارًا صغيرة تقود إلى صدام أكبر');
  if (hasGenre(genres, ['أكشن'])) hooks.push('مطاردة وقرارات سريعة ترفع التوتر من البداية');
  if (hasGenre(genres, ['دراما'])) hooks.push('اختيارات شخصية تغيّر مسار العلاقات');
  if (hasGenre(genres, ['كوميديا'])) hooks.push('مواقف ذكية تكشف طباع الشخصيات');
  if (hasGenre(genres, ['رومانسي'])) hooks.push('علاقة تتبدل تحت ضغط الرغبة والخوف');
  if (hasGenre(genres, ['خيال علمي', 'فانتازيا'])) hooks.push('عالم مختلف يختبر حدود الواقع');
  if (hasGenre(genres, ['رياضي'])) hooks.push('منافسة ترفع قيمة كل قرار داخل الملعب');
  if (!hooks.length) hooks.push('قصة تتحرك من حدث واضح إلى صراع أكبر');
  return hooks[seed % hooks.length];
}

function wordCount(text) {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

function sentenceTrim(text, maxWords) {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}...`;
}

function cleanGenerated(text) {
  let value = normalize(text)
    .replace(/CINMAPRO/g, BRAND)
    .replace(/\bIMDb\b/g, 'قاعدة بيانات الأفلام')
    .replace(/["“”]/g, '')
    .replace(/\s+([،.؟])/g, '$1')
    .replace(/\.{2,}/g, '.');
  for (const phrase of BANNED) value = value.replaceAll(phrase, '');
  return arabicizeLatin(value).replace(/\s+/g, ' ').trim();
}

function plotFocus(plotAr, genres) {
  let clean = cleanGenerated(plotAr)
    .replace(/^تدور القصة حول\s+/u, '')
    .replace(/^تتبع القصة\s+/u, '')
    .replace(/^يحكي\s+/u, '');
  clean = clean
    .replace(/^تجد امرأة شابة تدعى\s+([^،.]+)\s+نفسها\s+/u, 'امرأة شابة تدعى $1 ')
    .replace(/^تستخدم المحامية\s+/u, 'محامية ')
    .replace(/^كوميديا\s+في\s+مكان\s+العمل\s+تتمحور\s+حول\s+/u, '')
    .replace(/^كل\s+1000\s+عام،\s*/u, 'مجلس الآلهة يجتمع كل 1000 عام، ')
    .replace(/^بعد اكتشافه أنه ابن الشيطان/u, 'شاب يكتشف أنه ابن الشيطان')
    .replace(/^مات مينامي ساتورو/u, 'مينامي ساتورو يموت')
    .replace(/محامية الذكية/u, 'محامية ذكية')
    .replace(/يجتمع كل 1000 عام، يجتمع مجلس الآلهة/u, 'يجتمع كل 1000 عام ليقرر مجلس الآلهة')
    .replace(/مجلس الآلهة يجتمع كل 1000 عام ليقرر مجلس الآلهة ليقرر/u, 'مجلس الآلهة يجتمع كل 1000 عام ليقرر')
    .replace(/عندما يكتشفون من هو$/u, 'عندما يكتشفون حقيقة الراعي وراء الحدث')
    .replace(/النجاح في[.،]?$/u, 'النجاح في الحياة')
    .replace(/[.،]+$/u, '');
  if (wordCount(clean) >= 12) return sentenceTrim(clean, 34);
  return challengeFor(genres, 'movie');
}

function mainDescription({ arabicTitle, type, year, genres, country, hero, plotAr, category }) {
  const challenge = challengeFor(genres, category);
  const focus = plotFocus(plotAr, genres);
  const craft = craftAngle(genres, category);
  const genreText = genres.join('، ');
  const sentences = [
    `${hero} يواجه ${challenge} في ${arabicTitle}.`,
    `يدور ${arabicTitle} حول ${focus}، لذلك تبدو الحكاية قريبة من المشاهد حتى عندما تتحرك داخل تصنيف ${genreText}.`,
    `ينتمي العمل إلى إنتاج ${country || 'دولي'} وبدأ عرضه عام ${year || 'غير محدد'}، وهذا يوضح سياق المكان وطبيعة الإيقاع.`,
    `${craft}.`,
    `ما يجعل ${arabicTitle} مختلفًا أن القصة تربط المواجهة بتفاصيل تخص ${hero} ومن يدورون حوله.`,
    `الأسلوب مباشر، كأنك تسمع الحكاية من صديق يخبرك بسبب المتابعة دون أن يحرق النهاية.`,
  ];
  let text = cleanGenerated(sentences.join(' '));
  const additions = [
    `كما أن وجود ${genreText} في قلب الحكاية يجعل كل مشهد مرتبطًا بنبرة محددة لا تصلح لعمل آخر.`,
    `ولهذا تفيدك صفحة ${BRAND} في معرفة الفكرة واللغة والجودة قبل الانتقال إلى المشاهدة.`,
    `النتيجة صفحة تعريفية تمنحك صورة دقيقة عن العمل من دون إطالة أو تكرار.`,
  ];
  let index = 0;
  while (wordCount(text) < 120 && index < additions.length) {
    text = cleanGenerated(`${text} ${additions[index]}`);
    index += 1;
  }
  return text;
}

function metaDescription({ arabicTitle, type, year, genres, seed }) {
  const fixedEnd = ` | شاهد مترجم HD على ${BRAND}`;
  const base = `${arabicTitle} ${type} ${year || ''} | `;
  const hooks = [
    hookFor(genres, seed),
    `${hookFor(genres, seed)} بتفاصيل قصة واضحة`,
    `${hookFor(genres, seed)} قبل المشاهدة`,
    `قصة ${genres[0] || 'درامية'} بملامح خاصة ومعلومات مختصرة`,
  ];
  for (const hook of hooks) {
    let text = cleanGenerated(`${base}${hook}${fixedEnd}`);
    if (text.length >= 140 && text.length <= 155) return text;
  }
  let hook = `${hookFor(genres, seed)} مع قصة وطاقم وتفاصيل مشاهدة واضحة`;
  let text = cleanGenerated(`${base}${hook}${fixedEnd}`);
  while (text.length > 155 && hook.includes(' ')) {
    hook = hook.split(' ').slice(0, -1).join(' ');
    text = cleanGenerated(`${base}${hook}${fixedEnd}`);
  }
  const pads = ['بتفاصيل دقيقة', 'ومعلومات مفيدة', 'قبل بدء المشاهدة', 'مع قصة واضحة'];
  let padIndex = 0;
  while (text.length < 140 && padIndex < pads.length) {
    hook = `${hook} ${pads[padIndex]}`;
    const candidate = cleanGenerated(`${base}${hook}${fixedEnd}`);
    if (candidate.length <= 155) text = candidate;
    padIndex += 1;
  }
  if (text.length < 140) {
    const candidate = text.replace(fixedEnd, ` مهمة${fixedEnd}`);
    if (candidate.length <= 155) text = candidate;
  }
  return text;
}

function highlights({ arabicTitle, genres, hero, plotAr, year, country, category }) {
  const focus = plotFocus(plotAr, genres);
  const craft = craftAngle(genres, category);
  const genreReason = hookFor(genres, year ? Number(year) : 0);
  return [
    `${arabicTitle} يستحق المتابعة لأن صراعه يدور حول ${focus} وليس حول مطاردة أو موقف عابر.`,
    `وجود ${hero} في مركز الحكاية يجعل القرارات مرتبطة بشخصية محددة يمكن تتبع خوفها أو طموحها من البداية.`,
    `تأتي قوة العمل من ${craft}، مع إنتاج ${country || 'دولي'} وتصنيف ${genres.join('، ')} يبرران ${genreReason}.`,
  ].map(cleanGenerated).join(' ');
}

function faqSecondQuestion(genres, arabicTitle, category) {
  if (category === 'anime' && hasGenre(genres, ['رياضي'])) return `هل يركز ${arabicTitle} على المباريات فقط؟`;
  if (category === 'anime' && hasGenre(genres, ['أكشن'])) return `ما طبيعة المواجهات في ${arabicTitle}؟`;
  if (hasGenre(genres, ['رعب'])) return `هل يعتمد ${arabicTitle} على الرعب المفاجئ؟`;
  if (hasGenre(genres, ['جريمة', 'غموض'])) return `ما زاوية التحقيق في ${arabicTitle}؟`;
  if (hasGenre(genres, ['خيال علمي', 'فانتازيا'])) return `ما الفكرة التي تميز عالم ${arabicTitle}؟`;
  if (hasGenre(genres, ['كوميديا'])) return `هل كوميديا ${arabicTitle} قائمة على المواقف؟`;
  if (hasGenre(genres, ['رومانسي'])) return `ما طبيعة العلاقة الأساسية في ${arabicTitle}؟`;
  return `ما العنصر الأبرز في ${arabicTitle}؟`;
}

function faqSecondAnswer(genres, arabicTitle, hero, category) {
  if (category === 'anime' && hasGenre(genres, ['رياضي'])) return `لا يكتفي ${arabicTitle} بالمنافسة، بل يربط كل مباراة بطموح الشخصيات وطريقة تغيرها بعد الفوز أو الخسارة.`;
  if (category === 'anime' && hasGenre(genres, ['أكشن'])) return `المواجهات في ${arabicTitle} مبنية على قدرات الشخصيات والرهان النفسي، لذلك لا تبدو الحركة منفصلة عن هدف ${hero}.`;
  if (hasGenre(genres, ['رعب'])) return `الرعب في ${arabicTitle} يميل إلى التوتر وبناء الخطر تدريجيًا، مع لحظات مفاجئة تخدم الحدث المحوري.`;
  if (hasGenre(genres, ['جريمة', 'غموض'])) return `زاوية التحقيق في ${arabicTitle} تقوم على قراءة الدوافع والقرائن الصغيرة قبل الوصول إلى المواجهة المباشرة.`;
  if (hasGenre(genres, ['خيال علمي', 'فانتازيا'])) return `يميز عالم ${arabicTitle} أن قواعده تؤثر في اختيارات الشخصيات، فلا تبقى الفكرة مجرد خلفية بصرية.`;
  if (hasGenre(genres, ['كوميديا'])) return `الكوميديا في ${arabicTitle} تعتمد على المواقف وردود الفعل، وهذا يجعل الطرافة مرتبطة بالشخصيات نفسها.`;
  if (hasGenre(genres, ['رومانسي'])) return `العلاقة في ${arabicTitle} تتحرك بين القرب والتردد، وتصبح اختيارات ${hero} جزءًا من التوتر العاطفي.`;
  return `العنصر الأبرز في ${arabicTitle} هو ارتباط الحدث الرئيسي بالشخصيات، بحيث يصبح كل قرار جزءًا من فهم القصة.`;
}

function faqs({ arabicTitle, type, hero, plotAr, genres, category }) {
  const answerStory = cleanGenerated(`تدور قصة ${arabicTitle} حول ${plotFocus(plotAr, genres)}، مع تركيز واضح على ${hero} وما يتغير حوله بعد الحدث المحوري.`);
  return [
    {
      question: cleanGenerated(`ما قصة ${arabicTitle}؟`),
      answer: answerStory,
    },
    {
      question: cleanGenerated(faqSecondQuestion(genres, arabicTitle, category)),
      answer: cleanGenerated(faqSecondAnswer(genres, arabicTitle, hero, category)),
    },
  ];
}

function beforeWatching({ title, arabicTitle, genres, category }) {
  return [
    cleanGenerated(familyPoint(genres)),
    cleanGenerated(continuityPoint(title, arabicTitle, category)),
    cleanGenerated(qualityPoint(category)),
  ];
}

function seedFrom(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function containsLatinOutsideAllowed(text) {
  return /\p{Script=Latin}/u.test(String(text).replaceAll(BRAND, '').replaceAll('HD', ''));
}

function validateSeo(seo) {
  const textFields = [
    seo.arabicTitle,
    seo.primaryCharacter,
    seo.mainDescription,
    seo.metaDescription,
    seo.highlights,
    ...(seo.beforeWatchingPoints || []),
    ...(seo.faqs || []).flatMap((faq) => [faq.question, faq.answer]),
  ];
  const latin = textFields.filter((field) => containsLatinOutsideAllowed(field));
  const banned = textFields.filter((field) => BANNED.some((phrase) => String(field).includes(phrase)));
  return { latin, banned };
}

async function main() {
  const cache = await readCache();
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json')).sort();
  let updated = 0;
  const warnings = [];

  for (const file of files) {
    const fullPath = path.join(titlesDir, file);
    const title = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    const match = await imdbSearch(title, cache);
    const facts = await imdbTitle(match?.id, cache);
    const arabicTitle = await arabicTitleFor(title, facts, cache);
    const genres = arabicGenres(title.category, facts, title);
    const country = arabicCountry(facts, title.country);
    const language = arabicLanguage(facts, title.language);
    const year = String(facts?.startYear || match?.startYear || title.year || '').trim();
    const plotSource = facts?.plot || title.story || title.description || baseTitle(title);
    const plotTranslated = await translate(plotSource, cache);
    const plotAr = cleanGenerated(plotTranslated || plotSource);
    const hero = cleanGenerated(primaryCharacter(title, facts, arabicTitle));
    const type = TYPE_LABEL[title.category] || title.category_label || 'عمل';
    const seed = seedFrom(title.slug);

    const seo = {
      generatedAt,
      arabicTitle,
      primaryCharacter: hero,
      mainDescription: mainDescription({
        arabicTitle,
        type,
        year,
        genres,
        country,
        hero,
        plotAr,
        category: title.category,
      }),
      metaDescription: metaDescription({ arabicTitle, type, year, genres, seed }),
      highlights: highlights({ arabicTitle, genres, hero, plotAr, year, country, category: title.category }),
      beforeWatchingPoints: beforeWatching({ title, arabicTitle, genres, category: title.category }),
      faqs: faqs({ arabicTitle, type, hero, plotAr, genres, category: title.category }),
      sources: {
        imdb: facts?.id ? `https://www.imdb.com/title/${facts.id}/` : match?.id ? `https://www.imdb.com/title/${match.id}/` : null,
        imdbApi: facts?.id ? `https://api.imdbapi.dev/titles/${facts.id}` : null,
        wikipedia: title.seoContent?.sources?.wikipedia || null,
        myAnimeList: title.seoContent?.sources?.myAnimeList || null,
        rottenTomatoes: title.seoContent?.sources?.rottenTomatoes || null,
      },
    };

    const validation = validateSeo(seo);
    if (validation.latin.length || validation.banned.length) {
      warnings.push({
        slug: title.slug,
        latin: validation.latin.map((value) => String(value).slice(0, 120)),
        banned: validation.banned.map((value) => String(value).slice(0, 120)),
      });
    }

    const next = {
      ...title,
      year: year || title.year,
      genre: genres.join('، ') || title.genre,
      country: country || title.country,
      language,
      rating: facts?.rating?.aggregateRating ?? title.rating ?? title.imdb_rating ?? null,
      imdb_rating: facts?.rating?.aggregateRating ?? title.imdb_rating ?? title.rating ?? null,
      duration: title.category === 'movie' ? runtimeLabel(facts, title.duration) : title.duration,
      director: peopleArabic(facts?.directors) || title.director,
      stars: peopleArabic(facts?.stars) || title.stars,
      story: plotAr || title.story,
      description: plotAr || title.description,
      seoContent: seo,
    };

    await fs.writeFile(fullPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    updated += 1;
    console.log(`${updated}/${files.length} ${title.category} ${title.slug} -> ${facts?.id || match?.id || 'no-imdb-id'}`);
    if (updated % 10 === 0) await writeCache(cache);
  }

  await writeCache(cache);
  if (warnings.length) {
    console.warn(JSON.stringify({ warnings: warnings.slice(0, 20), count: warnings.length }, null, 2));
  }
  console.log(`Updated ${updated} titles.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
