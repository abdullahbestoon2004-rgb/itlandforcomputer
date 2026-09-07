/**
 * Brand catalogue image fetcher
 * =============================
 *   node scripts/fetch-brand-images.mjs <batch.json> <brand> [--install]
 *
 * Complements fetch-product-images.mjs (which handles Logitech's bespoke site).
 * Two strategies, both keyed on an EXACT model code — never a fuzzy title match:
 *
 *   shopify : pull the store's public products.json and match on model code.
 *   sitemap : find the product page whose slug carries the model code, then
 *             take the og:image / first gallery image from that page.
 *
 * Exactness is the whole point. An earlier version of this matching accepted a
 * substring hit and paired Lention's CB-C8 with CB-C8s — a different product
 * with an extra CF slot. Codes are therefore compared as whole tokens only.
 *
 * Output is staged to .image-fetch-cache/stage/ for visual review; pass
 * --install to copy into public/assets/product_images/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const CACHE = path.join(ROOT, '.image-fetch-cache');
const STAGE = path.join(CACHE, 'stage');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BRANDS = {
  ugreen:  { kind: 'shopify', host: 'www.ugreen.com',        label: 'UGREEN' },
  maono:   { kind: 'shopify', host: 'www.maono.com',         label: 'Maono' },
  edifier: { kind: 'shopify', host: 'edifier-online.com',    label: 'Edifier' },
  lention: { kind: 'shopify', host: 'www.lention.com',       label: 'Lention' },
  jabra:   { kind: 'sitemap', host: 'www.jabra.com',   sitemaps: ['https://www.jabra.com/sitemap.xml'], label: 'Jabra' },
  anker:   { kind: 'sitemap', host: 'www.anker.com',   sitemaps: ['https://www.anker.com/sitemap.xml'], label: 'Anker' },
  elgato:  { kind: 'sitemap', host: 'www.elgato.com',  sitemaps: ['https://www.elgato.com/sitemap.xml'], label: 'Elgato' },
  razer:   { kind: 'sitemap', host: 'www.razer.com',   sitemaps: ['https://www.razer.com/sitemap.xml'], label: 'Razer' },
  rapoo:   { kind: 'sitemap', host: 'www.rapoo.com',   sitemaps: ['https://www.rapoo.com/sitemap.xml'], label: 'Rapoo' },
};

const get = async (url, text = true) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
};

const normTokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * Model codes for an item: a parenthesised code, a hyphenated code (OTN-9118,
 * AL-95121D, BL-WN351), or a letters+digits token. Pure numbers are excluded —
 * product titles are full of incidental ones (100W, 4K, 2M).
 */
// Tokens that look like model codes but are really specifications. Matching on
// one of these is how "USB-C to DP 8K 60Hz" got paired with an unrelated
// product whose title also said 60Hz.
const SPEC_TOKEN = /^(?:\d+(?:hz|w|k|v|a|m|mm|cm|ft|gb|tb|mb|mah|bit|p|fps|gbps|mbps|dpi|ma|nm|in|pin|port|khz)|(?:usb|type)\d*|\d+x\d+|\d+ch|4k|8k|1080p|720p|2k)$/;

export function codesFor(text) {
  const out = new Set();
  const t = text || '';
  for (const m of t.matchAll(/\(([A-Za-z]{1,4}-?[0-9]{1,5}[A-Za-z]{0,3})\s*[,)]/g)) out.add(m[1].toLowerCase().replace(/-/g, ''));
  for (const m of t.matchAll(/\b([A-Za-z]{2,5}-[0-9]{2,5}[A-Za-z]{0,3})\b/g)) out.add(m[1].toLowerCase().replace(/-/g, ''));
  for (const tok of normTokens(t)) {
    if (tok.length >= 3 && /[a-z]/.test(tok) && /\d/.test(tok)) out.add(tok);
  }
  for (const c of [...out]) if (SPEC_TOKEN.test(c)) out.delete(c);
  return [...out];
}

/** Whole-token comparison: c8 must not match c8s, ce35 must not match ce35p. */
const codesOfTitle = (title) => new Set(codesFor(title));

async function shopifyCatalogue(host) {
  const cacheFile = path.join(CACHE, `${host}-products.json`);
  if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 86400000) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const all = [];
  for (let page = 1; page <= 12; page++) {
    const d = JSON.parse(await get(`https://${host}/products.json?limit=250&page=${page}`));
    if (!d.products?.length) break;
    all.push(...d.products);
    if (d.products.length < 250) break;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(all));
  return all;
}

