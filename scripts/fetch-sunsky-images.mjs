/**
 * SUNSKY wholesale-catalogue image fetcher
 * ========================================
 *   node scripts/fetch-sunsky-images.mjs <items.json> [--install] [--limit N]
 *
 * The fourth source, for the brands the other three cannot reach:
 *   fetch-product-images.mjs   manufacturer sitemaps (Logitech)
 *   fetch-vendor-images.mjs    vendor sitemaps + og:image (Anker, UGREEN...)
 *   fetch-reseller-images.mjs  IT-accessory shops (Onten, Lention)
 *
 * SUNSKY is a Shenzhen wholesaler that lists the no-name accessory brands
 * iTLand buys — Amalink, Onten, EZASHY, Hotron — under their real model codes,
 * photographed on white. Its search is server-rendered, so it needs no browser,
 * and its product art is addressable directly from the listing id:
 *
 *   /p/EDA002408001A/amalink-95121D-...htm
 *   -> https://img.diylooks.com/upload/store/product_l/EDA002408001A.jpg
 *
 * The catch is that its search never returns nothing. Ask for a model it does
 * not stock and it quietly answers with other products by the same brand:
 * "ONTEN CS144S" comes back as Onten US302, CS22DP and BT105, none of them the
 * item. Taking result #1 would therefore file a Bluetooth receiver as an HDMI
 * splitter, so a hit must clear two guards:
 *
 *   1. the model code appears in the product slug AS A WHOLE TOKEN — "95121d"
 *      must not be satisfied by "95121da", nor "cs144s" by "cs144";
 *   2. the item's brand appears in the slug too.
 *
 * Guard 2 was added after guard 1 alone let through a catalogue of nonsense:
 * short codes collide with everything. "CS061" found French manicure stickers,
 * "MX6" a replacement tire for a Zodiac pool-cleaning robot, "V18" a Toyota
 * diagnostic tool, "N300" a OnePlus phone case. Every one of them satisfied the
 * whole-token test. It follows that an item whose brand is unknown cannot be
 * resolved here at all, and is skipped rather than guessed at.
 *
 * Nothing is installed without --install. Stage, build a contact sheet, look at
 * it, and only then install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { codesFor } from './fetch-reseller-images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.image-fetch-cache');
const STAGE = path.join(CACHE, 'sunsky');
const IMAGE_DIR = path.join(ROOT, 'public', 'assets', 'product_images');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SEARCH = 'https://www.sunsky-online.com/product/default!search.do?keyword=';
const ART = (id) => `https://img.diylooks.com/upload/store/product_l/${id}.jpg`;

const get = async (url, text = true) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Distinct search results, in page order: [{ id, slug }]. */
export function searchResults(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/\/p\/([A-Za-z0-9]+)\/([^"']+?)\.htm/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], slug: decodeURIComponent(m[2]) });
  }
  return out;
}

/** Whole-token test — the guard the header describes. */
export function slugHasCode(slug, code) {
  const tokens = slug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const c = code.toLowerCase();
  if (tokens.includes(c)) return true;
  // A hyphenated code ("cb-ce18") arrives here with its hyphen already stripped
  // by codesFor, so also accept it split across two adjacent tokens.
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] + tokens[i + 1] === c) return true;
  return false;
}

/**
 * Brand names as the catalogue spells them. Zoho's own spelling is not always
 * usable: one item is listed as "RDIFIER R10U", a typo for Edifier.
 */
const BRAND_WORDS = {
  Edifier: ['edifier', 'rdifier'],
  'LB-LINK': ['lb', 'lblink', 'lbllink'],
  UGREEN: ['ugreen'],
};

function slugHasBrand(slug, brand) {
  const tokens = slug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const words = BRAND_WORDS[brand] || [String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '')];
  return words.some(w => tokens.includes(w));
}

async function findOne(brand, code) {
  const q = `${brand} ${code}`;
  const html = await get(SEARCH + encodeURIComponent(q));
  const hit = searchResults(html).find(r => slugHasCode(r.slug, code) && slugHasBrand(r.slug, brand));
  return hit ? { ...hit, query: q } : null;
}

const safeBase = (brand, code) => `${brand || 'Item'}_${code.toUpperCase()}`.replace(/[^A-Za-z0-9_.-]/g, '');

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const install = flags.includes('--install');
  const li = flags.indexOf('--limit');
  const limit = li !== -1 ? Number(flags[li + 1]) : Infinity;
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(STAGE, { recursive: true });

  const taken = new Set(fs.readdirSync(IMAGE_DIR).map(f => f.replace(/\.[a-z]+$/i, '').toLowerCase()));
  const staged = [], skipped = [];

  for (const it of items) {
    if (staged.length >= limit) break;
    const name = it.name || it.n || '';
    const brand = it.brand && it.brand !== 'Other' ? it.brand : null;
    // Guard 2 in the header: with no brand there is nothing to corroborate the
    // code against, and short codes collide with the whole catalogue.
    if (!brand) { skipped.push([name, 'no brand — cannot corroborate the model code']); continue; }
    const codes = codesFor(`${name} ${it.sku || it.s || ''}`);
    if (!codes.length) { skipped.push([name, 'no model code']); continue; }

    let hit = null, used = null, failure = null;
    for (const code of codes.slice(0, 4)) {
      try {
        hit = await findOne(brand, code);
      } catch (e) {
        // 403 means the shop has started rate-limiting. Nothing is gained by
        // hammering it for the remaining codes, and the run should say so
        // rather than reporting the models as "not stocked".
        failure = `search failed: ${e.message}`;
        break;
      }
      await sleep(2500);                     // the shop is a courtesy source
      if (hit) { used = code; break; }
    }
    if (!hit) { skipped.push([name, failure || `not stocked: ${codes.slice(0, 4).join(', ')}`]); continue; }

    const base = safeBase(brand, used);
    if (taken.has(base.toLowerCase())) { skipped.push([name, `already have ${base}`]); continue; }
    try {
      const bin = path.join(STAGE, `${base}.bin`);
      fs.writeFileSync(bin, await get(ART(hit.id), false));
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '900', '0', bin, '-o', path.join(STAGE, `${base}.webp`)]);
      fs.unlinkSync(bin);
      taken.add(base.toLowerCase());
      staged.push({ base, item: name, code: used, id: hit.id, slug: hit.slug });
    } catch (e) { skipped.push([name, `image download failed: ${e.message}`]); }
  }

  if (install) for (const s of staged) fs.copyFileSync(path.join(STAGE, `${s.base}.webp`), path.join(IMAGE_DIR, `${s.base}.webp`));
  fs.writeFileSync(path.join(CACHE, 'sunsky-result.json'), JSON.stringify({ staged, skipped }, null, 1));
  console.log(`staged ${staged.length} / ${items.length}${install ? ' (installed)' : ''}`);
  for (const s of staged) console.log(`  ok  ${s.base.padEnd(24)} <- ${s.slug.replace(/-/g, ' ').slice(0, 62)}`);
  console.log(`\nnot resolved: ${skipped.length}  (see .image-fetch-cache/sunsky-result.json)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
