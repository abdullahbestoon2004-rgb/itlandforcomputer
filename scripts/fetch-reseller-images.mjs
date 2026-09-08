/**
 * Reseller-catalogue image fetcher
 * ================================
 *   node scripts/fetch-reseller-images.mjs <items.json> [--install] [--limit N]
 *
 * Last resort for brands whose own site is dead or has no catalogue — Onten
 * (onten.net does not resolve at all), Lention's older SKUs, and the long tail
 * of accessory brands. It resolves each item against an IT-accessory reseller's
 * product sitemap, keyed on an EXACT model code found in the product URL.
 *
 * Certainty is weaker here than with a manufacturer CDN, so two guards apply:
 *   1. the model code must appear in the reseller's product URL as a whole
 *      token — "otn-9118" must not satisfy "otn-91182";
 *   2. every result is staged, never installed blind. Review the contact sheet
 *      before passing --install.
 *
 * Guard 2 is not theoretical: these sites' og:image tags frequently point at
 * the shop's own logo, so a first run produced eleven identical orange logos.
 * The WooCommerce gallery image (data-large_image) is used instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.image-fetch-cache');
const STAGE = path.join(CACHE, 'stage');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Reseller product sitemaps, tried in order. */
const RESELLERS = [
  { host: 'www.absoteck.com', sitemap: 'https://www.absoteck.com/product-sitemap.xml' },
  { host: 'www.techmann.at',  sitemap: 'https://www.techmann.at/product-sitemap.xml' },
  // Paginated: WordPress caps each product sitemap at 1000 entries.
  { host: 'www.imediastores.com', sitemap: 'https://www.imediastores.com/product-sitemap.xml' },
  { host: 'www.imediastores.com', sitemap: 'https://www.imediastores.com/product-sitemap2.xml' },
  { host: 'www.imediastores.com', sitemap: 'https://www.imediastores.com/product-sitemap3.xml' },
  { host: 'www.imediastores.com', sitemap: 'https://www.imediastores.com/product-sitemap4.xml' },
  // sinohala publishes only category pages in its sitemap, so its brand
  // listings are paged through instead. It carries the deepest Onten range.
  { host: 'sinohala.com', crawl: 'https://sinohala.com/brands/onten' },
  // sinohala stocks Onten only; /brands/lention and /brands/amalink do not
  // exist there and returned an unrelated page (a phone mount for a cable).
  { host: 'www.macfactory.in',    shopify: true },
  { host: 'macfactorystore.com',  shopify: true },
  { host: 'www.uniqkart.in',      shopify: true },
  // goldentech.tech deliberately omitted: its product photos are watermarked
  // with that shop's own logo, phone numbers and email, which must not appear
  // on iTLand listings.
];

const get = async (url, text = true) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
};

// Specs masquerading as model codes: 4K, 100W, 60Hz, 2M, 1080P, USB3...
const SPEC = /^(?:\d+(?:hz|w|k|v|a|m|mm|cm|ft|gb|tb|mb|mah|bit|p|fps|gbps|mbps|dpi|khz|in|ch)|usb\d*|type\d*|v\d(?:\.\d)?|\d+x\d+|4k|8k|2k|1080p|720p|1440p)$/;

// Interface names, console names and series words that look like model codes but
// identify nothing: an item matching only on "rj45" or "ps5" is not identified.
const NOT_A_MODEL = new Set([
  'rj45', 'rj11', 'gen1', 'gen2', 'gen3', 'ps5', 'ps4', 'ps3', 'xbox360',
  'speak2', 'evolve2', 'usb2', 'usb3', 'usb4', 'usbc', 'usba', 'hdmi2',
  'dp12', 'dp14', 'bt5', 'bt4', 'wifi6', 'wifi5', 'cat6', 'cat5e', 'cat7',
  'm2', '2in1', '3in1', '4in1', '5in1', '6in1', '7in1', '8in1', '9in1',
  '10in1', '11in1', '3d', '2k4k', 'x1', 'x2', 'x3',
  'pd3', 'pd30', 'pd20', 'pd65', 'qc3', 'qc30', 'mst1', 'sst1', 'v20', 'v14',
]);

