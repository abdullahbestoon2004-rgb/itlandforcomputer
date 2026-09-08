/**
 * Stage a product image from a page or image URL
 * ==============================================
 *   node scripts/stage-image.mjs <Brand_MODEL> <url> [<Brand_MODEL> <url> ...]
 *   node scripts/stage-image.mjs --file pairs.tsv
 *   node scripts/stage-image.mjs --install <Brand_MODEL> <url>
 *   node scripts/stage-image.mjs --sheet                 # contact sheet of the stage
 *
 * The three bulk fetchers each resolve a whole brand from one catalogue. This
 * one handles the long tail they cannot: discontinued models, one-off items,
 * and brands with no scrapable catalogue at all — the cases where a person has
 * to find the product page first and hand the URL over.
 *
 * Given a page URL it takes the largest gallery image it can identify; given an
 * image URL it takes that directly. Everything lands in .image-fetch-cache/
 * manual/ as <Brand_MODEL>.webp and stays there until --install, because the
 * point of this script is that a human chose the page and a human should look
 * at what came back. `--sheet` builds the montage for that look.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, '.image-fetch-cache', 'manual');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const get = async (url, text = true) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: text ? 'text/html,*/*' : 'image/*,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
};

const IS_IMAGE = /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i;

/** Never a product photo, whatever tag it arrived in. */
const FURNITURE = /logo|sprite|icon|favicon|badge|placeholder|avatar|spacer|social|og-image|og_image|banner|hero-|-hero|payment|flag|thumb_up|star|mega-menu|\/menu\/|menu-|nav-|-nav\.|official-store|store-header|non-product-images|video-thumbnail/i;

/**
 * The product photo on a shop or vendor page.
 *
 * Not "whichever tag matches first". og:image is the most common tag and the
 * least trustworthy: on WooCommerce shops it is often the shop's own logo, and
 * on logitech.com it is a brand card — a first pass took it from seven product
 * pages and got the Logitech wordmark six times.
 *
 * So every candidate in the page is collected and scored, and the model code
 * decides. An image whose own filename carries the model is the product almost
 * by definition; that is the same reasoning fetch-product-images.mjs uses, and
 * it is what separates a real hit from a plausible one.
 */
