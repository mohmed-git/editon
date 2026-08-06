/* ============================================================================
 * إدارة إعلانات Adsterra — سينما لايف  (وضع مكثّف "شبه آمن")
 * ----------------------------------------------------------------------------
 * الهدف: أقصى كثافة إعلانية ممكنة مع تقليل خطر حظر حساب Adsterra قدر الإمكان.
 *
 * ما يفعله هذا الملف (كثافة مُضاعَفة بعد تأكيد Adsterra عدم وجود مسؤولية):
 *  1) Popunder (Adsterra) — يُحقن السكربت، ويُعاد تشغيله بشكل متكرر جداً بفاصل
 *     25 ثانية (POPUNDER_REINJECT_SEC) + عند كل نقرة + عند التمرير → بوب-أندر كثير جداً.
 *  2) Social Bar (Adsterra) — شريط إعلاني تفاعلي دائم في كل الصفحات (عدا المشاهدة).
 *  3) Smartlink — يُفتح دفعة (SMARTLINK_BURST) مع كل نقرة تقريباً بفاصل 6 ثوانٍ
 *     (متتالٍ/ورا بعض) بدل مرة واحدة كل فترة طويلة → كثافة أعلى بكثير.
 *  4) استثناء صفحة المشاهدة بالكامل (يُمرَّر ads=false من اللايوت فلا يُحمَّل أصلاً).
 *
 * ملاحظة أمان مهمّة: لتقليل خطر الحظر الفوري + تجاوز مانع النوافذ في المتصفح،
 * لا نفتح عدة نوافذ في نفس اللحظة بالضبط؛ بل نفتحها متتالية بفاصل ثوانٍ قصيرة.
 * النتيجة عملياً كثافة عالية جداً لكن دون السلوك اللحظي الذي يُصنَّف احتيالاً
 * ويُحظر فوراً. لا توجد نقرات وهمية آلية (auto-click) لأنها سبب الحظر المؤكّد.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- الإعدادات ----------------------------------------------------------
  // البوب-أندر الجديد (Adsterra)
  var POPUNDER_SRC = 'https://jabturfembitter.com/df/f1/06/dff1061fdbf27b3a8911a5baadea0754.js';
  // Social Bar الجديد (Adsterra)
  var SOCIALBAR_SRC = 'https://jabturfembitter.com/a3/1d/08/a31d08e58baefc026af32ed8df5dc353.js';
  // Smartlink الجديد (Adsterra) — نُبقي رابطاً واحداً؛ يمكن إضافة المزيد لاحقاً
  var SMARTLINKS = [
    'https://jabturfembitter.com/q4mwyeieh?key=ad2a2d5654b356e113da3fb8e604c7b1'
  ];

  // --- إعدادات الوضع المكثّف (تمّت زيادة الكثافة أكثر) ---
  // كل كم ثانية يُعاد حقن سكربت البوب-أندر (يعطي فرصة بوب-أندر جديد) — كثيف جداً.
  var POPUNDER_REINJECT_SEC = 25;   // كل 25 ثانية يُعاد الحقن → بوب-أندر متكرر بكثرة
  // كل كم ثانية يُسمح بفتح Smartlink مرة (قصير جداً = ورا بعض) — كثيف جداً.
  var SMARTLINK_COOLDOWN_SEC = 6;   // 6 ثوانٍ بين كل فتح Smartlink والتالي
  // زر المشاهدة: فاصل قصير جداً أيضاً.
  var WATCH_AD_COOLDOWN_SEC = 6;
  // كم Smartlink يُفتح متتالياً في كل نقرة (متتالية بفاصل ثوانٍ قصيرة = كثافة أعلى).
  var SMARTLINK_BURST = 2;
  // فاصل قصير (مللي ثانية) بين نوافذ نفس الدفعة لتجنّب السلوك اللحظي المُصنَّف احتيالاً.
  var SMARTLINK_BURST_GAP_MS = 1200;

  var SMARTLINK_KEY = 'cl_sl_last';     // آخر وقت فتح Smartlink
  var SMARTLINK_IDX_KEY = 'cl_sl_idx';  // فهرس التناوب
  var WATCH_AD_KEY = 'cl_watch_ad_last';// آخر وقت إعلان زر المشاهدة

  // ---- أدوات مساعدة -------------------------------------------------------
  function now() { return Date.now(); }
  function getLS(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function isWatchPage() {
    return /(^|\/)watch(\/|$)/.test(window.location.pathname);
  }

  // ---- 1) Popunder (متكرر) ------------------------------------------------
  // نحقن سكربت Adsterra، ثم نعيد حقنه دورياً بفاصل قصير جداً حتى نحصل على
  // بوب-أندر متكرر ("كثير") بدل مرة واحدة للزيارة.
  function injectPopunderOnce() {
    var s = document.createElement('script');
    s.className = 'cl-popunder';
    s.src = POPUNDER_SRC + (POPUNDER_SRC.indexOf('?') === -1 ? '?_=' : '&_=') + now();
    s.async = true;
    s.referrerPolicy = 'no-referrer-when-downgrade';
    (document.body || document.documentElement).appendChild(s);
  }

  var _lastScrollInject = 0;
  function loadPopunder() {
    injectPopunderOnce();
    // إعادة حقن دورية = بوب-أندر متكرر بكثرة
    setInterval(injectPopunderOnce, POPUNDER_REINJECT_SEC * 1000);
    // أيضاً عند كل نقرة (تفاعل حقيقي) نضمن وجود سكربت جاهز لبوب-أندر جديد
    document.addEventListener('click', function () {
      // نحقن مرة إضافية عند التفاعل لزيادة الكثافة (بفاصل بسيط عبر المؤقّت أعلاه)
      injectPopunderOnce();
    }, { passive: true });
    // عند التمرير (throttle كل 8 ثوانٍ) نحقن أيضاً لزيادة الكثافة مع الحفاظ على الأداء
    document.addEventListener('scroll', function () {
      var t = now();
      if (t - _lastScrollInject < 8000) return;
      _lastScrollInject = t;
      injectPopunderOnce();
    }, { passive: true });
  }

  // ---- 1ب) Social Bar (دائم) ----------------------------------------------
  function loadSocialBar() {
    if (document.getElementById('cl-socialbar')) return;
    var s = document.createElement('script');
    s.id = 'cl-socialbar';
    s.src = SOCIALBAR_SRC;
    s.async = true;
    s.referrerPolicy = 'no-referrer-when-downgrade';
    (document.body || document.documentElement).appendChild(s);
  }

  // ---- 2) Smartlink (متتالٍ/ورا بعض) --------------------------------------
  function nextSmartlink() {
    var idx = parseInt(getLS(SMARTLINK_IDX_KEY) || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    var url = SMARTLINKS[idx % SMARTLINKS.length];
    setLS(SMARTLINK_IDX_KEY, String((idx + 1) % SMARTLINKS.length));
    return url;
  }

  function canOpenSmartlink() {
    var last = parseInt(getLS(SMARTLINK_KEY) || '0', 10);
    if (isNaN(last)) last = 0;
    return (now() - last) >= SMARTLINK_COOLDOWN_SEC * 1000;
  }

  // يفتح Smartlink واحداً في نافذة جديدة (يُعيد التركيز للصفحة الأصلية).
  function openOneSmartlink() {
    var url = nextSmartlink();
    var w = window.open(url, '_blank', 'noopener');
    if (w) { try { w.blur(); window.focus(); } catch (e) {} }
  }

  // يفتح دفعة (SMARTLINK_BURST) من Smartlinks متتالية بفاصل ثوانٍ قصيرة (شبه آمن).
  function openSmartlinkBurst() {
    setLS(SMARTLINK_KEY, String(now()));
    openOneSmartlink();
    for (var i = 1; i < SMARTLINK_BURST; i++) {
      setTimeout(openOneSmartlink, i * SMARTLINK_BURST_GAP_MS);
    }
  }

  // يُفتح استجابةً لأي نقرة حقيقية (حتى على مكان فاضٍ) بفاصل قصير جداً = كثيف جداً.
  function maybeOpenSmartlink(ev) {
    if (!canOpenSmartlink()) return;
    var t = ev.target;
    // نتجنّب فقط عناصر الإدخال/الفيديو حتى لا نُفسد الاستخدام الأساسي
    var skip = t && t.closest && t.closest('input, select, textarea, video, audio, [data-no-ad]');
    if (skip) return;
    openSmartlinkBurst();
  }

  // ---- 2ب) بانرات Smartlink الصريحة ---------------------------------------
  function bindExplicitBanners(ev) {
    var t = ev.target;
    var banner = t && t.closest && t.closest('[data-ad-smartlink]');
    if (!banner) return;
    ev.preventDefault();
    var url = nextSmartlink();
    setLS(SMARTLINK_KEY, String(now()));
    window.open(url, '_blank', 'noopener');
  }

  // ---- 2ج) إعلان زر المشاهدة ----------------------------------------------
  function canOpenWatchAd() {
    var last = parseInt(getLS(WATCH_AD_KEY) || '0', 10);
    if (isNaN(last)) last = 0;
    return (now() - last) >= WATCH_AD_COOLDOWN_SEC * 1000;
  }

  function bindWatchButton(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var watchBtn = t.closest('a[href^="/watch/"], a[href*="/watch/"], .poster-play-btn, [data-watch-ad]');
    if (!watchBtn) return;
    if (!canOpenWatchAd()) return;
    setLS(WATCH_AD_KEY, String(now()));
    setLS(SMARTLINK_KEY, String(now()));
    var url = nextSmartlink();
    var w = window.open(url, '_blank', 'noopener');
    if (w) { try { w.blur(); window.focus(); } catch (e) {} }
  }

  // ---- التهيئة ------------------------------------------------------------
  function init() {
    if (isWatchPage()) return; // لا إعلانات في صفحة المشاهدة

    loadPopunder();
    loadSocialBar();

    document.addEventListener('click', bindExplicitBanners, false);
    document.addEventListener('click', bindWatchButton, { passive: true });
    document.addEventListener('click', maybeOpenSmartlink, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
