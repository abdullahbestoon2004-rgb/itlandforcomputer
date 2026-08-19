/**
 * Automatic Image Finder & Downloader for iTLand
 * -----------------------------------------------
 * Scans all products, identifies any missing images,
 * automatically searches online for the exact product photo,
 * and saves it directly into public/assets/product_images/
 *
 * Usage:
 *   node scripts/auto-fetch-images.js
 *   node scripts/auto-fetch-images.js "Logitech MX Master 3S"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGE_DIR = path.join(ROOT_DIR, 'public', 'assets', 'product_images');

if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

// ── Search DuckDuckGo for product images ────────────────────────────────────
export async function searchProductImages(query, limit = 5) {
  try {
    const cleanQuery = query.replace(/[^a-zA-Z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery + ' product')}`;
    const tokenRes = await fetch(tokenUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=([0-9-]+)/) || html.match(/vqd=([a-zA-Z0-9_-]+)/) || html.match(/vqd="([^"]+)"/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    const imgUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}`;
    const imgRes = await fetch(imgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://duckduckgo.com/',
      },
    });

    const data = await imgRes.json();
    return (data.results || []).slice(0, limit).map((r) => ({
      title: r.title,
      image: r.image,
      thumbnail: r.thumbnail,
      width: r.width,
      height: r.height,
      source: r.url,
    }));
  } catch (err) {
    console.error(`Search failed for "${query}":`, err.message);
    return [];
  }
}

// ── Download image and save locally ─────────────────────────────────────────
export async function downloadProductImage(url, filename) {
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
  const dest = path.join(IMAGE_DIR, safeFilename);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error(`Image file too small (${buf.length} bytes)`);

    fs.writeFileSync(dest, buf);
    return { success: true, filename: safeFilename, path: `/assets/product_images/${safeFilename}`, size: buf.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Image Matching Logic ───────────────────────────────────────────────────
const BRAND_SYNONYMS = {
  logitech: ['logitech', 'logi', 'ultimate ears', 'ue', 'blue yeti', 'blue snowball', 'astro'],
  poly: ['poly', 'plantronics', 'polycom'],
  plantronics: ['poly', 'plantronics', 'polycom'],
  anker: ['anker', 'soundcore', 'eufy', 'nebula'],
  jabra: ['jabra'],
  jbl: ['jbl'],
  onten: ['onten'],
  lention: ['lention'],
  dell: ['dell'],
  elgato: ['elgato'],
  razer: ['razer'],
  samsung: ['samsung'],
  sandisk: ['sandisk'],
  ugreen: ['ugreen'],
  vention: ['vention'],
  dm: ['dm'],
};

function normalizeString(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesWordExact(text, word) {
  if (!text || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reg = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return reg.test(text);
}

export function findMatchingImage(item, imageFiles = []) {
  if (!item || imageFiles.length === 0) return null;
  const rawName = (item.name || item.n || '').trim();
  const rawSku = (item.sku || item.s || '').trim();
  const rawDesc = (item.description || item.purchase_description || item.d || '').replace(/\s+/g, ' ').trim();
  const rawBrand = (item.brand || '').trim();

  // Combine Name, SKU, Description, Purchase Description, Barcode to catch Zoho titles
  const combinedText = [rawName, rawSku, rawDesc, rawBrand, item.barcode].filter(Boolean).join(' ');
  const titleText = normalizeString(combinedText);
  const titleDense = combinedText.toLowerCase().replace(/[^a-z0-9]/g, '');

  let productBrand = rawBrand.toLowerCase().trim();
  if (!productBrand) {
    for (const [bKey, aliases] of Object.entries(BRAND_SYNONYMS)) {
      if (aliases.some((a) => matchesWordExact(titleText, a))) {
        productBrand = bKey;
        break;
      }
    }
  }

  let bestFile = null;
  let bestScore = 0;

  for (const file of imageFiles) {
    const rawNoExt = file.replace(/\.[^.]+$/, '');
    const parts = rawNoExt.split('_');
    const imgBrand = parts[0].toLowerCase();
    const modelTokens = parts.slice(1).map((p) => p.toLowerCase());
    const fullModelName = modelTokens.join(' ');
    const modelDense = fullModelName.replace(/[^a-z0-9]/g, '');

    if (productBrand) {
      const allowedAliases = BRAND_SYNONYMS[productBrand] || [productBrand];
      const isBrandMatch = allowedAliases.some((a) => a === imgBrand || BRAND_SYNONYMS[imgBrand]?.includes(a));
      if (!isBrandMatch) continue;
    } else {
      if (!matchesWordExact(titleText, imgBrand)) continue;
    }

    let score = 0;

    // 1. Exact model dense match in text (e.g. "sync20plus", "speak510uc", "mxmaster3s", "brio4k", "otn9118")
    if (modelDense.length >= 3 && titleDense.includes(modelDense)) {
      score += 400 + modelDense.length * 10;
    } else if (fullModelName && matchesWordExact(titleText, fullModelName)) {
      score += 350 + fullModelName.length * 10;
    }

    let matchedDistinctiveTokens = 0;
    let totalDistinctiveTokens = 0;

    for (const token of modelTokens) {
      const subTokens = token.split(/[^a-z0-9]/).filter(Boolean);
      for (const st of subTokens) {
        if (st.length <= 1) continue;
        const hasDigits = /\d/.test(st);
        const isAlphaOnly = /^[a-z]+$/.test(st);
        const stDense = st.replace(/[^a-z0-9]/g, '');

        if (hasDigits && /[a-z]/.test(st)) {
          totalDistinctiveTokens++;
          if (matchesWordExact(titleText, st) || titleDense.includes(stDense)) {
            score += 200 + st.length * 5;
            matchedDistinctiveTokens++;
          }
        } else if (hasDigits && st.length >= 2) {
          // Model number with 2+ digits (e.g. "20", "65", "510", "555", "920")
          totalDistinctiveTokens++;
          if (matchesWordExact(titleText, st) || titleDense.includes(stDense)) {
            score += 120 + st.length * 5;
            matchedDistinctiveTokens++;
          }
        } else if (isAlphaOnly && st.length >= 3 && !['plus', 'silent', 'pro', 'max', 'wireless', 'bluetooth', 'lightspeed'].includes(st)) {
          totalDistinctiveTokens++;
          if (matchesWordExact(titleText, st) || titleDense.includes(stDense)) {
            score += 70 + st.length * 3;
            matchedDistinctiveTokens++;
          }
        }
      }
    }

    if (totalDistinctiveTokens > 0 && matchedDistinctiveTokens === totalDistinctiveTokens) {
      score += 150;
    } else if (totalDistinctiveTokens > 1 && matchedDistinctiveTokens < totalDistinctiveTokens) {
      score = Math.max(0, score - 80);
    }

    if (score >= 100 && score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile ? `/assets/product_images/${bestFile}` : null;
}

// ── CLI Runner ─────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2);
  const customQuery = args.join(' ').trim();

  const imageFiles = fs.readdirSync(IMAGE_DIR);
  console.log(`\n📦 iTLand Auto Image Finder`);
  console.log(`Current image library: ${imageFiles.length} images\n`);

  if (customQuery) {
    console.log(`🔍 Searching images for custom item: "${customQuery}"...`);
    const results = await searchProductImages(customQuery, 5);
    if (results.length === 0) {
      console.log(`❌ No images found online.`);
      return;
    }
    console.log(`Found ${results.length} candidates:`);
    results.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.title}\n      URL: ${r.image}`);
    });

    const best = results[0];
    const brandGuess = customQuery.split(' ')[0];
    const modelGuess = customQuery.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${modelGuess}.jpg`;

    console.log(`\n⬇️ Downloading top candidate as "${filename}"...`);
    const downloadRes = await downloadProductImage(best.image, filename);
    if (downloadRes.success) {
      console.log(`✅ Successfully saved to: ${downloadRes.path} (${downloadRes.size} bytes)\n`);
    } else {
      console.error(`❌ Download failed: ${downloadRes.error}\n`);
    }
    return;
  }

  // Auto-scan all catalog items
  let products = [];
  const cachePath = path.join(ROOT_DIR, 'items-cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      products = cache.items || [];
    } catch {}
  }

  if (products.length === 0) {
    products = [
      { id: "1", name: "Logitech MX Master 3S Wireless Mouse", sku: "910-006557", brand: "Logitech" },
      { id: "2", name: "Logitech MX Keys S Wireless Keyboard", sku: "920-011558", brand: "Logitech" },
      { id: "3", name: "Anker 555 USB-C Hub 8-in-1 PowerExpand", sku: "A83830A1", brand: "Anker" },
      { id: "4", name: "Poly Voyager Focus 2 UC Headset", sku: "213726-01", brand: "Poly" },
      { id: "5", name: "Jabra Evolve2 65 Wireless Headset", sku: "26599-989-999", brand: "Jabra" },
      { id: "6", name: "JBL Flip 6 Portable Waterproof Speaker", sku: "JBLFLIP6BLKAM", brand: "JBL" },
      { id: "7", name: "Logitech Brio 4K Ultra HD Webcam", sku: "960-001105", brand: "Logitech" },
      { id: "8", name: "Onten 9118 USB-C Multiport Docking Station", sku: "OTN-9118", brand: "Onten" },
      { id: "9", name: "Lention USB-C Hub with 4K HDMI", sku: "CB-CE18", brand: "Lention" },
      { id: "10", name: "Logitech G Pro X Superlight 2 Wireless Gaming Mouse", sku: "910-006628", brand: "Logitech" },
      { id: "11", name: "Poly Sync 20 Plus Bluetooth Speakerphone", sku: "216867-01", brand: "Poly" },
      { id: "12", name: "Elgato Stream Deck MK.2", sku: "10GAA9901", brand: "Elgato" },
      { id: "13", name: "JBL Tune 770NC Wireless Over-Ear Headphones", sku: "JBLT770NCBLU", brand: "JBL" },
      { id: "14", name: "Samsung T7 Shield 1TB Portable SSD", sku: "MU-PE1T0S/AM", brand: "Samsung" }
    ];
  }

  console.log(`Checking ${products.length} products against image library...`);
  let missing = [];
  for (const item of products) {
    const matched = findMatchingImage(item, imageFiles);
    const itemName = item.name || item.n || item.sku;
    if (matched) {
      console.log(`  ✓ [MATCHED] "${itemName}" -> ${matched}`);
    } else {
      console.log(`  ✗ [MISSING] "${itemName}" (SKU: ${item.sku || item.s || 'N/A'})`);
      missing.push(item);
    }
  }

  if (missing.length === 0) {
    console.log(`\n🎉 All ${products.length} products already have matching images!\n`);
    return;
  }

  console.log(`\n🚀 Auto-fetching images for ${missing.length} missing products...`);
  for (const item of missing) {
    const brand = item.brand || (item.name || '').split(' ')[0] || 'Product';
    const name = item.name || item.n || item.sku;
    const query = `${brand} ${name} ${item.sku || ''}`.trim();

    console.log(`\n🔍 Searching for: "${query}"...`);
    const results = await searchProductImages(query, 3);
    if (results.length === 0) {
      console.log(`  ⚠️ No images found online for "${name}"`);
      continue;
    }

    const cleanModel = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 40);
    const filename = `${brand}_${cleanModel}.jpg`;

    let downloaded = false;
    for (const cand of results) {
      const res = await downloadProductImage(cand.image, filename);
      if (res.success) {
        console.log(`  ✅ Downloaded & linked: ${res.path}`);
        imageFiles.push(filename);
        downloaded = true;
        break;
      }
    }

    if (!downloaded) {
      console.log(`  ❌ Failed to download candidates for "${name}"`);
    }

    // Gentle delay between searches
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n✨ Auto-fetch complete!\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
