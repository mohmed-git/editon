/* ============================================================================
   سينما لايف — إدارة المفضلة عبر localStorage (بلا حساب / بلا قاعدة بيانات)
   ----------------------------------------------------------------------------
   نخزّن قائمة الأعمال المفضّلة في المتصفح تحت المفتاح "cima:favorites".
   كل عنصر: { id, title, poster, type, year, rating, addedAt }.
   نكشف واجهة عامة window.CimaFav ونبثّ حدث "cima:fav-changed" عند أي تغيير
   ليحدّث زر القلب والعدّاد في الترويسة تلقائياً.
   ============================================================================ */
(function () {
  var KEY = 'cima:favorites';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {}
    // نبثّ حدثاً ليحدّث كل مكوّن يستمع (العدّاد + الأزرار)
    window.dispatchEvent(new CustomEvent('cima:fav-changed', { detail: { count: list.length } }));
  }

  var CimaFav = {
    /** كل المفضّلة (الأحدث أولاً) */
    all: function () {
      return read().slice().sort(function (a, b) {
        return (b.addedAt || 0) - (a.addedAt || 0);
      });
    },
    /** عدد المفضّلة */
    count: function () {
      return read().length;
    },
    /** هل العمل مفضّل؟ */
    has: function (id) {
      id = String(id);
      return read().some(function (x) { return String(x.id) === id; });
    },
    /** إضافة عمل. work = {id,title,poster,type,year,rating} */
    add: function (work) {
      if (!work || work.id == null) return false;
      var list = read();
      var id = String(work.id);
      if (list.some(function (x) { return String(x.id) === id; })) return true;
      list.push({
        id: id,
        title: work.title || '',
        poster: work.poster || '',
        type: work.type || '',
        year: work.year || null,
        rating: work.rating || null,
        addedAt: Date.now()
      });
      write(list);
      return true;
    },
    /** إزالة عمل */
    remove: function (id) {
      id = String(id);
      var list = read().filter(function (x) { return String(x.id) !== id; });
      write(list);
      return true;
    },
    /** تبديل الحالة (يضيف إن لم يكن، ويزيل إن كان). يعيد true إذا صار مفضّلاً */
    toggle: function (work) {
      var id = String(work && work.id != null ? work.id : work);
      if (this.has(id)) { this.remove(id); return false; }
      this.add(work); return true;
    },
    /** تفريغ الكل */
    clear: function () { write([]); }
  };

  window.CimaFav = CimaFav;

  // ---- ربط أزرار القلب في الصفحة تلقائياً --------------------------------
  // أي عنصر يحمل [data-fav-btn] مع خصائص data-fav-* يصبح زر تبديل مفضلة.
  function syncButton(btn) {
    var id = btn.getAttribute('data-fav-id');
    if (id == null) return;
    var active = CimaFav.has(id);
    btn.classList.toggle('is-fav', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    var lbl = active ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة';
    btn.setAttribute('title', lbl);
    btn.setAttribute('aria-label', lbl);
  }

  function syncAllButtons() {
    document.querySelectorAll('[data-fav-btn]').forEach(syncButton);
  }

  function onClick(e) {
    var btn = e.target.closest('[data-fav-btn]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var work = {
      id: btn.getAttribute('data-fav-id'),
      title: btn.getAttribute('data-fav-title') || '',
      poster: btn.getAttribute('data-fav-poster') || '',
      type: btn.getAttribute('data-fav-type') || '',
      year: btn.getAttribute('data-fav-year') || null,
      rating: btn.getAttribute('data-fav-rating') || null
    };
    CimaFav.toggle(work);
  }

  document.addEventListener('click', onClick);
  document.addEventListener('DOMContentLoaded', syncAllButtons);
  window.addEventListener('cima:fav-changed', syncAllButtons);
  // sync فوري (في حال حُمّل السكربت بعد اكتمال DOM)
  if (document.readyState !== 'loading') syncAllButtons();
})();