/** Model codes: letters+digits, or a hyphenated code like OTN-9118 / AL-95121D. */
export function codesFor(text) {
  const out = new Set();
  const t = text || '';
  for (const m of t.matchAll(/\b([A-Za-z]{1,5})-([0-9]{2,6}[A-Za-z]{0,3})\b/g)) out.add((m[1] + m[2]).toLowerCase());
  for (const m of t.matchAll(/\(([A-Za-z]{0,4}-?[0-9]{2,6}[A-Za-z]{0,3})\s*[,)]/g)) out.add(m[1].toLowerCase().replace(/-/g, ''));
  for (const tok of t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (tok.length >= 3 && /[a-z]/.test(tok) && /\d/.test(tok) && !SPEC.test(tok)) out.add(tok);
  }
  return [...out].filter(c => c.length >= 3 && !NOT_A_MODEL.has(c));
}

/** Codes present in a product URL slug, as whole tokens. */
function slugCodes(url) {
  const slug = decodeURIComponent(url).toLowerCase().replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  const parts = slug.split(/[/-]/).filter(Boolean);
  const out = new Set();
  for (const p of parts) if (/[a-z]/.test(p) && /\d/.test(p) && !SPEC.test(p) && !NOT_A_MODEL.has(p)) out.add(p);
  // also join a bare "otn" prefix with the following segment (otn-uc620)
  for (let i = 0; i < parts.length - 1; i++) {
    if (/^[a-z]{2,4}$/.test(parts[i])) out.add(parts[i] + parts[i + 1]);
  }
  return out;
}

async function shopifyProducts(host) {
  const f = path.join(CACHE, `${host}-shopify.json`);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 86400000) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const d = JSON.parse(await get(`https://${host}/products.json?limit=250&page=${page}`));
    if (!d.products?.length) break;
    all.push(...d.products);
    if (d.products.length < 250) break;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(all));
  return all;
}

/** Page through a brand listing, collecting product links. */
async function crawlUrls(r) {
  const key = r.crawl.replace(/[^A-Za-z0-9]+/g, '-').slice(-80);
  const f = path.join(CACHE, `${key}.txt`);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 86400000) {
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  }
  const origin = new URL(r.crawl).origin;
  const all = new Set();
  for (let page = 1; page <= 15; page++) {
    let html;
    try { html = await get(page > 1 ? `${r.crawl}?page=${page}` : r.crawl); } catch { break; }
    const before = all.size;
    for (const l of html.match(/\/products\/[a-z0-9-]+/g) || []) all.add(origin + l);
    if (all.size === before) break;   // a repeated page means the end
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const list = [...all];
  fs.writeFileSync(f, list.join('\n'));
  return list;
}

async function sitemapUrls(r) {
  // Keyed on the sitemap URL, not the host: a paginated shop contributes
  // several entries for the same host and they must not overwrite each other.
  const key = r.sitemap.replace(/[^A-Za-z0-9]+/g, '-').slice(-80);
  const f = path.join(CACHE, `${key}.txt`);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 86400000) {
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  }
  const xml = await get(r.sitemap);
  // Some sitemaps wrap URLs in CDATA (<loc><![CDATA[https://...]]></loc>), which
  // a naive [^<]+ capture silently misses — it read 0 of goldentech's 1000 URLs.
  const urls = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g)]
    .map(m => m[1].trim()).filter(u => /^https?:\/\//.test(u));
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, urls.join('\n'));
  return urls;
}

/** The product photo, not the shop logo. */
function galleryImage(html) {
  const m = html.match(/data-large_image=["']([^"']+)["']/)
        || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/)
        || html.match(/["'](https:\/\/[^"']+\/wp-content\/uploads\/[^"']+?)-?\d*x\d*\.(?:jpg|jpeg|png|webp)["']/);
  return m ? m[1] : null;
}

const safeBase = (brand, code) =>
  `${brand}_${code.toUpperCase()}`.replace(/[^A-Za-z0-9_.-]/g, '');