async function sitemapUrls(brand) {
  const cacheFile = path.join(CACHE, `${brand.host}-urls.txt`);
  if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 86400000) {
    return fs.readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean);
  }
  const urls = new Set();
  const queue = [...brand.sitemaps];
  while (queue.length && urls.size < 20000) {
    const sm = queue.shift();
    try {
      const xml = await get(sm);
      const isIndex = /<sitemapindex/i.test(xml);
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (isIndex) { if (queue.length < 25 && /sitemap/i.test(m[1])) queue.push(m[1]); }
        else urls.add(m[1]);
      }
    } catch { /* a dead sub-sitemap must not abort the rest */ }
  }
  const list = [...urls];
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cacheFile, list.join('\n'));
  return list;
}

function pageImage(html) {
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return og ? og[1] : null;
}

async function main() {
  const [batchFile, brandKey, ...flags] = process.argv.slice(2);
  const install = flags.includes('--install');
  const brand = BRANDS[brandKey];
  if (!brand) { console.error(`Unknown brand '${brandKey}'. Known: ${Object.keys(BRANDS).join(', ')}`); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  fs.mkdirSync(STAGE, { recursive: true });

  const matched = [], rejected = [];

  if (brand.kind === 'shopify') {
    const cat = await shopifyCatalogue(brand.host);
    const index = new Map();
    for (const p of cat) {
      const hay = `${p.title} ${p.handle} ${(p.variants || []).map(v => v.sku || '').join(' ')}`;
      for (const c of codesOfTitle(hay)) if (!index.has(c)) index.set(c, p);
    }
    for (const it of items) {
      const cs = codesFor(`${it.name} ${it.sku || ''}`);
      if (!cs.length) { rejected.push([it.name, 'no model code in name or SKU']); continue; }
      const hit = cs.map(c => index.get(c)).find(Boolean);
      if (!hit?.images?.length) { rejected.push([it.name, `no exact code match in ${brand.label} catalogue (tried ${cs.join(', ')})`]); continue; }
      matched.push({ item: it.name, code: cs.find(c => index.get(c)), title: hit.title, img: hit.images[0].src.split('?')[0] });
    }
  } else {
    const urls = await sitemapUrls(brand);
    for (const it of items) {
      const cs = codesFor(`${it.name} ${it.sku || ''}`);
      if (!cs.length) { rejected.push([it.name, 'no model code in name or SKU']); continue; }
      const page = urls.find(u => {
        const slugCodes = new Set(codesFor(decodeURIComponent(u.split('/').filter(Boolean).pop() || '')));
        return cs.some(c => slugCodes.has(c));
      });
      if (!page) { rejected.push([it.name, `no product page for ${cs.join(', ')} on ${brand.host}`]); continue; }
      try {
        const img = pageImage(await get(page));
        if (!img) { rejected.push([it.name, `page found but no image (${page})`]); continue; }
        matched.push({ item: it.name, code: cs[0], title: page, img });
      } catch (e) { rejected.push([it.name, `${e.message} (${page})`]); }
    }
  }

  const staged = [];
  const seen = new Set();
  for (const m of matched) {
    const base = `${brand.label}_${m.code.toUpperCase()}`;
    if (seen.has(base)) { staged.push({ base, ...m, dedup: true }); continue; }
    seen.add(base);
    try {
      const buf = await get(m.img, false);
      const bin = path.join(STAGE, `${base}.bin`);
      fs.writeFileSync(bin, buf);
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', bin, '-o', path.join(STAGE, `${base}.webp`)]);
      fs.unlinkSync(bin);
      staged.push({ base, ...m });
    } catch (e) { rejected.push([m.item, `download/convert failed: ${e.message}`]); }
  }

  if (install) {
    for (const s of staged) {
      const src = path.join(STAGE, `${s.base}.webp`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(IMAGE_DIR, `${s.base}.webp`));
    }
  }

  fs.writeFileSync(path.join(CACHE, `${brandKey}-result.json`), JSON.stringify({ staged, rejected }, null, 1));
  console.log(`${brand.label}: matched ${matched.length}/${items.length}${install ? ' (installed)' : ' (staged)'}`);
  for (const s of staged) if (!s.dedup) console.log(`  ok  ${s.base}  <- ${s.item.slice(0, 56)}`);
  if (rejected.length) {
    console.log(`  rejected (${rejected.length}):`);
    for (const [n, w] of rejected) console.log(`    - ${n.slice(0, 52)}  :: ${w}`);
  }
}

main();
