import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titlesDir = path.join(rootDir, 'src', 'data', 'titles');
const reportPath = path.join(rootDir, 'trailers-report.json');

const negativeWords = [
  'review',
  'explained',
  'reaction',
  'recap',
  'ending',
  'clip',
  'scene',
  'behind the scenes',
  'interview',
  'soundtrack',
  'song',
  'episode',
  'حلقة',
  'مراجعة',
  'ملخص',
];

function cleanTitle(title, year) {
  let value = String(title || '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .replace(/&/g, ' and ')
    .trim();
  if (year) value = value.replace(new RegExp(`\\s*${year}\\b`, 'g'), '').trim();
  return value || title;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\"/g, '"');
}

function titleWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !['the', 'and', 'movie', 'film', 'series', 'season', 'trailer', 'official'].includes(word));
}

function parseCandidates(html) {
  const candidates = [];
  const seen = new Set();
  const regex = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,2500}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) && candidates.length < 20) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, title: decodeHtml(match[2]) });
  }

  if (candidates.length === 0) {
    for (const fallback of html.matchAll(/watch\?v=([a-zA-Z0-9_-]{11})/g)) {
      const id = fallback[1];
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({ id, title: '' });
      if (candidates.length >= 10) break;
    }
  }

  return candidates;
}

function scoreCandidate(candidate, work) {
  const haystack = candidate.title.toLowerCase();
  const words = titleWords(work.title);
  let score = 0;

  for (const word of words) {
    if (haystack.includes(word)) score += 4;
  }

  if (haystack.includes('trailer')) score += 8;
  if (haystack.includes('official')) score += 4;
  if (work.year && haystack.includes(String(work.year))) score += 3;
  if (work.category === 'movie' && (haystack.includes('movie') || haystack.includes('film'))) score += 2;
  if (work.category === 'series' && (haystack.includes('series') || haystack.includes('season'))) score += 2;
  if (work.category === 'anime' && haystack.includes('anime')) score += 2;

  for (const bad of negativeWords) {
    if (haystack.includes(bad)) score -= 8;
  }

  if (!haystack) score += 1;
  return score;
}

async function searchYouTube(work) {
  const kind = work.category === 'movie' ? 'movie' : work.category === 'anime' ? 'anime' : 'series';
  const query = `${work.title} ${work.year || ''} ${kind} official trailer`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const response = await fetch(url, {
    headers: {
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  const html = await response.text();
  const candidates = parseCandidates(html)
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, work) }))
    .sort((a, b) => b.score - a.score);

  return {
    query,
    selected: candidates[0] || null,
    candidates: candidates.slice(0, 5),
  };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const files = (await fs.readdir(titlesDir)).filter((file) => file.endsWith('.json')).sort();
  const report = [];
  let done = 0;

  async function processFile(file) {
    const fullPath = path.join(titlesDir, file);
    const data = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    if (data.trailerId) {
      done += 1;
      report.push({
        title: cleanTitle(data.clean_title, data.year),
        year: data.year || '',
        category: data.category,
        slug: data.slug,
        selected: { id: data.trailerId, title: 'existing' },
      });
      return;
    }

    const work = {
      title: cleanTitle(data.clean_title, data.year),
      year: data.year || '',
      category: data.category,
      slug: data.slug,
    };

    try {
      let result;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await searchYouTube(work);
          break;
        } catch (error) {
          lastError = error;
          await delay(1500 * attempt);
        }
      }
      if (!result) throw lastError;
      const selected = result.selected;
      if (selected?.id) {
        data.trailerId = selected.id;
        await fs.writeFile(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
      report.push({ ...work, query: result.query, selected, candidates: result.candidates });
      done += 1;
      console.log(`${done}/${files.length} ${data.slug}: ${selected?.id || 'not found'} ${selected?.title || ''}`);
    } catch (error) {
      report.push({ ...work, error: String(error) });
      done += 1;
      console.log(`${done}/${files.length} ${data.slug}: ERROR ${error.message}`);
    }

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await delay(900);
  }

  const queue = [...files];
  const workerCount = 2;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (file) await processFile(file);
      }
    })
  );

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (process.argv[2] === '--query') {
  const query = process.argv.slice(3).join(' ');
  searchYouTube({ title: query, year: '', category: 'movie', slug: 'manual-query' })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