function brandOf(name) {
  const known = ['Onten', 'Lention', 'Logitech', 'Jabra', 'Poly', 'Plantronics', 'JBL', 'Anker',
    'UGREEN', 'Vention', 'Dell', 'Samsung', 'SanDisk', 'Razer', 'Elgato', 'Edifier', 'Rapoo',
    'Maono', 'Hotron', 'Amalink', 'EZASHY', 'Niye', 'Microsoft', 'HP'];
  const n = (name || '').toLowerCase();
  return known.find(b => n.includes(b.toLowerCase())) || null;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const install = flags.includes('--install');
  const limIdx = flags.indexOf('--limit');
  const limit = limIdx !== -1 ? Number(flags[limIdx + 1]) : Infinity;
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(STAGE, { recursive: true });

  const urls = [];
  // code -> direct image URL, for Shopify shops where products.json already
  // carries the image and no product page needs fetching.
  const direct = new Map();
  for (const r of RESELLERS) {
    try {
      if (r.shopify) {
        for (const p of await shopifyProducts(r.host)) {
          if (!p.images?.length) continue;
          const hay = `${p.title} ${p.handle} ${(p.variants || []).map(v => v.sku || '').join(' ')}`;
          for (const c of codesFor(hay)) if (!direct.has(c)) direct.set(c, { img: p.images[0].src.split('?')[0], page: `https://${r.host}/products/${p.handle}`, title: p.title });
        }
      } else if (r.crawl) {
        urls.push(...await crawlUrls(r));
      } else {
        urls.push(...await sitemapUrls(r));
      }
    } catch (e) { console.warn(`! ${r.host}: ${e.message}`); }
  }
  const index = new Map();
  for (const u of urls) for (const c of slugCodes(u)) if (!index.has(c)) index.set(c, u);

  const staged = [], skipped = [];
  const taken = new Set(fs.readdirSync(IMAGE_DIR).map(f => f.replace(/\.webp$/i, '').toLowerCase()));

  for (const it of items) {
    if (staged.length >= limit) break;
    const name = it.name || it.n || String(it);
    const brand = brandOf(name);
    if (!brand) { skipped.push([name, 'brand not recognised in item name']); continue; }
    const cs = codesFor(`${name} ${it.sku || it.s || ''}`);
    if (!cs.length) { skipped.push([name, 'no model code in name or SKU']); continue; }
    const code = cs.find(c => index.has(c) || direct.has(c));
    if (!code) { skipped.push([name, `no reseller page for ${cs.slice(0, 4).join(', ')}`]); continue; }
    const base = safeBase(brand, code);
    if (taken.has(base.toLowerCase())) { skipped.push([name, `already have ${base}.webp`]); continue; }
    try {
      const hit = direct.get(code);
      const img = hit ? hit.img : galleryImage(await get(index.get(code)));
      if (!img) { skipped.push([name, 'product page had no gallery image']); continue; }
      const buf = await get(img, false);
      const bin = path.join(STAGE, `${base}.bin`);
      fs.writeFileSync(bin, buf);
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', bin, '-o', path.join(STAGE, `${base}.webp`)]);
      fs.unlinkSync(bin);
      taken.add(base.toLowerCase());
      staged.push({ base, item: name, code, page: direct.get(code)?.page || index.get(code), img, source: direct.has(code) ? 'shopify' : 'sitemap' });
    } catch (e) { skipped.push([name, e.message]); }
  }

  if (install) for (const s of staged) fs.copyFileSync(path.join(STAGE, `${s.base}.webp`), path.join(IMAGE_DIR, `${s.base}.webp`));
  fs.writeFileSync(path.join(CACHE, 'reseller-result.json'), JSON.stringify({ staged, skipped }, null, 1));
  console.log(`staged ${staged.length} / ${items.length}${install ? ' (installed)' : ''}`);
  for (const s of staged) console.log(`  ok  ${s.base.padEnd(26)} <- ${s.item.slice(0, 50)}`);
  console.log(`\nnot resolved: ${skipped.length}  (see .image-fetch-cache/reseller-result.json)`);
}

// Only run when invoked directly — this module also exports codesFor() for
// reuse, and importing it must not kick off a fetch run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
