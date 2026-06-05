import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const BRAND = 'CINMAPRO';

const banned = [
  'تجربة سينمائية',
  'يتألق',
  'روائع',
  'الأهم هو النبرة',
  'يمنح المشاهد مساحة',
  'يقدم هذا العمل',
  'لا تبدو القصة',
];

const kindLabel = {
  movie: 'فيلم',
  series: 'مسلسل',
  anime: 'أنمي',
};

const familyRisk = [
  ['رعب', 'إثارة', 'جريمة', 'أكشن'], 'يفضل أن يراجعه المشاهد قبل المشاهدة العائلية بسبب التوتر أو المواجهات.',
  ['كوميديا', 'عائلي', 'رومانسي'], 'قد يناسب المشاهدة العائلية مع مراعاة التصنيف العمري والتفاصيل الحوارية.',
  ['دراما'], 'يناسب من يفضل الدراما الهادئة، مع الانتباه لطبيعة الموضوع قبل عرضه عائليا.',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBrandNoise(text) {
  let clean = normalize(text)
    .replace(/Flixora/gi, BRAND)
    .replace(/Cinmapro/g, BRAND);
  for (const marker of [`على ${BRAND}`, `عبر ${BRAND}`, 'متاح للمشاهدة', 'استمتع بمشاهدته', 'تقدمه لكم منصة', 'تقدّمه لكم منصّة']) {
    const idx = clean.indexOf(marker);
    if (idx > 30) clean = clean.slice(0, idx);
  }
  for (const phrase of banned) clean = clean.replaceAll(phrase, '');
  return normalize(clean.replace(/[،,\-—\s]+$/u, '').replace(/\.+$/u, ''));
}

function words(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function limitWords(text, max) {
  const parts = words(text);
  if (parts.length <= max) return parts.join(' ');
  return `${parts.slice(0, max).join(' ')}...`;
}

function clampChars(text, max) {
  const clean = normalize(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : max - 1).trim()}...`;
}

function baseTitle(title) {
  let name = normalize(title.clean_title || title.raw_name || title.slug);
  if (title.year) name = name.replace(new RegExp(`\\s*${title.year}\\b.*$`), '').trim();
  name = name
    .replace(/^(فيلم|مسلسل|انمي|أنمي)\s+/u, '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .trim();
  return name || normalize(title.clean_title);
}

function firstPerson(value) {
  return normalize(value).split(/[\/،,]+/).map((v) => v.trim()).filter(Boolean)[0] || '';
}

function genreText(title, facts) {
  const fromFacts = Array.isArray(facts.imdb?.genre) ? facts.imdb.genre.join('، ') : '';
  return normalize(title.genre || fromFacts || (title.category === 'anime' ? 'أنمي' : 'دراما'));
}

function countryText(title) {
  return normalize(title.country || (title.category === 'anime' ? 'اليابان' : ''));
}

function familySentence(genres) {
  for (let i = 0; i < familyRisk.length; i += 2) {
    if (familyRisk[i].some((key) => genres.includes(key))) return familyRisk[i + 1];
  }
  return 'يفضل مراجعة التصنيف العمري لأن ملاءمته للعائلة ترتبط بحدة الموضوع وطريقة عرضه.';
}

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CINMAPRO SEO research; contact: cinmapro.site',
        'Accept-Language': 'en-US,en;q=0.8,ar;q=0.7',
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CINMAPRO SEO research; contact: cinmapro.site',
        'Accept-Language': 'en-US,en;q=0.8,ar;q=0.7',
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function imdbFacts(title, name) {
  const query = encodeURIComponent(`${name} ${title.year || ''}`.trim());
  const first = encodeURIComponent(name.trim()[0]?.toLowerCase() || 'a');
  const suggest = await fetchJson(`https://v2.sg.media-imdb.com/suggestion/${first}/${query}.json`);
  const candidates = suggest?.d || [];
  const match = candidates.find((item) => {
    const yearOk = !title.year || String(item.y || '').includes(String(title.year));
    const type = String(item.qid || item.q || '').toLowerCase();
    const typeOk = title.category === 'movie' ? type.includes('movie') || type.includes('feature') : type.includes('tv') || type.includes('series');
    return item.id && yearOk && (typeOk || candidates.length === 1);
  }) || candidates.find((item) => item.id) || null;
  if (!match?.id) return null;

  const url = `https://www.imdb.com/title/${match.id}/`;
  const html = await fetchText(url);
  let ld = null;
  if (html) {
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (script) {
      try {
        ld = JSON.parse(script[1]);
      } catch {
        ld = null;
      }
    }
  }
  return {
    url,
    id: match.id,
    name: normalize(ld?.name || match.l || name),
    description: stripBrandNoise(ld?.description || ''),
    actor: Array.isArray(ld?.actor) ? ld.actor.map((a) => normalize(a.name)).filter(Boolean).slice(0, 5) : [],
    director: Array.isArray(ld?.director) ? ld.director.map((d) => normalize(d.name)).filter(Boolean).join('، ') : normalize(ld?.director?.name || ''),
    genre: Array.isArray(ld?.genre) ? ld.genre.map(normalize).filter(Boolean) : [],
  };
}

async function wikipediaFacts(title, name) {
  const kindHint = title.category === 'movie' ? 'film' : title.category === 'anime' ? 'anime' : 'television series';
  const search = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} ${kindHint}`)}&format=json&origin=*`);
  const page = search?.query?.search?.[0]?.title;
  if (!page) return null;
  const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`);
  return {
    url: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.replaceAll(' ', '_'))}`,
    title: normalize(summary?.title || page),
    extract: stripBrandNoise(summary?.extract || ''),
  };
}

