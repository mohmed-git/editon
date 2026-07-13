// ============================================================================
// أدوات المطابقة والاستيراد المشتركة — سينما لايف (المهام 4 و5)
// ----------------------------------------------------------------------------
// - تنظيف أسماء الأعمال من ضجيج الاستيراد (الحلقة X، مترجم، انمي/مسلسل/فلم…)
// - بناء فهرس مطابقة من titles/details الحالية (بالاسمين العربي والإنجليزي)
// - دالة مطابقة تُعيد id العمل الموجود أو null
// ============================================================================

// تطبيع اسم للمقارنة (يُزيل التشكيل واللواحق ويوحّد الحروف اللاتينية المزخرفة)
export function normKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[’'`´]/g, "'")
    .replace(/[üûùúū]/g, 'u').replace(/[éèêëē]/g, 'e').replace(/[áàâäā]/g, 'a')
    .replace(/[íìîï]/g, 'i').replace(/[óòôöō]/g, 'o').replace(/[çč]/g, 'c').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// إزالة الضجيج من clean_title / category / anime_title لاستخراج اسم العمل فقط
const NOISE_AR = /(الحلقة\s*\d+.*$|الموسم\s*(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)|مترجم(ة)?|اون\s*لاين|مشاهدة|كامل(ة)?|بجودة عالية|الجزء\s*\S+|اونلاين)/g;
const NOISE_TYPE = /^\s*(انمي|أنمي|مسلسل|فيلم|فلم|برنامج|عرض)\s+/;
const NOISE_EN = /\b(the movie|movie|season\s*\d+|\d+(st|nd|rd|th)\s*season|part\s*\d+|ova|ona|special|tv|dub|sub|مدبلج)\b/gi;

// فكّ HTML entities الشائعة
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

// صفحات تصنيف/فهرسة من المواقع المصدر — ليست أعمالاً، تُتجاهل عند الإنشاء
const JUNK_NAMES = new Set([
  'المضاف حديثا', 'المضاف حديثاً', 'الافلام الاعلي تقييما imdb', 'المسلسلات الاعلي تقييما imdb',
  'الافلام الاعلى تقييما imdb', 'المسلسلات الاعلى تقييما imdb', 'قائمة الافلام', 'قائمة المسلسلات',
  'الاكثر مشاهدة', 'قيد العرض', 'اخر الحلقات',
]);
export function isJunkWorkName(name) {
  const n = normKey(extractWorkName(name));
  return JUNK_NAMES.has(n) || n.length < 2;
}

export function extractWorkName(raw) {
  let s = decodeEntities(raw);
  s = s.replace(NOISE_AR, ' ');
  s = s.replace(NOISE_TYPE, ' ');
  // بادئات أنمي شائعة: اوفا / اونا / أوفا / أوفا / OVA / ONA في بداية الاسم
  s = s.replace(/^\s*(اوفا|أوفا|اونا|أونا|الحلقة الخاصة|حلقة خاصة|ova|ona|special)\s+/i, ' ');
  // علامات ترقيم زائدة في الأطراف
  s = s.replace(/^[\s:،.\-–—]+/, '').replace(/[\s:،.\-–—]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// استخراج النوع من نص الفئة/الاسم
export function detectType(raw) {
  const s = String(raw || '');
  if (/^\s*(انمي|أنمي)/.test(s) || /\banime\b/i.test(s)) return 'anime';
  if (/^\s*(فيلم|فلم)/.test(s) || /\bmovie\b/i.test(s)) return 'movie';
  if (/^\s*مسلسل/.test(s)) return 'series';
  return null;
}

// بناء فهرس المطابقة من titles + details
export function buildMatchIndex(titles, details) {
  // key مُطبّع -> [ids] ؛ نُفهرس بالاسم الإنجليزي والعربي وoriginalTitle
  const byName = new Map();
  const add = (key, id) => {
    const k = normKey(key);
    if (k.length < 2) return;
    if (!byName.has(k)) byName.set(k, new Set());
    byName.get(k).add(id);
  };
  for (const id in titles) {
    const t = titles[id];
    const d = details[id];
    add(t.title, id);
    add(t.titleEn, id);
    if (d?.originalTitle) add(d.originalTitle, id);
    // نسخة بلا لواحق (season/part) للاسم الأجنبي
    add(String(t.title).replace(NOISE_EN, ' '), id);
    add(String(t.titleEn).replace(NOISE_EN, ' '), id);
  }
  return byName;
}

// مطابقة اسم عمل مع الفهرس. يُعيد {id, ambiguous} أو null.
// نراعي النوع (إن مُرِّر) والسنة (إن توفّرت) لترجيح الأفضل.
export function matchWork(index, titles, name, opts = {}) {
  const { type = null, year = null } = opts;
  const clean = extractWorkName(name);
  const candidates = new Set();
  for (const key of [clean, String(clean).replace(NOISE_EN, ' ')]) {
    const k = normKey(key);
    const set = index.get(k);
    if (set) for (const id of set) candidates.add(id);
  }
  if (!candidates.size) return null;
  const arr = [...candidates];
  // ترجيح: نفس النوع أولاً، ثم أقرب سنة
  const scored = arr.map((id) => {
    const t = titles[id];
    let s = 0;
    if (type && t.type === type) s += 100;
    if (year && t.year) s += Math.max(0, 10 - Math.abs(t.year - year));
    return { id, s, t };
  }).sort((a, b) => b.s - a.s);
  return { id: scored[0].id, ambiguous: arr.length > 1, count: arr.length };
}
