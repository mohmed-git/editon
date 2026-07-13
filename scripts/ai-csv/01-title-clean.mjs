// ============================================================================
// تنظيف العناوين واستخراج الاسم الإنجليزي + العربي المُعرّب
// يحل المهام: 1a (أسماء شائعة) + 1d (إزالة الضجيج/التعريب)
// ============================================================================

// كلمات الضجيج التسويقي التي تُحذف من كل العناوين
const NOISE_PATTERNS = [
  /مترجم\s*اون\s*لاين/gi,
  /مشاهدة\s*وتحميل/gi,
  /اون\s*لاين/gi,
  /مترجم/gi,
  /مدبلج/gi,
  /مشاهدة/gi,
  /تحميل/gi,
  /بجودة\s*عالية/gi,
  /جودة\s*عالية/gi,
  /كامل[ةه]?/gi,
  /الحلق[ةه]\s*الاخير[ةه]/gi,
];

// بادئات نوع الإصدار (تُستخرج كنوع، وتُزال من الاسم)
// تُعاد كـ { kind, rest }
const ENTRY_PREFIXES = [
  { re: /^\s*الحلقة\s*الخاصة\s*/i, kind: 'special' },
  { re: /^\s*اوفا\s*/i, kind: 'ova' },
  { re: /^\s*أوفا\s*/i, kind: 'ova' },
  { re: /^\s*اونا\s*/i, kind: 'ona' },
  { re: /^\s*أونا\s*/i, kind: 'ona' },
  { re: /^\s*فيلم\s*/i, kind: 'movie' },
  { re: /^\s*film\s*/i, kind: 'movie' },
  { re: /^\s*ova\s*/i, kind: 'ova' },
  { re: /^\s*ona\s*/i, kind: 'ona' },
  { re: /^\s*movie\s*/i, kind: 'movie' },
  { re: /^\s*special\s*/i, kind: 'special' },
];

const AR_CHARS = /[\u0600-\u06FF]/;

// يزيل الضجيج من نص
function stripNoise(t) {
  let s = t;
  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// يستخرج بادئة النوع من بداية العنوان
function extractPrefix(t) {
  let kind = null;
  let s = t.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of ENTRY_PREFIXES) {
      if (p.re.test(s)) {
        if (!kind) kind = p.kind;
        s = s.replace(p.re, '').trim();
        changed = true;
        break;
      }
    }
  }
  return { kind, rest: s };
}

// يستخرج السنة (1900–2035)
function extractYear(t) {
  const m = t.match(/\b(19\d{2}|20[0-3]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// يفصل الكلمات إلى عربي ولاتيني، مع الحفاظ على الترتيب داخل كل مجموعة
function splitArEn(text) {
  // نعالج المقاطع بين الأقواس بشكل خاص لاحقاً؛ هنا فصل بسيط بالكلمات
  const words = text.split(/\s+/).filter(Boolean);
  const ar = [];
  const en = [];
  for (const w of words) {
    // كلمة بها حرف عربي → عربية، غير ذلك → لاتينية
    if (AR_CHARS.test(w)) ar.push(w);
    else en.push(w);
  }
  return {
    ar: ar.join(' ').replace(/[\s,–_-]+$/,'').replace(/^[\s,–_-]+/,'').trim(),
    en: en.join(' ').replace(/[\s,–_-]+$/,'').replace(/^[\s,–_-]+/,'').trim(),
  };
}

// من عنوان فيه أقواس مثل: "Solo Leveling (Ore dake Level Up na Ken)"
// نفضّل الجزء خارج الأقواس (الاسم الشائع) للإنجليزي، ونهمل الياباني داخل الأقواس.
function preferCommonName(en) {
  if (!en) return en;
  // لو فيه "(...)" ناخد اللي قبل القوس لو كان له طول معقول
  const idx = en.indexOf('(');
  if (idx > 0) {
    const before = en.slice(0, idx).trim().replace(/[:：\-–]\s*$/,'').trim();
    if (before.length >= 2) return before;
  }
  // شيل الأقواس المتبقية
  return en.replace(/\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * ينظّف عنواناً خاماً من الـ CSV.
 * المدخلات: full_title (الأصلي) و base_title (منظّف نسبياً من الملف)
 * المخرجات: { titleEn (الاسم اللاتيني/الشائع), titleAr (المُعرّب), year, entryKind }
 */
export function cleanTitle(full_title, base_title = '') {
  const rawFull = (full_title || '').trim();
  const rawBase = (base_title || '').trim();

  // 1) استخرج النوع من البادئة
  const { kind, rest: afterPrefix } = extractPrefix(rawFull);

  // 2) استخرج السنة
  const year = extractYear(afterPrefix);

  // 3) شيل الضجيج + السنة من النص
  let cleaned = stripNoise(afterPrefix);
  cleaned = cleaned.replace(/\b(19\d{2}|20[0-3]\d)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 4) افصل العربي عن اللاتيني
  let { ar, en } = splitArEn(cleaned);

  // 4.5) تنظيف ضجيج متبقٍّ بعد الفصل (كلمات عربية مفردة عالقة)
  ar = stripNoise(ar);
  en = stripNoise(en);

  // 5) فضّل الاسم الشائع (خارج الأقواس) للاتيني
  en = preferCommonName(en);
  // نظّف بقايا الأقواس/الرموز
  en = en.replace(/[（）]/g, '').replace(/\s{2,}/g, ' ').trim();
  ar = ar.replace(/[（）]/g, '').replace(/\s{2,}/g, ' ').trim();

  // 6) fallback من base_title لو الناتج فاضي
  if (!en && !ar && rawBase) {
    const b = splitArEn(stripNoise(rawBase));
    en = preferCommonName(b.en);
    ar = b.ar;
  }

  return {
    titleEn: en,        // الاسم اللاتيني/الشائع (يُخزَّن في حقل title بالموقع)
    titleAr: ar,        // الاسم العربي المُعرّب (يُخزَّن في حقل titleEn بالموقع)
    year,
    entryKind: kind,    // movie|ova|ona|special|null
  };
}

// اختبار سريع عند التشغيل المباشر
if (import.meta.url === `file://${process.argv[1]}`) {
  const tests = [
    ['Solo Leveling (Ore dake Level Up na Ken)', 'Solo Leveling (Ore dake Level Up na Ken)'],
    ['Solo Leveling Season 2: Arise from the Shadow (Ore dake Level Up na Ken Season 2)', ''],
    ['27 Nights 2025 مترجم اون لاين', '27 Nights 2025'],
    ['فيلم Berserk: Ougon Jidai-hen II - Doldrey Kouryaku مترجم', ''],
    ['أونا Chuunibyou demo Koi ga Shitai! Lite', ''],
    ['القيمة المطلقة للحب Absolute Value of Romance', ''],
    ['اوفا ACCA: 13-ku Kansatsu-ka - Regards', ''],
  ];
  for (const [f, b] of tests) {
    const r = cleanTitle(f, b);
    console.log('IN :', f);
    console.log('OUT: EN=%o | AR=%o | year=%o | kind=%o', r.titleEn, r.titleAr, r.year, r.entryKind);
    console.log('');
  }
}