async function malFacts(title, name) {
  if (title.category !== 'anime') return null;
  const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&limit=1`);
  const item = data?.data?.[0];
  if (!item) return null;
  return {
    url: item.url,
    title: normalize(item.title_english || item.title || name),
    synopsis: stripBrandNoise(item.synopsis || ''),
    studio: item.studios?.map((s) => s.name).filter(Boolean).join('، ') || '',
  };
}

async function rottenTomatoesFacts(name) {
  const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(name)}`;
  const html = await fetchText(url);
  if (!html) return null;
  const hasTitle = html.toLowerCase().includes(name.toLowerCase().split(':')[0]);
  return {
    url,
    note: hasTitle ? 'تمت مراجعة صفحة البحث في Rotten Tomatoes للتحقق من الحضور النقدي عند توفره.' : 'لم تظهر صفحة عمل مؤكدة بسهولة في Rotten Tomatoes، فاعتمد النص على المصادر الأوثق المتاحة.',
  };
}

function sourceStory(title, facts) {
  return stripBrandNoise(
    facts.imdb?.description ||
    facts.mal?.synopsis ||
    facts.wikipedia?.extract ||
    title._original_story ||
    title.story ||
    title.description ||
    ''
  );
}

function buildMainDescription(title, facts) {
  const name = baseTitle(title);
  const kind = kindLabel[title.category] || 'عمل';
  const genres = genreText(title, facts);
  const country = countryText(title);
  const story = limitWords(sourceStory(title, facts), 42);
  const lead = firstPerson(facts.imdb?.actor?.join('، ') || title.stars) || (title.category === 'anime' ? 'البطل الرئيسي' : 'الشخصية الرئيسية');
  const director = normalize(facts.imdb?.director || title.director);
  const unique = title.category === 'anime'
    ? `يميز ${name} أنه يبني الصراع على مواجهات بين البشر والآلهة أو بين إرادات متصادمة، مع اعتماد واضح على تصميم القتال وتتابع الحلقات.`
    : genres.includes('كوميد')
      ? `يميز ${name} أنه يستخدم الموقف والشخصيات لصناعة المفارقة بدل الاعتماد على النكات المنفصلة فقط.`
      : genres.includes('رعب') || genres.includes('إثارة') || genres.includes('جريمة')
        ? `يميز ${name} أنه يربط الخطر بتفاصيل القصة لا بالمفاجأة السريعة وحدها.`
        : `يميز ${name} أنه يضع اختيارات الشخصيات في قلب الحكاية بدل الاكتفاء بخط أحداث مباشر.`;
  const context = [
    country ? `ينتمي العمل إلى إنتاج ${country}` : '',
    title.year ? `صدر عام ${title.year}` : '',
    director ? `ويرتبط باسم ${director} خلف الكاميرا أو في صناعة العمل` : '',
  ].filter(Boolean).join('، ');
  const text = `${story || `تبدأ أحداث ${name} من صراع يغيّر مسار الشخصية الرئيسية`}، ويجد ${lead} نفسه أمام اختبار يضغط على قراراته وعلاقاته بمن حوله. ${name} ${kind} ضمن تصنيف ${genres}، ${context || 'مع تركيز واضح على القصة والشخصيات'}. لا يعتمد العمل على عنوانه فقط؛ بل على الطريقة التي تتدرج بها الأحداث وتكشف دوافع الشخصيات خطوة بعد أخرى. ${unique} على صفحة ${BRAND} تجد بيانات القصة والطاقم والجودة والتريلر في موضع واحد قبل فتح المشاهدة، وهذا يجعل اختيار ${name} أوضح لمن يبحث عن عمل قريب من هذا التصنيف.`;
  return limitWords(text, 155);
}

function buildMetaDescription(title) {
  const name = baseTitle(title);
  const kind = kindLabel[title.category] || 'عمل';
  const year = title.year || '';
  return clampChars(`${name} ${kind} ${year} — قصة مشوقة ومعلومات كاملة — شاهد اون لاين بجودة عالية على ${BRAND}`, 155);
}

