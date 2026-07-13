// ============================================================================
// تطبيع مفاتيح الـ franchise: دمج الأعمال المتفرّقة التي هي نفس السلسلة
// يحل المهمة 1b (ربط المواسم) — خاصةً حالات مثل Solo Leveling S2
// ============================================================================

// يطبّع اسماً أساسياً لاستخدامه كمفتاح دمج
// يزيل: الأقواس، علامات الموسم، الرموز، الياباني الزائد
export function normalizeBase(base_title, titleEn) {
  // نفضّل الاسم الإنجليزي المنظّف إن وُجد
  let t = (titleEn || base_title || '').toLowerCase();
  // شيل ما بين الأقواس (غالباً الاسم الياباني)
  t = t.replace(/\([^)]*\)/g, ' ');
  // شيل علامات الموسم بكل صيغها
  t = t.replace(/\bseason\s*\d+\b/gi, ' ');
  t = t.replace(/\b\d+(st|nd|rd|th)\s*season\b/gi, ' ');
  t = t.replace(/\bs\d+\b/gi, ' ');
  t = t.replace(/\bpart\s*\d+\b/gi, ' ');
  t = t.replace(/الموسم\s*\S+/g, ' ');
  t = t.replace(/الجزء\s*\S+/g, ' ');
  // شيل العناوين الفرعية بعد ':' أو '-' الطويلة (نحتفظ بالأساس فقط) — بحذر
  // نطبّع الرموز إلى مسافات
  t = t.replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// قاموس دمج يدوي للحالات المعروفة التي لا يلتقطها التطبيع الآلي
// المفتاح: normalizeBase => franchise موحّد مقصود
// نستخدمه لدمج franchise_keys مختلفة تحت راية واحدة عند التطابق
export const MANUAL_MERGE = {
  // Solo Leveling: الموسم 2 له عنوان فرعي مختلف "Arise from the Shadow"
  'solo leveling': 'solo-leveling',
  'solo leveling arise from the shadow': 'solo-leveling',
  'ore dake level up na ken': 'solo-leveling',
  'ore dake level up na ken arise from the shadow': 'solo-leveling',
};

/**
 * يبني خريطة: franchise_key الأصلي => franchise موحّد
 * works: مصفوفة { work_id, franchise_key, base_title, titleEn, season_number, entry_type, category }
 * القاعدة: أي franchise_keys تشترك في normalizeBase يتم دمجها،
 *          بشرط أن تكون من نفس الـ category (نتجنّب دمج فيلم بأنمي بالخطأ عند تشابه الاسم).
 */
export function buildFranchiseMap(works) {
  // اجمع كل franchise_key مع: normBase, categories, count
  const fkInfo = new Map(); // fk => { norms:Set, cats:Set }
  for (const w of works) {
    const fk = w.franchise_key;
    if (!fkInfo.has(fk)) fkInfo.set(fk, { norms: new Set(), cats: new Set() });
    const info = fkInfo.get(fk);
    const nb = normalizeBase(w.base_title, w.titleEn);
    info.norms.add(nb);
    info.cats.add(w.category);
  }

  // اربط normBase => قائمة franchise_keys (لنفس الـ category)
  // نستخدم مفتاح = normBase + '|' + category الأساسي
  const normToFks = new Map();
  for (const [fk, info] of fkInfo) {
    // ناخد أطول norm (الأكثر تحديداً) كتمثيل
    const primaryNorm = [...info.norms].sort((a, b) => b.length - a.length)[0] || '';
    const cat = [...info.cats][0] || '';
    if (primaryNorm.length < 3) continue; // تجاهل الأسماء القصيرة جداً (زي "2025")
    const key = primaryNorm + '||' + cat;
    if (!normToFks.has(key)) normToFks.set(key, []);
    normToFks.get(key).push(fk);
  }

  // ابنِ خريطة الدمج: كل مجموعة franchise_keys بنفس (norm+cat) => أقصر/أنظف fk كممثّل
  const merge = new Map(); // fk_original => fk_canonical
  for (const [, fks] of normToFks) {
    if (fks.length <= 1) continue;
    // اختر canonical = الأقصر (غالباً الأنظف/الأساس)
    const canonical = [...fks].sort((a, b) => a.length - b.length)[0];
    for (const fk of fks) merge.set(fk, canonical);
  }

  // طبّق الدمج اليدوي (يتفوّق على الآلي)
  const manualCanon = new Map(); // targetName => canonical fk فعلي
  for (const w of works) {
    const nb = normalizeBase(w.base_title, w.titleEn);
    if (MANUAL_MERGE[nb]) {
      const target = MANUAL_MERGE[nb];
      // canonical = أول fk فعلي نلاقيه لهذا الهدف، أو نفس الاسم
      if (!manualCanon.has(target)) manualCanon.set(target, w.franchise_key);
    }
  }
  for (const w of works) {
    const nb = normalizeBase(w.base_title, w.titleEn);
    if (MANUAL_MERGE[nb]) {
      const target = MANUAL_MERGE[nb];
      const canonical = manualCanon.get(target);
      if (canonical) merge.set(w.franchise_key, canonical);
    }
  }

  return merge; // fk => canonical fk (الغائبون = بلا تغيير)
}

// اختبار مباشر
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('solo leveling ->', normalizeBase('Solo Leveling (Ore dake Level Up na Ken)', 'Solo Leveling'));
  console.log('solo s2 ->', normalizeBase('Solo Leveling : Arise from the Shadow', 'Solo Leveling Season 2: Arise from the Shadow'));
  console.log('boku ->', normalizeBase('Boku no Hero Academia 6th Season', 'Boku no Hero Academia'));
}
