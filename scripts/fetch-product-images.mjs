/**
 * Official product image fetcher
 * ==============================
 *   node scripts/fetch-product-images.mjs "Logitech M240 Silent Bluetooth Mouse" ...
 *   node scripts/fetch-product-images.mjs --file items.json      # [{name, sku}, ...]
 *   node scripts/fetch-product-images.mjs --file items.json --dry-run
 *
 * Why this exists
 * ---------------
 * Product art scraped from a general image search is frequently the wrong
 * model — that is the bug this whole exercise started from. So this script does
 * NOT do image search. It resolves each product to its page on the
 * MANUFACTURER's own site (found via that site's sitemap) and takes the image
 * from that page's gallery.
 *
 * The certainty comes from the URL itself: an image for the MK295 lives at
 *   /products/combos/mk295-keyboard-mouse-combo/gallery/mk295-graphite-...png
 * The model appears in the product path AND the filename, on the vendor's own
 * CDN. A file that does not carry the model in its path is rejected rather than
 * guessed at, so a run either produces a provably-correct image or nothing.
 *
 * Images are saved as <Brand>_<Model>.webp (900px, q82) to match the naming the
 * matcher in lib/product-matching.js expects. Re-run
 * `node scripts/test-image-matching.mjs` afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const CACHE_DIR = path.join(ROOT, '.image-fetch-cache');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 25000;

const get = async (url, asText = true) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return asText ? res.text() : Buffer.from(await res.arrayBuffer());
};

/** Vendors we can resolve with certainty. Each maps a model -> product page. */
const VENDORS = {
  logitech: {
    brands: ['logitech', 'logi', 'logitech g'],
    sitemaps: [
      'https://www.logitech.com/en-us/sitemap.xml',
      'https://www.logitech.com/en-us/sitemap-business.xml',
      // G-series (G102, G903, G560...) lives on the separate gaming site.
      'https://www.logitechg.com/en-us/sitemap.xml',
      'https://www.logitechg.com/en-eu/sitemap.xml',
    ],
    // Product pages live at /shop/p/<slug> or /products/<cat>/<slug>.html
    isProductUrl: (u) => /\/(shop\/p|products)\//.test(u),
    // Gallery art on the Logitech CDN, excluding site furniture.
    imageRe: /https:\/\/resource\.logitech(?:g)?\.com\/[^"'\s\\]+\.(?:png|jpg|jpeg|webp)/g,
    keepImage: (u) => /\/products\//.test(u) && !/og-image|homepage|delorean|logo/i.test(u),
    // Ask the CDN for a big transparent render rather than a thumbnail.
    upscale: (u) => u.replace(/\/[a-z]_[^/]*\/d_transparent\.gif\//, '/w_900,c_limit,q_auto,f_auto/d_transparent.gif/'),
  },
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dense = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Model codes in a product name: letters+digits (m240, mk295, c920, g502). */
function modelCodes(name) {
  return norm(name).split(' ').filter(t => t.length >= 2 && /[a-z]/.test(t) && /\d/.test(t));
}

function vendorFor(name) {
  const n = norm(name);
  for (const [key, v] of Object.entries(VENDORS)) {
    if (v.brands.some(b => n.startsWith(b + ' ') || n === b || n.includes(' ' + b + ' '))) return [key, v];
  }
  return [null, null];
}

async function loadSitemap(key, vendor) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${key}-urls.txt`);
  if (fs.existsSync(cached) && Date.now() - fs.statSync(cached).mtimeMs < 86400000) {
    return fs.readFileSync(cached, 'utf8').split('\n').filter(Boolean);
  }
  const urls = new Set();
  for (const sm of vendor.sitemaps) {
    try {
      const xml = await get(sm);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (vendor.isProductUrl(m[1])) urls.add(m[1]);
      }
    } catch (e) { console.warn(`  ! sitemap ${sm}: ${e.message}`); }
  }
  const list = [...urls];
  fs.writeFileSync(cached, list.join('\n'));
  return list;
}

/**
 * Pick the product page whose slug contains the product's model code. Requires
 * an exact token match so "c270" cannot select the "c270i" page (or vice versa).
 */
function resolvePage(urls, name) {
  const codes = modelCodes(name);
  if (!codes.length) return null;
  const scored = [];
  for (const u of urls) {
    const slug = norm(decodeURIComponent(u.split('/').pop().replace(/\.html$/, '')));
    const slugTokens = new Set(slug.split(' '));
    const hit = codes.filter(c => slugTokens.has(c));
    if (!hit.length) continue;
    // Prefer the page that shares the most words with the product name, so
    // "MX Master 3S" does not land on the "MX Master 3S for Business" page.
    const nameTokens = new Set(norm(name).split(' '));
    const overlap = [...slugTokens].filter(t => nameTokens.has(t)).length;
    scored.push({ url: u, score: hit.length * 100 + overlap - slugTokens.size * 0.1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.url || null;
}

/** Keep only gallery images whose own path carries the model code. */
function pickImage(html, vendor, name) {
  const codes = modelCodes(name);
  const all = [...new Set((html.match(vendor.imageRe) || []).filter(vendor.keepImage))];
  const onModel = all.filter(u => {
    const d = dense(decodeURIComponent(u));
    return codes.some(c => d.includes(c));
  });
  if (!onModel.length) return null;
  // Prefer a straight front/top product shot over lifestyle or detail crops.
  const rank = (u) => {
    const s = u.toLowerCase();
    let r = 0;
    if (/gallery-0?1\b|gallery-1\b|front|top-view|frontview/.test(s)) r -= 10;
    if (/lifestyle|scene|environment|hero-banner|back|side|bottom/.test(s)) r += 10;
    return r;
  };
  return onModel.sort((a, b) => rank(a) - rank(b))[0];
}

function outputName(name) {
  const parts = norm(name).split(' ');
  const brand = parts[0].replace(/^./, c => c.toUpperCase());
  // Drop only words that carry no model identity. "Plus", "Pro", "Max" and
  // anything containing a digit are kept: K400 Plus is a different product
  // from K400, and the matcher scores on exactly these tokens.
  const drop = new Set(['wireless','bluetooth','mouse','keyboard','headset','webcam',
    'combo','usb','silent','for','business','with','and','the','full','hd']);
  const rest = parts.slice(1).filter(t => /\d/.test(t) || !drop.has(t)).slice(0, 4);
  const cap = (t) => (/\d/.test(t) ? t.toUpperCase() : t.replace(/^./, c => c.toUpperCase()));
  return `${brand}_${rest.map(cap).join('_')}`.replace(/_+/g, '_').replace(/_$/, '');
}

async function saveWebp(buf, base) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const tmp = path.join(CACHE_DIR, 'dl.bin');
  fs.writeFileSync(tmp, buf);
  const out = path.join(IMAGE_DIR, `${base}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', tmp, '-o', out]);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  let names = argv.filter(a => !a.startsWith('--'));
  const fileIdx = argv.indexOf('--file');
  if (fileIdx !== -1) {
    const raw = JSON.parse(fs.readFileSync(argv[fileIdx + 1], 'utf8'));
    names = (Array.isArray(raw) ? raw : raw.products || raw.items || [])
      .map(i => (typeof i === 'string' ? i : [i.brand, i.name || i.n].filter(Boolean).join(' ')));
    names = names.filter(n => n && !argv.includes(n));
  }
  if (!names.length) { console.error('No product names given.'); process.exit(1); }

  const sitemaps = {};
  const done = [], skipped = [];
  for (const name of names) {
    const [key, vendor] = vendorFor(name);
    if (!vendor) { skipped.push([name, 'no vendor resolver for this brand']); continue; }
    try {
      sitemaps[key] ||= await loadSitemap(key, vendor);
      const page = resolvePage(sitemaps[key], name);
      if (!page) { skipped.push([name, 'no product page found on vendor site']); continue; }
      const html = await get(page);
      const img = pickImage(html, vendor, name);
      if (!img) { skipped.push([name, `page found but no on-model image (${page})`]); continue; }
      const url = vendor.upscale(img);
      const base = outputName(name);
      if (dryRun) { done.push([name, base, url, page]); continue; }
      const buf = await get(url, false);
      const out = await saveWebp(buf, base);
      done.push([name, path.basename(out), url, page]);
      console.log(`  ok   ${name}\n       -> ${path.basename(out)}  (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
    } catch (e) {
      skipped.push([name, e.message]);
    }
  }

  console.log(`\n${dryRun ? '[dry run] ' : ''}resolved ${done.length}/${names.length}`);
  if (skipped.length) {
    console.log(`\nNeeds manual attention (${skipped.length}):`);
    for (const [n, why] of skipped) console.log(`  - ${n}\n      ${why}`);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, 'last-run.json'), JSON.stringify({ done, skipped }, null, 2));
  console.log(`\nReport: .image-fetch-cache/last-run.json`);
  if (!dryRun && done.length) console.log('Now run: node scripts/test-image-matching.mjs');
}

main();
