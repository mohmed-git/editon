// ============================================================================
// توليد عناوين الصفحات (Title Tags) وSchema.org — سينما لايف
// ----------------------------------------------------------------------------
// التنسيقات مطابقة تماماً لمتطلبات المستخدم. اسم الموقع "سينما لايف" لا يظهر
// في عناوين صفحات الأعمال/الحلقات — فقط في الرئيسية وmeta description وSchema.
// ============================================================================
import type { TitleDetail, Episode } from './data';

export const SITE_NAME = 'سينما لايف';
export const SITE_URL = 'https://cima-liveapp.site';

/** الاسم المعروض: عربي (Original) — نضيف الأجنبي بين قوسين إن اختلف */
export function displayName(d: { title: string; titleEn?: string; originalTitle?: string }): string {
  const en = (d.originalTitle || d.titleEn || '').trim();
  const ar = (d.title || '').trim();
  if (en && ar && en.toLowerCase() !== ar.toLowerCase()) return `${ar} (${en})`;
  return ar || en;
}

/** الاسم المختصر (بدون قوسين) للاستخدام داخل قوالب العناوين */
function baseName(d: { title: string; titleEn?: string; originalTitle?: string }): string {
  const ar = (d.title || '').trim();
  const en = (d.originalTitle || d.titleEn || '').trim();
  // للأعمال المشهورة عالمياً نُبقي الأجنبي بين قوسين داخل العنوان
  if (en && ar && en.toLowerCase() !== ar.toLowerCase()) return `${ar} (${en})`;
  return ar || en;
}

/** قصّ العنوان ليبقى ضمن 50–60 حرفاً قدر الإمكان دون قطع كلمة */
function clamp(title: string, max = 60): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
}

// ---- عنوان صفحة العمل (title page) -----------------------------------------
export function titlePageTag(d: TitleDetail): string {
  const name = baseName(d);
  if (d.type === 'movie') {
    // "اسم الفيلم بالعربي (Original Title) 2026 مترجم اون لاين HD"
    // السنة تُضاف فقط عند وجود لبس (تُمرّر دائماً هنا لأن الأفلام تستفيد منها)
    const yr = d.year ? ` ${d.year}` : '';
    return clamp(`${name}${yr} مترجم اون لاين HD`);
  }
  if (d.type === 'anime') {
    // "انمي اسم الأنمي مترجم اون لاين – الحلقات كاملة"
    return clamp(`انمي ${name} مترجم اون لاين – الحلقات كاملة`);
  }
  // series: "مسلسل اسم المسلسل مترجم – جميع المواسم والحلقات"
  return clamp(`مسلسل ${name} مترجم – جميع المواسم والحلقات`);
}

// ---- عنوان صفحة الحلقة (watch/episode) --------------------------------------
export function episodePageTag(
  d: TitleDetail,
  season: number,
  episode: number
): string {
  const name = baseName(d);
  if (d.type === 'movie') {
    const yr = d.year ? ` ${d.year}` : '';
    return clamp(`${name}${yr} مترجم اون لاين HD`);
  }
  if (d.type === 'anime') {
    // "انمي اسم الأنمي الحلقة Y مترجمة اون لاين" — أو مع الموسم لو مقسّم رسمياً
    if ((d.numberOfSeasons || 1) > 1) {
      return clamp(`انمي ${name} الموسم ${season} الحلقة ${episode} مترجمة اون لاين`);
    }
    return clamp(`انمي ${name} الحلقة ${episode} مترجمة اون لاين`);
  }
  // series: "مسلسل اسم المسلسل الموسم X الحلقة Y مترجمة اون لاين HD"
  return clamp(`مسلسل ${name} الموسم ${season} الحلقة ${episode} مترجمة اون لاين HD`);
}

// ---- meta description --------------------------------------------------------
export function titleDescription(d: TitleDetail): string {
  const name = displayName(d);
  const syn = (d.synopsis || '').replace(/\s+/g, ' ').trim();
  const typeWord = d.type === 'movie' ? 'فيلم' : d.type === 'anime' ? 'انمي' : 'مسلسل';
  const lead = syn
    ? `شاهد ${typeWord} ${name}${d.year ? ` ${d.year}` : ''}: ${syn}`
    : `شاهد ${typeWord} ${name}${d.year ? ` ${d.year}` : ''} مترجم`;
  const tail = ` مترجم HD على ${SITE_NAME}.`;
  const maxBody = 160 - tail.length;
  const body = lead.length > maxBody ? lead.slice(0, maxBody - 1).trim() + '…' : lead;
  return body + tail;
}

