// ============================================================================
// قائمة الحظر الدائمة — سينما لايف
// ----------------------------------------------------------------------------
// أسماء أعمال شبه إباحية / غير مرغوبة يمنع ظهورها على الموقع نهائياً، حتى لو
// دخلت لاحقاً عبر ملفات الاستيراد (CSV). المطابقة تتم على الاسم + السنة بدقة.
// كل سطر: "الاسم" أو "الاسم | السنة".
// ============================================================================

// أسماء يُحذف العمل إن طابقها بالاسم الكامل (بغضّ النظر عن السنة) — أعمال محددة.
export const BLOCK_EXACT = [
  // دفعة المستخدم الأخيرة (6 أعمال أكّد وجودها وطلب حذفها)
  '10 Dance',
  '1000 Men and Me The Bonnie Blue Story',
  '3 Days of the Condor',
  '40 Days and 40 Nights',
  '9 Songs',
  'تحرر من القيود',
  'Rüzgara Birak',
];

// قوائم الحذف الأصلية (شبه إباحية) — تُستعمل كحاجز وقائي دائم ضد الاستيراد.
// حتى لو لم تكن موجودة الآن، فلن يُسمح بإنشائها من CSV مستقبلاً.
export const BLOCK_LIST = [
  'Balahibong pusa','Scorpio Nights 4','Bulong ng laman','Sipsipan','Belyas','Basang-basa',
  'Bagong Tukso','Sa gabing mainit','Pihit','Next Room Affair','Foreign Exchange','Trianggulo',
  'Breast Friends Forever','Mayumi','Chunhyang','The Golden Lotus: Love and Desire','Pansamantala',
  "Boss Ma'am",'The Harmonium in My Memory','The Concubine','Violet','Niizuma kahanshin: Washizukami',
  'Akin ang gabi','Kalakal','Ekis','A Very Good Girl','Love in Magic','Hayok','Mamasan',
  'Patikim ni Robb Guinto','Guilty Pleasure','Kitty K7','When You Love and When You Are Loved',
  'The Jowa Collector','Hindi tayo pwede','Ligaya','Unli Pop','Ang pamumukadkad ni Mirasol',
  'Sirena','Sabik','Hello, My Dolly Girlfriend','Habal','Mutant: Ghost War Girl','Stepdaddy',
  'Abot Langit','Sawsawan','Rapsa','Sem Break','Debauchery','Kapag tumayo ang testigo','Bangkera',
  'Serbidoras','Girl Friday',"Hitomi Kobayashi's Young Girl's Story",'Uhaw','Tamamono','Bisyo!',
  'Warat','Sagaran','Pagdaong','Tusok tusok','Tahan','Hiram','Kesong Puti','Sundutan','L: Lipad',
  'Madulas','Private Tutor','Tid Noy','Online Selling','Kolektor','Patikim-tikim','White River',
  'Alapaap','Shisei: The Tattooer','Pukpok','Paalam, salamat','Tampipi','Celestina: Burlesk Dancer',
  'Painted Skin','Angkinin Mo Ako','Monay','Sorority','Elevator Lady','VMX Kama Sutra','The Sales Girl',
  'Elves in Changjiang River','Folk strange talk: water monkey','Novo Land Floating Heart',
  'The God of wealth 3','Tongshan past without darkness under the lamp','Mulan Angles',
  'The Ghost Painter','Peopekteu maen','Ghost in the Body','Mamorarenakatta mono tachi e',
  'Why Women Cheat 2','VMX Kama Sutra','Mahjong','Serbidoras','Maharot','Malagkit','Salty Blue',
  'Bayo','Flower Girl','Maalikaya','Aliwan Inn','Hipak','Scandal Queen','Kandungan','Maninilip',
  'Arouse','A Secret Affair','Puri for Rent','Siklo','Japino','Tokyo Nights','Female Tenant',
  'Sulutan','Obsessed','Sabik','Rita','Debauchery',
];

// دمج الكل في مجموعة أسماء مُطبّعة للبحث السريع.
export function normName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[’'`´]/g, "'")
    .replace(/[üûùúū]/g, 'u').replace(/[éèêë]/g, 'e').replace(/[áàâä]/g, 'a')
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const _set = new Set([...BLOCK_EXACT, ...BLOCK_LIST].map(normName).filter((x) => x.length >= 2));

/** هل هذا الاسم محظور؟ نقارن الاسم مجرّداً من السنة. */
export function isBlockedName(name) {
  const n = normName(String(name).replace(/(19|20)\d{2}/g, ''));
  if (!n || n.length < 2) return false;
  return _set.has(n);
}
