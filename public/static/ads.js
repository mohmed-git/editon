/* ============================================================================
 * إدارة إعلانات Adsterra — سينما لايف
 * ----------------------------------------------------------------------------
 * الهدف: أقصى ربح آمن بدون إزعاج المستخدم، وبدون نقرات وهمية (لتفادي حظر Adsterra).
 *
 * ما يفعله هذا الملف:
 *  1) Popunder (Anti-Adblock JS) من Adsterra — يُحقن مرة واحدة لكل زيارة.
 *  2) Smartlinks — رابطان يُستغلّان بالتناوب عند أول نقرة "فاضية" على الموقع،
 *     مع تحديد تكرار (frequency capping) حتى لا يتضايق المستخدم.
 *  3) استثناء صفحة المشاهدة بالكامل (يُمرَّر ads=false من اللايوت فلا يُحمَّل أصلاً).
 *
 * ملاحظة أمانة: لا يوجد أي فتح/إغلاق تلقائي أو نقرات مزيّفة — تلك الطريقة
 * تُصنَّف احتيالاً في Adsterra وتؤدي لحظر الحساب ومصادرة الأرباح، كما أن
 * المتصفحات الحديثة تمنعها أصلاً (popup blocker). الاعتماد على تفاعل حقيقي
 * = ربح مستمر وحساب آمن.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- الإعدادات ----------------------------------------------------------
  var POPUNDER_SRC = 'https://jabturfembitter.com/ee/83/d3/ee83d32a4831963ddc166312735eb9d8.js';
  var SMARTLINKS = [
    'https://jabturfembitter.com/wbnrckax?key=af6decf62eddc36667ffab047fdae426',
    'https://jabturfembitter.com/hnn75fn9?key=dd54d1faa15700e7397fc1ff8f2ae5e1'
  ];

  // كل كم دقيقة يُسمح بفتح Smartlink مرة واحدة (منع الإزعاج + منع اعتباره احتيالاً)
  var SMARTLINK_COOLDOWN_MIN = 45;      // 45 دقيقة بين كل فتح والتالي
  var SMARTLINK_KEY = 'cl_sl_last';     // آخر وقت فتح Smartlink
  var SMARTLINK_IDX_KEY = 'cl_sl_idx';  // فهرس التناوب بين الرابطين

  // زر المشاهدة: كل كم دقيقة يُسمح بفتح إعلان عند النقر على زر المشاهدة.
  // "أول نقرة على زر المشاهدة يظهر إعلان" — لكن مع سقف تكرار حتى لا يتكرر
  // في كل نقرة (يُعتبر إزعاجاً/احتيالاً). المستخدم يكمل للمشاهدة دائماً.
  var WATCH_AD_COOLDOWN_MIN = 30;       // 30 دقيقة بين كل إعلان مشاهدة والتالي
  var WATCH_AD_KEY = 'cl_watch_ad_last';// آخر وقت فتح إعلان زر المشاهدة

  // ---- أدوات مساعدة -------------------------------------------------------
  function now() { return Date.now(); }

  function getLS(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function setLS(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) {}
  }

  // هل نحن داخل صفحة المشاهدة؟ (حماية إضافية لو حُمِّل الملف بالخطأ هناك)
  function isWatchPage() {
    return /(^|\/)watch(\/|$)/.test(window.location.pathname);
  }

  // ---- 1) Popunder (Anti-Adblock JS) --------------------------------------
  // يُحقن السكربت كما تطلبه Adsterra؛ هو يتولّى إطلاق الـ popunder عند
  // أول تفاعل حقيقي من المستخدم (سلوك الشبكة نفسها، لا تدخّل منّا).
  function loadPopunder() {
    if (document.getElementById('cl-popunder')) return;
    var s = document.createElement('script');
    s.id = 'cl-popunder';
    s.src = POPUNDER_SRC;
    s.async = true;
    s.referrerPolicy = 'no-referrer-when-downgrade';
    (document.body || document.documentElement).appendChild(s);
  }

  // ---- 2) Smartlink بالتناوب مع تحديد التكرار ------------------------------
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
    return (now() - last) >= SMARTLINK_COOLDOWN_MIN * 60 * 1000;
  }

  // يُفتح فقط استجابةً لنقرة/لمسة حقيقية من المستخدم (يتفادى حظر المتصفح)
  // وفي مكان "فاضٍ" (ليس على رابط/زر فعلي) حتى لا نعطّل تصفّح المستخدم.
  function maybeOpenSmartlink(ev) {
    if (!canOpenSmartlink()) return;

    var t = ev.target;
    // لا نتدخّل لو المستخدم نقر على عنصر تفاعلي حقيقي (رابط/زر/إدخال/فيديو…)
    var interactive = t && t.closest && t.closest(
      'a, button, input, select, textarea, label, video, audio, [role="button"], [data-no-ad]'
    );
    if (interactive) return;

    setLS(SMARTLINK_KEY, String(now()));
    var url = nextSmartlink();
    // تبويب جديد في الخلفية قدر الإمكان — يبقى المستخدم في الموقع.
    var w = window.open(url, '_blank', 'noopener');
    if (w) { try { w.blur(); window.focus(); } catch (e) {} }
  }

  // ---- 2ب) أزرار/بانرات Smartlink الصريحة ---------------------------------
  // النقر على بانر معلَّم بـ data-ad-smartlink = نقرة واعية صريحة من المستخدم،
  // فتُفتح دائماً بالتناوب (بلا cooldown) — أعلى ربح آمن.
  function bindExplicitBanners(ev) {
    var t = ev.target;
    var banner = t && t.closest && t.closest('[data-ad-smartlink]');
    if (!banner) return;
    ev.preventDefault();
    var url = nextSmartlink();
    setLS(SMARTLINK_KEY, String(now())); // نحدّث المؤقّت حتى لا يتكرر تلقائياً بعدها فوراً
    window.open(url, '_blank', 'noopener');
  }

  // ---- 2ج) إعلان زر المشاهدة ----------------------------------------------
  // المطلوب: "أول نقرة على زر المشاهدة يظهر إعلان".
  // أزرار المشاهدة = رابط يبدأ بـ /watch/ (زر العمل الكبير) أو زر التشغيل على
  // البطاقات (.poster-play-btn). نفتح Smartlink في تبويب جديد ثم نترك المستخدم
  // يكمل للمشاهدة عادةً (لا نعطّل التنقّل). سقف تكرار 30 دقيقة حتى لا يتكرر في
  // كل نقرة — تفاعل حقيقي = ربح آمن وحساب سليم في Adsterra.
  function canOpenWatchAd() {
    var last = parseInt(getLS(WATCH_AD_KEY) || '0', 10);
    if (isNaN(last)) last = 0;
    return (now() - last) >= WATCH_AD_COOLDOWN_MIN * 60 * 1000;
  }

  function bindWatchButton(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    // زر المشاهدة الكبير أو زر التشغيل على البطاقات
    var watchBtn = t.closest('a[href^="/watch/"], a[href*="/watch/"], .poster-play-btn, [data-watch-ad]');
    if (!watchBtn) return;
    if (!canOpenWatchAd()) return; // سقف تكرار — لا يتكرر في كل نقرة

    setLS(WATCH_AD_KEY, String(now()));
    // نحدّث مؤقّت الـ Smartlink العام أيضاً حتى لا يتراكم إعلانان معاً
    setLS(SMARTLINK_KEY, String(now()));
    var url = nextSmartlink();
    // تبويب جديد في الخلفية — المستخدم يكمل للمشاهدة في نفس التبويب.
    var w = window.open(url, '_blank', 'noopener');
    if (w) { try { w.blur(); window.focus(); } catch (e) {} }
    // لا نستدعي preventDefault: التنقّل لصفحة المشاهدة يستمر طبيعياً.
  }

  // ---- التهيئة ------------------------------------------------------------
  function init() {
    if (isWatchPage()) return; // أمان مزدوج: لا إعلانات في صفحة المشاهدة

    loadPopunder();

    // نقرات البانرات الصريحة أولاً (نقرة واعية = تُفتح دائماً)
    document.addEventListener('click', bindExplicitBanners, false);

    // إعلان زر المشاهدة (أول نقرة على زر المشاهدة يظهر إعلان، مع سقف تكرار)
    document.addEventListener('click', bindWatchButton, { passive: true });

    // ثم التفاعل في مكان فاضٍ لإطلاق Smartlink مرة كل فترة (مع cooldown)
    document.addEventListener('click', maybeOpenSmartlink, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