function buildHighlights(title, facts) {
  const name = baseTitle(title);
  const genres = genreText(title, facts);
  const lead = firstPerson(facts.imdb?.actor?.join('، ') || title.stars);
  const source = sourceStory(title, facts);
  const director = normalize(facts.imdb?.director || title.director);
  const sentences = [
    `${name} يستحق المشاهدة لأن قصته تتحرك حول ${limitWords(source, 18)} بدل الاكتفاء بعنوان عام.`,
    lead ? `وجود ${lead} في مقدمة الأسماء يمنح العمل نقطة متابعة واضحة داخل صراع ${genres}.` : `تصنيف ${genres} يحدد نوع الصراع ويجعل الصفحة مفيدة لمن يبحث عن هذا اللون تحديدا.`,
    director ? `ارتباط العمل باسم ${director} يساعد على فهم اختيارات الإخراج أو بناء الحلقات قبل المشاهدة.` : `المعلومات المجموعة من IMDb وWikipedia تجعل القصة والطاقم والسياق أوضح قبل الانتقال للمشاهدة.`,
  ];
  return sentences.join(' ');
}

function buildBeforeWatching(title, facts) {
  const name = baseTitle(title);
  const genres = genreText(title, facts);
  const continuity = title.category === 'movie'
    ? 'لا يحتاج غالبا إلى مشاهدة عمل سابق إلا إذا كان مرتبطا بسلسلة تحمل الاسم نفسه.'
    : 'الأفضل البدء من الموسم الأول لأن ترتيب الحلقات يؤثر في فهم العلاقات والتطورات.';
  const quality = title.quality ? `أفضل مشاهدة تكون بجودة ${title.quality} حتى تظهر الترجمة والتفاصيل بوضوح.` : 'أفضل مشاهدة تكون بجودة عالية مع ترجمة واضحة.';
  return `${familySentence(genres)} ${continuity} ${name} مناسب أكثر لمن يتابع تصنيف ${genres}. ${quality}`;
}

function buildFaqs(title, facts) {
  const name = baseTitle(title);
  const kind = kindLabel[title.category] || 'عمل';
  const story = limitWords(sourceStory(title, facts), 34);
  const smartQuestion = title.category === 'anime'
    ? `هل يعتمد ${name} على القتال فقط؟`
    : title.category === 'series'
      ? `هل يحتاج ${name} إلى متابعة الحلقات بالترتيب؟`
      : `ما الذي يجعل ${name} مختلفا داخل تصنيفه؟`;
  const smartAnswer = title.category === 'anime'
    ? `لا، فجانب القتال حاضر بوضوح، لكن متابعة الدوافع وخلفيات الشخصيات ضرورية لفهم أثر كل مواجهة.`
    : title.category === 'series'
      ? `نعم، لأن تطور الشخصيات والعلاقات يظهر تدريجيا، وتجاوز الحلقات قد يضعف فهم بعض القرارات.`
      : `اختلافه يأتي من طريقة ربط الفكرة بالشخصيات والجو العام، مع اعتماد أقل على الوصف السريع للأحداث.`;
  return [
    { question: `ما قصة ${kind} ${name}؟`, answer: `تدور قصة ${name} حول ${story}، وتعرض صفحة ${BRAND} المعلومات الأساسية عن القصة والطاقم والجودة والتريلر دون حرق مباشر للأحداث.` },
    { question: smartQuestion, answer: smartAnswer },
  ];
}

async function research(title) {
  const name = baseTitle(title);
  const facts = {};
  facts.imdb = await imdbFacts(title, name);
  await sleep(120);
  facts.wikipedia = await wikipediaFacts(title, name);
  await sleep(120);
  facts.mal = await malFacts(title, name);
  if (title.category === 'anime') await sleep(450);
  facts.rottenTomatoes = await rottenTomatoesFacts(name);
  return facts;
}

async function main() {
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'ar'));
  let updated = 0;
  let index = 0;
  for (const file of files) {
    index += 1;
    const fullPath = path.join(titlesDir, file);
    const title = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    if (
      title.seoContent?.mainDescription &&
      title.seoContent?.metaDescription &&
      title.seoContent?.highlights &&
      title.seoContent?.beforeWatching &&
      Array.isArray(title.seoContent?.faqs) &&
      title.seoContent.faqs.length >= 2
    ) {
      console.log(`[${index}/${files.length}] ${baseTitle(title)} -> skipped`);
      continue;
    }
    const facts = await research(title);
    title.seoContent = {
      generatedAt: new Date().toISOString().slice(0, 10),
      mainDescription: buildMainDescription(title, facts),
      metaDescription: buildMetaDescription(title),
      highlights: buildHighlights(title, facts),
      beforeWatching: buildBeforeWatching(title, facts),
      faqs: buildFaqs(title, facts),
      sources: {
        imdb: facts.imdb?.url || null,
        wikipedia: facts.wikipedia?.url || null,
        myAnimeList: facts.mal?.url || null,
        rottenTomatoes: facts.rottenTomatoes?.url || null,
      },
    };
    await fs.writeFile(fullPath, `${JSON.stringify(title, null, 2)}\n`, 'utf8');
    updated += 1;
    console.log(`[${index}/${files.length}] ${baseTitle(title)} -> SEO content`);
  }
  console.log(`Updated ${updated} titles.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
