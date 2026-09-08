/**
 * Vendor product-image fetcher (sitemap + og:image)
 * =================================================
 *   node scripts/fetch-vendor-images.mjs <brand> [--install]
 *   node scripts/fetch-vendor-images.mjs anker --install
 *
 * Complements the other two fetchers:
 *   fetch-product-images.mjs   Logitech, whose gallery URLs encode the model
 *   fetch-reseller-images.mjs  brands with no working site of their own
 * This one covers vendors that publish a product sitemap and put a usable
 * product shot in og:image.
 *
 * The model code is matched as a whole token against the product URL, and the
 * downloaded image is reported with its CDN filename so the model can be
 * confirmed before installing — Anker names its files A83800A1-Anker_553_...png,
 * which proves the picture belongs to the product.
 *
 * Nothing is installed without --install. That matters: a loose match on "544"
 * pulled Anker's A2554 MagSafe stand for a 544 PowerLine cable, which only the
 * visual check caught.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.image-fetch-cache');
const STAGE = path.join(CACHE, 'vendor');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const VENDORS = {
  anker:   { label: 'Anker',   sitemaps: ['https://www.anker.com/server-sitemap-index-products.xml'] },
  soundcore: { label: 'Anker', sitemaps: ['https://www.soundcore.com/sitemap.xml'] },
  ugreen:  { label: 'UGREEN',  sitemaps: ['https://www.ugreen.com/sitemap.xml'] },
  elgato:  { label: 'Elgato',  sitemaps: ['https://www.elgato.com/us-sitemap.xml'] },
  razer:   { label: 'Razer',   sitemaps: ['https://www.razer.com/sitemap.xml'] },
  rapoo:   { label: 'Rapoo',   sitemaps: ['https://www.rapoo.com/sitemap.xml'] },
  edifier: { label: 'Edifier', sitemaps: ['https://www.edifier.com/sitemap.xml'] },
  maono:   { label: 'Maono',   sitemaps: ['https://www.maono.com/sitemap.xml'] },
  dell:    { label: 'Dell',    sitemaps: ['https://www.dell.com/sitemap.xml'] },
};

const get = async (url, text = true) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
};

const locs = (xml) =>
  [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g)]
    .map(m => m[1].trim()).filter(u => /^https?:\/\//.test(u));

export async function vendorUrls(key) {
  const v = VENDORS[key];
  const cached = path.join(CACHE, `vendor-${key}-urls.txt`);
  if (fs.existsSync(cached) && Date.now() - fs.statSync(cached).mtimeMs < 86400000) {
    return fs.readFileSync(cached, 'utf8').split('\n').filter(Boolean);
  }
  const out = new Set();
  const queue = [...v.sitemaps];
  while (queue.length && out.size < 40000) {
    const sm = queue.shift();
    try {
      const xml = await get(sm);
      if (/<sitemapindex/i.test(xml)) {
        for (const u of locs(xml)) if (queue.length < 30 && /product/i.test(u)) queue.push(u);
      } else {
        for (const u of locs(xml)) out.add(u);
      }
    } catch { /* a dead sub-sitemap must not abort the rest */ }
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const list = [...out];
  fs.writeFileSync(cached, list.join('\n'));
  return list;
}

/**
 * Whole-token presence of `code` in a URL path.
 *
 * Codes may be multi-token ("cam-link-4k" against
 * /us/en/p/cam-link-4k), so they are compared as a consecutive run of tokens
 * rather than a single one. A single-token code may also carry a short vendor
 * suffix, since Anker lists A8380 at /products/a83800a1-f0.
 */
export function urlHasCode(url, code) {
  const tok = (v) => decodeURIComponent(v).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const parts = tok(url);
  const want = tok(code);
  if (!want.length) return false;
  if (want.length === 1) {
    const c = want[0];
    return parts.some(p => p === c || (p.startsWith(c) && p.length <= c.length + 4));
  }
  for (let i = 0; i + want.length <= parts.length; i++) {
    if (want.every((w, j) => parts[i + j] === w)) return true;
  }
  return false;
}

export function ogImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1].split('?')[0] : null;
}

export async function fetchForCode(key, code, base) {
  const urls = await vendorUrls(key);
  const hits = urls.filter(u => urlHasCode(u, code))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  if (!hits.length) return { code, error: 'no product page for this model' };
  const page = hits[0];
  const img = ogImage(await get(page));
  if (!img) return { code, page, error: 'page has no og:image' };
  fs.mkdirSync(STAGE, { recursive: true });
  const bin = path.join(STAGE, `${base}.bin`);
  fs.writeFileSync(bin, await get(img, false));
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', bin, '-o', path.join(STAGE, `${base}.webp`)]);
  fs.unlinkSync(bin);
  return { code, base, page, img, file: decodeURIComponent(img.split('/').pop()) };
}

async function main() {
  const [key, ...flags] = process.argv.slice(2);
  if (!VENDORS[key]) { console.error(`Unknown vendor. Known: ${Object.keys(VENDORS).join(', ')}`); process.exit(1); }
  const urls = await vendorUrls(key);
  console.log(`${VENDORS[key].label}: ${urls.length} product URLs in sitemap`);
  const codes = flags.filter(f => !f.startsWith('--'));
  for (const code of codes) {
    const r = await fetchForCode(key, code, `${VENDORS[key].label}_${code.toUpperCase()}`);
    console.log(r.error ? `  --  ${code}: ${r.error}` : `  ok  ${r.base}  <- ${r.file.slice(0, 60)}`);
    if (!r.error && flags.includes('--install')) {
      fs.copyFileSync(path.join(STAGE, `${r.base}.webp`), path.join(IMAGE_DIR, `${r.base}.webp`));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