export function pageImage(html, base, model = '', loose = false) {
  const cand = new Map();                       // url -> score
  const add = (raw, bonus) => {
    if (!raw) return;
    let url;
    try { url = new URL(raw.replace(/&amp;/g, '&'), base).href; } catch { return; }
    if (!IS_IMAGE.test(url) || FURNITURE.test(url)) return;
    cand.set(url, Math.max(cand.get(url) ?? -Infinity, bonus));
  };

  // Tagged candidates, best-tag-first as a tiebreak only.
  for (const m of html.matchAll(/data-large_image=["']([^"']+)["']/g)) add(m[1], 5);
  for (const m of html.matchAll(/data-zoom-image=["']([^"']+)["']/g)) add(m[1], 5);
  for (const m of html.matchAll(/"image"\s*:\s*"(https:[^"]+?)"/gi)) add(m[1], 4);
  for (const m of html.matchAll(/<meta[^>]+og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) add(m[1], 2);
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) add(m[1], 1);
  for (const m of html.matchAll(/https:\/\/[^"'\s\\<>]+\.(?:jpe?g|png|webp)/gi)) add(m[0], 0);

  // The model in the image's own path outranks any tag it came from. Scored per
  // token rather than as a yes/no: a bare code ("g705") is one decisive hit,
  // while a worded model ("rally mic pod extension") accumulates several, and
  // an unrelated asset on the same page collects none.
  const codes = String(model).toLowerCase().split(/[^a-z0-9]+/).filter(c => c.length >= 3);
  const scored = [...cand].map(([url, tag]) => {
    let s = tag;
    const p = url.toLowerCase();
    for (const c of codes) if (p.includes(c)) s += /\d/.test(c) ? 20 : 7;
    if (/\/gallery\//.test(p)) s += 6;
    if (/\/product/.test(p)) s += 3;
    return [url, s];
  }).sort((a, b) => b[1] - a[1]);

  if (!scored.length) return null;
  // With a model to go on, a page must prove itself: some candidate has to
  // carry the model in its own path. Retailer pages are full of navigation
  // art that outscores nothing in particular, and taking the best of a bad
  // field is how a Dell dock became an accessories bundle and a Poly headset
  // became a laptop. Rejecting is cheap; a wrong photo on a price list is not.
  //
  // --loose lifts the rule for shops that name their files by an internal id
  // instead of the model. It buys nothing for free: a loose result is marked
  // UNVERIFIED in the run output and has to be judged on the contact sheet.
  if (codes.length && !loose) {
    const [best] = scored[0];
    if (!codes.some(c => best.toLowerCase().includes(c))) return null;
  }
  return scored[0][0];
}

/**
 * Ask a known CDN for the full-size render.
 *
 * Logitech's og:image is a `c_fill` crop sized for a social card, which cuts
 * the product off at the edges. The same asset under `w_900,c_limit` is the
 * whole product on transparency.
 */
export function fullSize(url) {
  return url
    // Logitech: any social-card transform (c_fill crop, or w_1200,h_630 letterbox)
    // becomes a 900px limit, which keeps the whole product.
    .replace(/\/[a-z]+_[^/]*\/d_transparent\.gif\//, '/w_900,c_limit,q_auto,f_auto/d_transparent.gif/')
    .replace(/(\/upload\/)w_\d+,h_\d+[^/]*\//, '$1w_900,c_limit/')     // Cloudinary
    .replace(/_\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1')                     // Shopify -_600x600
    .replace(/\?.*$/, '');
}

async function stageOne(base, url, loose = false) {
  // <Brand>_<MODEL> — the model half is what the page's images are scored on.
  const model = base.split('_').slice(1).join(' ');
  const found = IS_IMAGE.test(url) ? url : pageImage(await get(url), url, model, loose);
  if (!found) throw new Error('no product image on that page');
  const src = fullSize(found);
  const verified = IS_IMAGE.test(url)
    || model.toLowerCase().split(/[^a-z0-9]+/).filter(c => c.length >= 3)
         .some(c => src.toLowerCase().includes(c));
  const bin = path.join(STAGE, `${base}.bin`);
  fs.mkdirSync(STAGE, { recursive: true });
  fs.writeFileSync(bin, await get(src, false));
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', bin, '-o', path.join(STAGE, `${base}.webp`)]);
  fs.unlinkSync(bin);
  return { src, verified };
}

/**
 * Contact sheet of everything staged, so a batch can be judged at a glance.
 *
 * Written as HTML rather than an ImageMagick montage: `montage` is not
 * installed here, and a browser renders WebP directly, captions included.
 */
function sheet() {
  const files = fs.readdirSync(STAGE).filter(f => f.endsWith('.webp')).sort();
  if (!files.length) { console.log('nothing staged'); return; }
  // Inlined as data URIs, not linked: the sheet is opened through a preview
  // pane that serves it from a data: URL of its own, where a relative src
  // resolves to nothing and every cell renders as a broken-image icon.
  const cells = files.map(f => {
    const b64 = fs.readFileSync(path.join(STAGE, f)).toString('base64');
    return `
    <figure><img src="data:image/webp;base64,${b64}" alt="${f}"><figcaption>${f.replace(/\.webp$/, '')}</figcaption></figure>`;
  }).join('');
  const out = path.join(STAGE, 'sheet.html');
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>staged (${files.length})</title>
<style>
 body{font:12px/1.4 -apple-system,sans-serif;background:#fff;margin:16px}
 h1{font-size:15px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
 figure{margin:0;border:1px solid #ddd;border-radius:8px;padding:8px;text-align:center}
 img{width:100%;height:170px;object-fit:contain;background:#fafafa}
 figcaption{margin-top:6px;font-size:11px;color:#333;word-break:break-all}
</style><h1>${files.length} staged</h1><div class="grid">${cells}</div>`);
  console.log(out);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--sheet')) return sheet();

  const install = argv.includes('--install');
  const loose = argv.includes('--loose');
  const rest = argv.filter(a => a !== '--install' && a !== '--loose');
  let pairs = [];
  const fi = rest.indexOf('--file');
  if (fi !== -1) {
    pairs = fs.readFileSync(rest[fi + 1], 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/\s+/, 2));
  } else {
    for (let i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
  }

  let ok = 0;
  for (const [base, url] of pairs) {
    try {
      const { src, verified } = await stageOne(base, url, loose);
      console.log(`  ${verified ? 'ok ' : 'UNVERIFIED'} ${base.padEnd(30)} <- ${src.slice(0, 88)}`);
      if (install) fs.copyFileSync(path.join(STAGE, `${base}.webp`), path.join(IMAGE_DIR, `${base}.webp`));
      ok++;
    } catch (e) {
      console.log(`  --  ${base.padEnd(30)} ${e.message}`);
    }
  }
  console.log(`\n${ok}/${pairs.length} staged in ${path.relative(ROOT, STAGE)}${install ? ' (installed)' : ''}`);
}

main();
