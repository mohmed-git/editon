import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// ============================================================================
// إعداد Astro — "سينما بلس"
// ----------------------------------------------------------------------------
// نستخدم output: 'static' (الافتراضي في Astro 5) مع Cloudflare adapter.
// هذا يكافئ سلوك 'hybrid': كل الصفحات تُبنى Static (prerender) افتراضياً،
// وصفحات المشاهدة/الحلقات فقط تُعلَّم SSR عبر `export const prerender = false`
// فتُخدَّم من الـ Worker عند الطلب.
//
// قيود Cloudflare Free Plan المُراعاة:
//  - حد 20,000 ملف ثابت: نبني index/category/title فقط Static (عدد محدود)،
//    وصفحات watch/episode SSR (لا تُنتج ملفات) لتفادي تضخّم العدد مع نمو الحلقات.
//  - حد CPU 10ms/طلب: كود الـ SSR يقرأ من JSON مُجهّز مسبقاً (لا استدعاءات
//    شبكة حيّة، لا معالجة ثقيلة).
// ============================================================================
export default defineConfig({
  output: 'static',
  adapter: cloudflare(),
  site: 'https://cima-liveapp.site',
  // ملاحظة: نترك مسار الأصول الافتراضي (_astro/) بدل تعشيشه تحت static/،
  // لأن تعشيشه يولّد قاعدتَي استثناء متداخلتين في _routes.json
  // (/static/_astro/* و /static/*) ويرفضها wrangler. styles.css يبقى في
  // /static/styles.css كملف عام (public/static) دون مشكلة.
});
