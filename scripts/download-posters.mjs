#!/usr/bin/env node
// Download all poster images locally to public/images/<category>/<slug>.<ext>
// Then rewrite poster paths in all data files to local paths
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const ROOT = '/home/user/cinmapro';
const PUBLIC_IMG = path.join(ROOT, 'public/images');
const DATA_GEN = path.join(ROOT, 'src/data/generated');
const DATA_TITLES = path.join(ROOT, 'src/data/titles');

fs.mkdirSync(PUBLIC_IMG, { recursive: true });
fs.mkdirSync(path.join(PUBLIC_IMG, 'movie'), { recursive: true });
fs.mkdirSync(path.join(PUBLIC_IMG, 'series'), { recursive: true });
fs.mkdirSync(path.join(PUBLIC_IMG, 'anime'), { recursive: true });

function getExt(url) {
  const clean = url.split('?')[0].toLowerCase();
  const m = clean.match(/\.(jpg|jpeg|png|webp|gif)(?:[^a-z0-9]|$)/);
  return m ? m[1] : 'jpg';
}

function download(url, dest) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        download(res.headers.location, dest).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        resolve({ ok: false, status: res.statusCode });
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ ok: true })));
      file.on('error', (e) => resolve({ ok: false, err: e.message }));
    });
    req.on('error', (e) => resolve({ ok: false, err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
  });
}

const all = JSON.parse(fs.readFileSync(path.join(DATA_GEN, 'all.json'), 'utf8'));

const tasks = all.map(t => ({
  slug: t.slug,
  category: t.category,
  poster: t.poster,
}));

let ok = 0, fail = 0, skip = 0;
const localMap = {}; // slug -> local path

async function run() {
  // process sequentially in batches of 5 to be polite
  const BATCH = 5;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const chunk = tasks.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (t) => {
      if (!t.poster) { skip++; return; }
      const ext = getExt(t.poster);
      const localPath = `/images/${t.category}/${t.slug}.${ext}`;
      const destFs = path.join(ROOT, 'public', localPath);
      if (fs.existsSync(destFs) && fs.statSync(destFs).size > 1024) {
        ok++;
        localMap[t.slug] = localPath;
        return;
      }
      const r = await download(t.poster, destFs);
      if (r.ok) {
        ok++;
        localMap[t.slug] = localPath;
        process.stdout.write('.');
      } else {
        fail++;
        process.stdout.write('x');
        try { fs.unlinkSync(destFs); } catch {}
      }
    }));
  }
  console.log(`\n✅ Downloaded ${ok}, failed ${fail}, skipped ${skip}`);

  // Now rewrite poster paths in all data files
  function rewritePoster(obj) {
    if (obj.slug && localMap[obj.slug]) {
      obj.poster = localMap[obj.slug];
    }
    return obj;
  }

  // all.json
  const updated = all.map(rewritePoster);
  fs.writeFileSync(path.join(DATA_GEN, 'all.json'), JSON.stringify(updated, null, 2));

  // index.json
  const idx = JSON.parse(fs.readFileSync(path.join(DATA_GEN, 'index.json'), 'utf8'));
  fs.writeFileSync(path.join(DATA_GEN, 'index.json'), JSON.stringify(idx.map(rewritePoster), null, 2));

  // search-index.json
  const sidx = JSON.parse(fs.readFileSync(path.join(DATA_GEN, 'search-index.json'), 'utf8'));
  fs.writeFileSync(path.join(DATA_GEN, 'search-index.json'), JSON.stringify(sidx.map(rewritePoster), null, 2));

  // per-title files
  for (const f of fs.readdirSync(DATA_TITLES)) {
    const fp = path.join(DATA_TITLES, f);
    const t = JSON.parse(fs.readFileSync(fp, 'utf8'));
    rewritePoster(t);
    fs.writeFileSync(fp, JSON.stringify(t, null, 2));
  }
  console.log('✅ All data files updated to use local poster paths.');
}

run();
