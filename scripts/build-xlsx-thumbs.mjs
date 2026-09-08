/**
 * Build Excel thumbnails
 * ======================
 *   node scripts/build-xlsx-thumbs.mjs
 *
 * Writes a small JPEG for every product image into
 * public/assets/xlsx-thumbs/, for embedding in the Excel export.
 *
 * Why a build step rather than converting on demand:
 *
 *  - Excel does not reliably render WebP, and every product image is WebP.
 *  - The conversion needs `dwebp`, which exists on a developer machine but not
 *    in a Vercel serverless function — so the deployed export could not have
 *    produced images at all, and the endpoint 404'd for want of one.
 *
 * Committing the thumbnails lets both the Node server (reads them from disk)
 * and the serverless function (fetches them over HTTP from its own deployment)
 * embed the same pictures, with no image tooling at run time.
 *
 * Run after adding product images, alongside the manifest regeneration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'assets', 'product_images');
const OUT = path.join(ROOT, 'public', 'assets', 'xlsx-thumbs');
const PX = 128;           // 2x the ~64px cell, so it stays sharp
const QUALITY = 72;

function main() {
  if (!fs.existsSync(SRC)) { console.error(`No product images at ${SRC}`); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const sources = fs.readdirSync(SRC).filter(f => /\.webp$/i.test(f));
  let built = 0, skipped = 0, failed = 0;

  for (const file of sources) {
    const src = path.join(SRC, file);
    const dest = path.join(OUT, file.replace(/\.webp$/i, '.jpg'));
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) { skipped++; continue; }
    const tmp = path.join(OUT, '.tmp.png');
    try {
      // dwebp decodes to PNG; cjpeg is not guaranteed present, so go via cwebp's
      // sibling tooling only for decode and let sips do the JPEG encode.
      execFileSync('dwebp', ['-quiet', '-resize', String(PX), '0', src, '-o', tmp]);
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), tmp, '--out', dest], { stdio: 'ignore' });
      built++;
    } catch (e) {
      failed++;
      console.warn(`  ! ${file}: ${e.message.split('\n')[0]}`);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }

  // Drop thumbnails whose source image is gone.
  const valid = new Set(sources.map(f => f.replace(/\.webp$/i, '.jpg')));
  let removed = 0;
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.jpg') && !valid.has(f)) { fs.unlinkSync(path.join(OUT, f)); removed++; }
  }

  const total = fs.readdirSync(OUT).filter(f => f.endsWith('.jpg')).length;
  const bytes = fs.readdirSync(OUT).filter(f => f.endsWith('.jpg'))
    .reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`thumbnails: ${built} built, ${skipped} unchanged, ${removed} removed, ${failed} failed`);
  console.log(`total: ${total} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

main();
