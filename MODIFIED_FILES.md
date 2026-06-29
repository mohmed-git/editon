# الملفات المعدّلة فقط (Deliverable B)

هذه هي الملفات التي تغيّرت أو أُضيفت أثناء المعالجة. انسخها فوق نسخة موقعك الحالية.

## ملفات البيانات (الأهم — استبدلها)
- `src/data/generated/all.json` — قاعدة البيانات الرئيسية بعد:
  1. حذف 118 عملاً من `delet.txt`
  2. تصحيح 710 تصنيف خاطئ (حسب بلد الإنتاج)
  3. تحويل 363 عملاً بدون بوستر إلى روابط Cloudflare R2
- `src/data/generated/episode-manifest.json` — أُعيد توليده
- `src/data/generated/episode-routes.json` — أُعيد توليده
- `public/_data/**` — كل الـ shards أُعيد توليدها من `all.json` (مطلوبة للنشر)

> بعد استبدال هذه الملفات، أعد بناء الموقع: `npm run build` ثم انشر.

## السكربتات (مرجعية — للتوثيق وإعادة التشغيل)
- `scripts/apply-deletions.mjs` — تطبيق الحذف
- `scripts/fix-subcategories.mjs` — تصحيح التصنيفات
- `scripts/apply-r2-posters.mjs` — وضع روابط R2 للبوسترات
- `scripts/build-poster-csv.mjs` — توليد ملف CSV للبوسترات
- `scripts/data/delete-list.txt` — قائمة الحذف المنظّفة

## ملفات حل البوسترات (نفّذها كما في POSTERS_README.md)
- `scripts/download_posters.py` — سكربت تحميل الصور
- `scripts/data/posters-to-download.csv` — قائمة الأعمال بدون بوستر (363)
- `POSTERS_README.md` — دليل الاستخدام الكامل

راجع `POSTERS_README.md` للخطوات التفصيلية (تحميل الصور ← رفعها على R2 ← نشر الموقع).
