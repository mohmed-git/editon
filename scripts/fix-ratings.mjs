// ============================================================================
// fix-ratings.mjs — إخفاء التقييمات غير الموثوقة (عدد أصوات أقل من الحد الأدنى)
// يمنع ظهور عمل بتقييم 10/10 بصوت واحد ضمن الأعلى تقييماً.
// الحد الأدنى الافتراضي: 50 صوتاً (قابل للتغيير عبر MIN_VOTES).
// نصفّر rating في titles.json + details.json لأي عمل أصواته < الحد.
// نحتفظ بـ ratingRaw/voteCount في details للرجوع إن لزم.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const MIN_VOTES = parseInt(process.env.MIN_VOTES || '50', 10);
const ROOT = path.resolve(process.cwd());
const tp = path.join(ROOT, 'src/data/titles.json');
const dp = path.join(ROOT, 'src/data/details.json');
const titles = JSON.parse(fs.readFileSync(tp, 'utf8'));
const details = JSON.parse(fs.readFileSync(dp, 'utf8'));

fs.writeFileSync('/tmp/titles.before-ratingfix.json', JSON.stringify(titles));
fs.writeFileSync('/tmp/details.before-ratingfix.json', JSON.stringify(details));

let hidden = 0, kept = 0;
for (const id in titles) {
  const t = titles[id];
  if (t.rating == null) continue;
  const d = details[id] || {};
  const votes = d.voteCount || 0;
  if (votes < MIN_VOTES) {
    // احفظ الخام للرجوع، ثم أخفِ التقييم من العرض
    if (d && d.rating != null && d.ratingRaw == null) d.ratingRaw = d.rating;
    t.rating = null;
    if (d) d.rating = null;
    hidden++;
  } else {
    kept++;
  }
}

fs.writeFileSync(tp, JSON.stringify(titles));
fs.writeFileSync(dp, JSON.stringify(details));
console.log(`✔ الحد الأدنى للأصوات: ${MIN_VOTES}`);
console.log(`   تقييمات أُخفيت (أصوات قليلة): ${hidden}`);
console.log(`   تقييمات مُبقاة (موثوقة): ${kept}`);
