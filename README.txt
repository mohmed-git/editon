حزمة الدفعة 24 — سينما لايف (دمج سيرفرات cimalight + إنشاء أعمال جديدة)
=========================================================================

ما تم:
1) دمج سيرفرات جديدة في الأعمال الموجودة:
   - أفلام (result.csv):   1381 عمل مطابق، +10157 سيرفر
   - مسلسلات (series_with_servers_all): 4328 عمل مطابق، +24471 سيرفر
   - السيرفرات تُضاف "بين" سيرفرات العمل الموجود مع إزالة التكرار (dedup)
     وحد أقصى 20 سيرفر/حلقة.

2) إنشاء 1006 عمل جديد غير موجود:
   - العمل الأجنبي: بحث + إثراء TMDB (قصة عربية/صورة/خلفية/تقييم/طاقم/تصنيفات).
   - العمل العربي: يُنشأ بدون TMDB (كما طُلب).
   - الإجمالي: 11328 → 12334 عمل.

الملفات في هذه الحزمة (ضعها في نفس مسارات المشروع):
  titles.json          → src/data/titles.json
  details.json         → src/data/details.json
  home.json            → src/data/home.json
  categories.json      → src/data/categories.json
  search-index.json    → src/data/search-index.json
  sitemap-index.json   → src/data/sitemap-index.json
  stats.json           → src/data/stats.json
  episodes/shard-*.json→ public/data/episodes/
  ads.js               → public/static/ads.js  (كثافة إعلانات أعلى)
  scripts/*.mjs        → scripts/   (سكربتات الدمج والإنشاء)
  reports/*            → تقارير الأعمال الجديدة (مرجعية)

ملاحظة: بعد النسخ شغّل `npm run build` لإعادة توليد الموقع الثابت
(عدد الملفات ~13,603 < حد Cloudflare 20,000).