export function episodeDescription(d: TitleDetail, season: number, episode: number, ep?: Episode | null): string {
  const name = displayName(d);
  const typeWord = d.type === 'anime' ? 'انمي' : 'مسلسل';
  const epSyn = ep && ep.synopsis ? ep.synopsis.replace(/\s+/g, ' ').trim() : '';
  const head =
    d.type === 'movie'
      ? `شاهد فيلم ${name} مترجم اون لاين`
      : `شاهد ${typeWord} ${name} الموسم ${season} الحلقة ${episode} مترجمة`;
  const lead = epSyn ? `${head}: ${epSyn}` : head;
  const tail = ` بجودة HD على ${SITE_NAME}.`;
  const maxBody = 160 - tail.length;
  const body = lead.length > maxBody ? lead.slice(0, maxBody - 1).trim() + '…' : lead;
  return body + tail;
}

// ---- Schema.org --------------------------------------------------------------
function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/static/favicon.svg`,
  };
}
function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: 'ar',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}
export function homeSchema() {
  return [organizationSchema(), websiteSchema()];
}

function ratingSchema(d: TitleDetail) {
  if (!d.rating || !d.voteCount) return undefined;
  return {
    '@type': 'AggregateRating',
    ratingValue: String(d.rating),
    bestRating: '10',
    ratingCount: d.voteCount,
  };
}

function breadcrumb(d: TitleDetail, path: string, extra?: { name: string; item: string }) {
  const typeCat = d.type === 'movie' ? { name: 'أفلام', slug: 'movie' } : d.type === 'anime' ? { name: 'أنمي', slug: 'anime' } : { name: 'مسلسلات', slug: 'series' };
  const items = [
    { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: typeCat.name, item: `${SITE_URL}/category/${typeCat.slug}` },
    { '@type': 'ListItem', position: 3, name: displayName(d), item: `${SITE_URL}/title/${d.id}` },
  ];
  if (extra) items.push({ '@type': 'ListItem', position: 4, name: extra.name, item: extra.item });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

/** Schema لصفحة العمل: Movie أو TVSeries */
export function titleSchema(d: TitleDetail): object[] {
  const common: any = {
    '@context': 'https://schema.org',
    '@type': d.type === 'movie' ? 'Movie' : 'TVSeries',
    name: displayName(d),
    description: (d.synopsis || '').slice(0, 300),
    image: d.tmdbPoster || d.poster,
    inLanguage: 'ar',
    url: `${SITE_URL}/title/${d.id}`,
    genre: d.genres,
  };
  if (d.year) common.datePublished = String(d.year);
  if (d.creators && d.creators.length) {
    common[d.type === 'movie' ? 'director' : 'creator'] = d.creators.map((n) => ({ '@type': 'Person', name: n }));
  }
  if (d.cast && d.cast.length) {
    common.actor = d.cast.slice(0, 10).map((c) => {
      const p: any = { '@type': 'Person', name: c.name };
      if (c.profile) p.image = c.profile;
      return p;
    });
  }
  // مدة العرض بصيغة ISO 8601 (يفهمها جوجل: PT##M)
  if (d.runtime && d.runtime > 0) {
    common[d.type === 'movie' ? 'duration' : 'timeRequired'] = `PT${d.runtime}M`;
  }
  if (d.tagline) common.alternativeHeadline = d.tagline;
  if (d.type !== 'movie' && d.numberOfSeasons) common.numberOfSeasons = d.numberOfSeasons;
  if (d.type !== 'movie' && d.numberOfEpisodes) common.numberOfEpisodes = d.numberOfEpisodes;
  const rating = ratingSchema(d);
  if (rating) common.aggregateRating = rating;
  return [common, breadcrumb(d, `/title/${d.id}`)];
}

/** Schema لصفحة الحلقة: TVEpisode (ضمن partOfSeries) */
export function episodeSchema(d: TitleDetail, season: number, episode: number, ep?: Episode | null): object[] {
  if (d.type === 'movie') return titleSchema(d);
  const node: any = {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    name: ep && ep.name ? ep.name : `الحلقة ${episode}`,
    episodeNumber: episode,
    inLanguage: 'ar',
    url: `${SITE_URL}/watch/${d.id}/${season}/${episode}`,
    partOfSeries: {
      '@type': 'TVSeries',
      name: displayName(d),
      image: d.tmdbPoster || d.poster,
      url: `${SITE_URL}/title/${d.id}`,
    },
    partOfSeason: { '@type': 'TVSeason', seasonNumber: season },
  };
  if (ep && ep.synopsis) node.description = ep.synopsis.slice(0, 300);
  if (ep && ep.still) node.image = ep.still;
  if (ep && ep.airDate) node.datePublished = ep.airDate;
  // تقييم الحلقة بمصدر TMDB (لا يظهر كتقييم احتيالي — له مصدر واضح)
  if (ep && ep.rating != null && ep.voteCount) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(ep.rating),
      bestRating: '10',
      ratingCount: ep.voteCount,
    };
  }
  return [node, breadcrumb(d, `/watch/${d.id}/${season}/${episode}`, { name: `الموسم ${season} الحلقة ${episode}`, item: `${SITE_URL}/watch/${d.id}/${season}/${episode}` })];
}
