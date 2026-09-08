/**
 * iTLand Wholesale Portal — Backend Server
 * =========================================
 * - Keeps Zoho credentials SECRET (server-side only)
 * - Syncs all items from Zoho Books into a local cache (with wholesale prices)
 * - Serves a login-protected search API to the frontend
 *
 * Run:  node server.js
 * Then open:  http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Load .env if present
try {
  const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

// ----- load config (local file falls back to environment variables) -----
let CONFIG = {};
try { CONFIG = require("./config.json"); } catch {}

const ZOHO_CLIENT_ID        = process.env.ZOHO_CLIENT_ID        || CONFIG.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET    = process.env.ZOHO_CLIENT_SECRET    || CONFIG.ZOHO_CLIENT_SECRET;
const ZOHO_ORG_ID           = process.env.ZOHO_ORG_ID           || CONFIG.ZOHO_ORG_ID;
const ZOHO_REFRESH_TOKEN    = process.env.ZOHO_REFRESH_TOKEN    || CONFIG.ZOHO_REFRESH_TOKEN;
const ZOHO_ACCOUNTS_DOMAIN  = process.env.ZOHO_ACCOUNTS_DOMAIN  || CONFIG.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN       = process.env.ZOHO_API_DOMAIN       || CONFIG.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const WHOLESALE_FIELD       = process.env.WHOLESALE_FIELD       || CONFIG.WHOLESALE_FIELD;
const SYNC_INTERVAL_MINUTES = process.env.SYNC_INTERVAL_MINUTES || CONFIG.SYNC_INTERVAL_MINUTES || 5;
const { loadClients, findClient, toClientProfile } = require("./lib/clients.js");
const { groupByBrand } = require("./lib/brands.js");
const CLIENTS = CONFIG.CLIENTS || loadClients(process.env);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || CONFIG.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD;

const CACHE_FILE = path.join(__dirname, "items-cache.json");
const PORT_NUM = process.env.PORT || CONFIG.PORT || 3000;

// ============ image matching ============
const IMAGE_DIR = path.join(__dirname, "public", "assets", "product_images");
let imageFiles = [];
try {
  const all = fs.readdirSync(IMAGE_DIR);
  // Product art is served as WebP (see README). Legacy .jpg/.png originals may
  // still sit in the directory; prefer the WebP twin so the matcher never hands
  // the browser a multi-megabyte original, and keep an original only when no
  // WebP version of it exists.
  const webpStems = new Set(
    all.filter(f => /\.webp$/i.test(f)).map(f => f.replace(/\.[^.]+$/, ''))
  );
  imageFiles = all.filter(f =>
    /\.webp$/i.test(f) || !webpStems.has(f.replace(/\.[^.]+$/, ''))
  );
} catch {}

// Image matching + item normalization live in lib/product-matching.js so this
// server, the local API server, and the Vercel functions score identically.
// imageFiles is passed as a getter because the admin upload routes append to it
// at runtime (see /api/admin/upload-image below).
const { createMatcher } = require("./lib/product-matching.js");
const { findProductImage } = createMatcher(() => imageFiles);

const OVERRIDES_FILE = path.join(__dirname, "overrides.json");
function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")); } catch { return {}; }
}
function saveOverrides(o) { fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(o, null, 2)); }

const FALLBACK_ITEMS = [
  {
    id: "1", n: "Logitech MX Master 3S Wireless Mouse", s: "910-006557", barcode: "097855174574",
    brand: "Logitech", category: "Mouse", p: 79.99, retail: 99.99, k: true, stock: 25,
    d: "Quiet Click wireless performance mouse with 8K DPI tracking and ergonomic design.",
    img: "/assets/product_images/Logitech_MX_Master_3S.webp"
  },
  {
    id: "2", n: "Logitech MX Keys S Wireless Keyboard", s: "920-011558", barcode: "097855174581",
    brand: "Logitech", category: "Keyboard", p: 94.99, retail: 119.99, k: true, stock: 18,
    d: "Fluid typing illuminated keyboard with Smart Actions and USB-C fast charging.",
    img: "/assets/product_images/Logitech_MX_Keys_S.webp"
  },
  {
    id: "3", n: "Anker 555 USB-C Hub 8-in-1 PowerExpand", s: "A83830A1", barcode: "194644023456",
    brand: "Anker", category: "Adapter / Hub", p: 49.99, retail: 69.99, k: true, stock: 40,
    d: "Multiport adapter with 100W Power Delivery, 4K HDMI, Ethernet, and SD card reader.",
    img: "/assets/product_images/Anker_555_USB_C_Hub_Official.webp"
  },
  {
    id: "4", n: "Poly Voyager Focus 2 UC Headset", s: "213726-01", barcode: "017229172455",
    brand: "Poly", category: "Headset", p: 199.99, retail: 249.99, k: true, stock: 12,
    d: "Stereo Bluetooth headset with active noise canceling (ANC) and smart sensors.",
    img: "/assets/product_images/Poly_Voyager_Focus_2.webp"
  },
  {
    id: "5", n: "Jabra Evolve2 65 Wireless Headset", s: "26599-989-999", barcode: "5706991022835",
    brand: "Jabra", category: "Headset", p: 175.00, retail: 219.99, k: true, stock: 15,
    d: "Professional wireless headset engineered to keep you focused with noise isolating foam.",
    img: "/assets/product_images/Jabra_Evolve2_65.webp"
  },
  {
    id: "6", n: "JBL Flip 6 Portable Waterproof Speaker", s: "JBLFLIP6BLKAM", barcode: "050036387063",
    brand: "JBL", category: "Speakers", p: 98.50, retail: 129.95, k: true, stock: 30,
    d: "Powerful 2-way speaker system delivering loud, crystal clear, powerful sound.",
    img: "/assets/product_images/JBL_Flip_6.webp"
  },
  {
    id: "7", n: "Logitech Brio 4K Ultra HD Webcam", s: "960-001105", barcode: "097855125439",
    brand: "Logitech", category: "Video Conference", p: 155.00, retail: 199.99, k: true, stock: 10,
    d: "Premium 4K webcam with HDR and Windows Hello support for professional video calls.",
    img: "/assets/product_images/Logitech_Brio_4K.webp"
  },
  {
    id: "8", n: "Onten 9118 USB-C Multiport Docking Station", s: "OTN-9118", barcode: "6956328391181",
    brand: "Onten", category: "Adapter / Hub", p: 32.00, retail: 45.00, k: true, stock: 50,
    d: "Aluminum 11-in-1 USB-C dock with dual HDMI, VGA, RJ45 Gigabit Ethernet and USB 3.0 ports.",
    img: "/assets/product_images/Onten_OTN-9118.webp"
  },
  {
    id: "9", n: "Lention USB-C Hub with 4K HDMI", s: "CB-CE18", barcode: "6970420180123",
    brand: "Lention", category: "Adapter / Hub", p: 24.50, retail: 35.00, k: true, stock: 45,
    d: "Compact Type-C adapter with 4K HDMI output, 3 USB 3.0 ports, and Power Delivery.",
    img: "/assets/product_images/Lention_CB-CE18_Official.webp"
  },
  {
    id: "10", n: "Logitech G Pro X Superlight 2 Wireless Gaming Mouse", s: "910-006628", barcode: "097855184511",
    brand: "Logitech", category: "Mouse", p: 129.99, retail: 159.99, k: true, stock: 20,
    d: "Next-gen 60g ultralight esports mouse with LIGHTFORCE hybrid switches and HERO 2 sensor.",
    img: "/assets/product_images/Logitech_G_Pro_X_Superlight_2.webp"
  },
  {
    id: "11", n: "Poly Sync 20 Plus Bluetooth Speakerphone", s: "216867-01", barcode: "017229171236",
    brand: "Poly", category: "Video Conference", p: 139.00, retail: 179.99, k: true, stock: 16,
    d: "Smart speakerphone for conference calls and music with multi-microphone steerable array.",
    img: "/assets/product_images/Poly_Sync_20_Plus.webp"
  },
  {
    id: "12", n: "Elgato Stream Deck MK.2", s: "10GAA9901", barcode: "840006637400",
    brand: "Elgato", category: "Streaming", p: 119.00, retail: 149.99, k: true, stock: 22,
    d: "15 customizable LCD keys to control apps, tools, and platforms with tactile feedback.",
    img: "/assets/product_images/Elgato_Stream_Deck_MK2.webp"
  },
  {
    id: "13", n: "JBL Tune 770NC Wireless Over-Ear Headphones", s: "JBLT770NCBLU", barcode: "050036394511",
    brand: "JBL", category: "Headset", p: 89.00, retail: 129.95, k: true, stock: 28,
    d: "Adaptive Noise Cancelling wireless headphones with JBL Pure Bass Sound and 70H battery life.",
    img: "/assets/product_images/JBL_Tune_770NC.webp"
  },
  {
    id: "14", n: "Samsung T7 Shield 1TB Portable SSD", s: "MU-PE1T0S/AM", barcode: "887276633856",
    brand: "Samsung", category: "Adapter / Hub", p: 99.00, retail: 134.99, k: true, stock: 35,
    d: "Rugged external solid state drive with IP65 dust and water resistance and USB 3.2 Gen 2.",
    img: "/assets/product_images/Samsung_T7_Shield.webp"
  }
];

function getItems() {
  const cache = getCache();
  const ov = loadOverrides();
  const usingCache = Boolean(cache.items && cache.items.length > 0);
  const rawList = usingCache ? cache.items : FALLBACK_ITEMS;
  const items = rawList.map(it => {
    const o = ov[it.id] || {};
    const autoImg = findProductImage(it);
    const stockVal = o.stock !== undefined
      ? Number(o.stock)
      : (it.stock != null ? Number(it.stock) : (it.stock_on_hand != null ? Number(it.stock_on_hand) : 0));
    const inStockVal = o.k !== undefined
      ? Boolean(o.k)
      : (o.stock !== undefined ? stockVal > 0 : (it.k !== undefined ? Boolean(it.k) : (it.in_stock !== undefined ? Boolean(it.in_stock) : stockVal > 0)));
    const wholesaleVal = o.p !== undefined
      ? (o.p === null ? null : Number(o.p))
      : (it.p != null ? Number(it.p) : (it.wholesale_price != null ? Number(it.wholesale_price) : null));
    const retailVal = o.retail !== undefined
      ? (o.retail === null ? null : Number(o.retail))
      : (it.retail != null ? Number(it.retail) : (it.price != null ? Number(it.price) : null));

    return {
      ...it,
      id:              String(it.id),
      n:               o.n        !== undefined ? o.n        : (it.n || it.name || ''),
      name:            o.n        !== undefined ? o.n        : (it.n || it.name || ''),
      p:               wholesaleVal,
      wholesale_price: wholesaleVal,
      retail:          retailVal,
      price:           retailVal,
      stock:           stockVal,
      stock_on_hand:   stockVal,
      k:               inStockVal,
      in_stock:        inStockVal,
      d:               o.d        !== undefined ? o.d        : (it.d || it.description || ''),
      description:     o.d        !== undefined ? o.d        : (it.d || it.description || ''),
      brand:           o.brand    !== undefined ? o.brand    : (it.brand || ''),
      category:        o.category !== undefined ? o.category : (it.category || ''),
      s:               o.s        !== undefined ? o.s        : (it.s || it.sku || ''),
      sku:             o.s        !== undefined ? o.s        : (it.s || it.sku || ''),
      barcode:         o.barcode  !== undefined ? o.barcode  : (it.barcode || ''),
      // Never fall back to an unverified inventory image
      img:             o.img      !== undefined ? o.img      : (autoImg || null),
    };
  });
  return { updatedAt: cache.updatedAt || STARTED_AT, items, dataSource: usingCache ? "zoho" : "demo" };
}

// ============ Zoho sync ============
let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Zoho token error: " + JSON.stringify(data));
  accessToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000; // ~55 min
  return accessToken;
}

// The list endpoint does NOT return custom fields, but it returns a LOT per call.
// We pull the full list (name, sku, stock, rate) fast, then enrich wholesale price
// from a second mechanism. Zoho's list endpoint actually DOES include custom_fields
// when you pass the right param on some editions; we try, and fall back to detail
// fetches only for items missing it.
async function fetchAllItems() {
  const token = await getAccessToken();
  let page = 1, all = [], more = true;
  while (more) {
    const url = `${ZOHO_API_DOMAIN}/books/v3/items?organization_id=${ZOHO_ORG_ID}&per_page=200&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
    if (res.status === 429) { // rate limited, wait and retry
      await sleep(3000); continue;
    }
    const data = await res.json();
    all = all.concat(data.items || []);
    more = data.page_context && data.page_context.has_more_page;
    page++;
  }
  return all;
}

// Pull wholesale prices in bulk. Zoho Books has no bulk custom-field read on the
// list endpoint for all editions, so we read them from the cache we already built
// via the import step. To keep stock fresh AND prices correct, we merge:
//   - live list  -> name, sku, stock, retail (always fresh)
//   - price map   -> wholesale (from a prices.json we maintain)
function loadPriceMap() {
  const pf = path.join(__dirname, "wholesale-prices.json");
  if (fs.existsSync(pf)) {
    try { return JSON.parse(fs.readFileSync(pf, "utf8")); } catch { return {}; }
  }
  return {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractWholesalePrice(it, priceMap, rawDesc, pricebookMap) {
  const cfList = it.custom_fields || [];

  // 1. Explicit WHOLESALE_FIELD if configured
  if (WHOLESALE_FIELD) {
    const cf = cfList.find(f => f.api_name === WHOLESALE_FIELD || f.label === WHOLESALE_FIELD);
    if (cf && cf.value !== "" && cf.value != null) {
      const v = parseFloat(String(cf.value).replace(/[^0-9.]/g, ''));
      if (!isNaN(v) && v > 0) return v;
    }
  }

  // 2. Any custom field matching wholesale or office price by label or api_name
  const cfRegex = /wholesale|office\s*price/i;
  const cf = cfList.find(f =>
    cfRegex.test(f.label || '') || cfRegex.test(f.api_name || '')
  );
  if (cf && cf.value !== "" && cf.value != null) {
    const v = parseFloat(String(cf.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(v) && v > 0) return v;
  }

  // 3. Custom_field_hash object (Zoho Books v3)
  if (it.custom_field_hash && typeof it.custom_field_hash === 'object') {
    for (const [k, val] of Object.entries(it.custom_field_hash)) {
      if (/wholesale|office/i.test(k) && val != null && val !== '') {
        const v = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        if (!isNaN(v) && v > 0) return v;
      }
    }
  }

  // 4. Direct item attributes matching wholesale / office price
  for (const [k, val] of Object.entries(it)) {
    if (/^(?:cf_)?(?:wholesale|office_price|wholesale_price|wholesale_rate)$/i.test(k) && val != null && val !== '') {
      const v = parseFloat(String(val).replace(/[^0-9.]/g, ''));
      if (!isNaN(v) && v > 0) return v;
    }
  }

  // 5. Embedded in description / purchase_description ("Office Price 15.5$" / "Wholesale Price 20$")
  const fullDesc = `${it.purchase_description || ''} ${it.description || ''} ${rawDesc || ''}`;
  const m = fullDesc.match(/(?:Office\s+Price|Wholesale\s+Price|Wholesale|Office\s*Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!isNaN(v) && v > 0) return v;
  }

  // 6. Purchase rate (Zoho Books cost / wholesale purchase rate)
  if (it.purchase_rate != null && Number(it.purchase_rate) > 0) {
    return Number(it.purchase_rate);
  }

  // 7. Zoho Pricebook rate if available
  const idKey = String(it.item_id || it.id || '');
  if (pricebookMap) {
    const pVal = pricebookMap[idKey] ?? (it.sku ? pricebookMap[it.sku] : null);
    if (pVal != null && pVal !== '') {
      const v = Number(pVal);
      if (!isNaN(v) && v > 0) return v;
    }
  }

  // 8. Fallback to cached priceMap from wholesale-prices.json
  if (priceMap) {
    const mapped = priceMap[idKey] ?? (it.sku ? priceMap[it.sku] : null);
    if (mapped != null && mapped !== '') {
      const v = Number(mapped);
      if (!isNaN(v) && v > 0) return v;
    }
  }

  // 9. Generic price pattern in description e.g. "Price 15$"
  const m2 = fullDesc.match(/(?:Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
  if (m2) {
    const v = parseFloat(m2[1].replace(',', '.'));
    if (!isNaN(v) && v > 0) return v;
  }

  return null;
}

// Fetch active Zoho Pricebooks (Wholesale Price List) if available
async function fetchPricebooks(token) {
  try {
    const url = `${ZOHO_API_DOMAIN}/books/v3/pricebooks?organization_id=${ZOHO_ORG_ID}&status=active`;
    const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
    if (!res.ok) return {};
    const data = await res.json();
    const books = data.pricebooks || [];
    const targetBook = books.find(b => /wholesale|office/i.test(b.name || '')) || books[0];
    if (!targetBook) return {};

    const detailUrl = `${ZOHO_API_DOMAIN}/books/v3/pricebooks/${targetBook.pricebook_id}?organization_id=${ZOHO_ORG_ID}`;
    const dRes = await fetch(detailUrl, { headers: { Authorization: "Zoho-oauthtoken " + token } });
    if (!dRes.ok) return {};
    const dData = await dRes.json();
    const pb = dData.pricebook || {};
    const map = {};
    for (const item of (pb.pricebook_items || [])) {
      if (item.item_id && item.pricebook_rate != null) {
        map[item.item_id] = Number(item.pricebook_rate);
      }
    }
    return map;
  } catch {
    return {};
  }
}

// Fetch individual item detail if custom fields are not returned in list
async function fetchItemDetail(token, itemId) {
  try {
    const url = `${ZOHO_API_DOMAIN}/books/v3/items/${itemId}?organization_id=${ZOHO_ORG_ID}`;
    const res = await fetch(url, { headers: { Authorization: "Zoho-oauthtoken " + token } });
    if (res.status === 429) {
      await sleep(2000);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.item || null;
  } catch {
    return null;
  }
}

// Map a Zoho item to the shape the frontend design expects:
function mapItem(it, priceMap, pricebookMap) {
  const stock = it.available_stock != null ? it.available_stock
              : (it.stock_on_hand != null ? it.stock_on_hand : 0);

  const rawDesc = (it.purchase_description || it.description || "").replace(/\s+/g, " ").trim();

  // Extract product name from description — strip trailing part numbers and price info
  const nameFromDesc = rawDesc
    .replace(/\s+\d{3,}-\d{4,}.*$/, "")
    .replace(/\s+Office\s+Price.*$/i, "")
    .replace(/\s+Wholesale\s+Price.*$/i, "")
    .replace(/\s+Price\s+\d.*$/i, "")
    .trim();

  const wholesale = extractWholesalePrice(it, priceMap, rawDesc, pricebookMap);

  // Zoho items sometimes carry the barcode in `name` and the real product title
  // only in the description. Fall back to the description ONLY in that case —
  // preferring it unconditionally (as this did) renamed every properly-named
  // product to its marketing blurb, which also broke image matching. Same rule
  // as normalizeItem() in lib/product-matching.js.
  const rawName = (it.name ?? '').trim();
  const isNameDigits = /^\d+$/.test(rawName);
  const modelName = (isNameDigits || !rawName) ? (nameFromDesc || it.sku || rawName) : rawName;
  const customBarcode = (it.custom_fields || []).find(f => /^(barcode|upc|ean)$/i.test(f.label || ''))?.value || null;
  const barcodeVal = customBarcode || (isNameDigits ? rawName : (it.sku || rawName));

  const brandVal = it.brand || (it.custom_fields || []).find(f => /brand/i.test(f.label || f.api_name || ''))?.value || '';
  const catVal = it.category_name || it.product_type || (it.custom_fields || []).find(f => /category|type/i.test(f.label || f.api_name || ''))?.value || 'Accessories';

  return {
    id: String(it.item_id || it.id || ''),
    n: modelName,
    name: modelName,
    s: it.sku || "",
    sku: it.sku || "",
    barcode: barcodeVal,
    brand: brandVal,
    category: catVal,
    c: "all",
    p: wholesale,
    wholesale_price: wholesale,
    retail: it.rate != null ? Number(it.rate) : null,
    price: it.rate != null ? Number(it.rate) : null,
    k: Number(stock) > 0,
    in_stock: Number(stock) > 0,
    stock: Number(stock),
    stock_on_hand: Number(stock),
    d: rawDesc.slice(0, 120),
    description: rawDesc,
  };
}

// Which Zoho settings are absent. Empty array == fully configured.
function missingZohoConfig() {
  const missing = [];
  if (!ZOHO_ORG_ID) missing.push("ZOHO_ORG_ID");
  if (!ZOHO_REFRESH_TOKEN) missing.push("ZOHO_REFRESH_TOKEN");
  if (!ZOHO_CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
  if (!ZOHO_CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
  return missing;
}

// Set once a sync actually writes the cache, so /api/status can distinguish
// "never connected" from "connected but the last attempt failed".
let lastSyncOk = null;
let lastSyncError = null;

async function syncNow() {
  if (missingZohoConfig().length > 0) {
    return;
  }
  try {
    console.log(new Date().toISOString(), "Syncing from Zoho...");
    const token = await getAccessToken();
    const raw = await fetchAllItems();
    let priceMap = loadPriceMap();
    let priceMapDirty = false;

    let pricebookMap = {};
    try {
      pricebookMap = await fetchPricebooks(token);
    } catch {}

    const itemsMissingPrice = [];

    const items = raw.map(it => {
      const mapped = mapItem(it, priceMap, pricebookMap);
      if (mapped.p != null && mapped.id) {
        if (priceMap[mapped.id] !== mapped.p) {
          priceMap[mapped.id] = mapped.p;
          priceMapDirty = true;
        }
      } else {
        itemsMissingPrice.push(it);
      }
      return mapped;
    });

    // If some items lack wholesale price because list endpoint lacks custom fields,
    // fetch up to 15 item details per sync cycle to enrich them automatically
    if (itemsMissingPrice.length > 0) {
      const toEnrich = itemsMissingPrice.slice(0, 15);
      for (const rawIt of toEnrich) {
        const id = rawIt.item_id || rawIt.id;
        if (!id) continue;
        const detail = await fetchItemDetail(token, id);
        if (detail) {
          const detailPrice = extractWholesalePrice(detail, priceMap, rawIt.purchase_description || rawIt.description, pricebookMap);
          if (detailPrice != null) {
            priceMap[String(id)] = detailPrice;
            priceMapDirty = true;
            const foundIdx = items.findIndex(i => String(i.id) === String(id));
            if (foundIdx !== -1) {
              items[foundIdx].p = detailPrice;
              items[foundIdx].wholesale_price = detailPrice;
            }
          }
        }
        await sleep(150);
      }
    }

    if (priceMapDirty) {
      try {
        fs.writeFileSync(path.join(__dirname, "wholesale-prices.json"), JSON.stringify(priceMap, null, 2));
      } catch (err) {
        console.warn("Could not save wholesale-prices.json:", err.message);
      }
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: Date.now(), items }, null, 0));
    console.log(`  cached ${items.length} items (${items.filter(i=>i.k).length} in stock, ${items.filter(i=>i.p != null).length} with wholesale price)`);
    lastSyncOk = Date.now();
    lastSyncError = null;
  } catch (e) {
    lastSyncError = e.message;
    console.error("  sync failed:", e.message);
  }
}

// Stable stand-in for "last updated" when no Zoho cache exists yet (demo data).
// Using Date.now() per request made every response unique, which defeated
// caching and made the UI's "Updated" label tick on every poll.
const STARTED_AT = Date.now();

function getCache() {
  if (!fs.existsSync(CACHE_FILE)) return { updatedAt: 0, items: [] };
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { return { updatedAt: 0, items: [] }; }
}

// ============ online image search providers ============
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || CONFIG.GOOGLE_API_KEY || "";
const GOOGLE_CSE_ID  = process.env.GOOGLE_CSE_ID  || CONFIG.GOOGLE_CSE_ID  || "";
const SEARCH_TIMEOUT_MS = 10000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Every outbound call here is to a third party that may be slow, blocked, or
// silently dropping packets. Without a deadline the admin UI span forever.
function fetchWithTimeout(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
}

const IMAGE_SEARCH_PROVIDERS = [
  {
    name: "google",
    enabled: () => Boolean(GOOGLE_API_KEY && GOOGLE_CSE_ID),
    disabledReason: "not configured (set GOOGLE_API_KEY and GOOGLE_CSE_ID in .env)",
    async search(query) {
      const u = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_API_KEY)}`
        + `&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&searchType=image&num=8&safe=active`
        + `&q=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(u);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Google returns a descriptive reason (bad key, quota exceeded, CSE not
        // configured for image search); pass it through rather than hiding it.
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      return (data.items || []).map(r => ({
        title: r.title,
        image: r.link,
        thumbnail: r.image?.thumbnailLink || r.link,
        width: r.image?.width,
        height: r.image?.height,
        source: r.image?.contextLink,
      }));
    },
  },
  {
    name: "duckduckgo",
    enabled: () => true,
    async search(query) {
      const tokenRes = await fetchWithTimeout(
        `https://duckduckgo.com/?q=${encodeURIComponent(query + " product")}`,
        { headers: { "User-Agent": BROWSER_UA } });
      const html = await tokenRes.text();
      const vqdMatch = html.match(/vqd=([0-9-]+)/) || html.match(/vqd="([^"]+)"/);
      if (!vqdMatch) throw new Error("blocked (no search token returned)");
      const imgRes = await fetchWithTimeout(
        `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqdMatch[1]}`,
        { headers: { "User-Agent": BROWSER_UA, Referer: "https://duckduckgo.com/" } });
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
      const data = await imgRes.json();
      return (data.results || []).slice(0, 8).map(r => ({
        title: r.title, image: r.image, thumbnail: r.thumbnail,
        width: r.width, height: r.height, source: r.url,
      }));
    },
  },
];

// Turn the per-provider attempt log into one sentence an admin can act on.
function describeSearchFailure(attempts) {
  const tried = attempts.filter(a => a.error);
  const skipped = attempts.filter(a => a.skipped);
  if (tried.length === 0 && skipped.length > 0) {
    return `No image search provider is available. ${skipped.map(s => `${s.provider}: ${s.skipped}`).join("; ")}`;
  }
  if (tried.every(a => a.error === "no results")) {
    return "";  // genuinely nothing found — the UI's empty state is correct
  }
  const detail = tried.map(a => `${a.provider}: ${a.error}`).join("; ");
  const hint = skipped.length
    ? ` Configure Google image search for a reliable result (${skipped.map(s => s.provider).join(", ")} unconfigured).`
    : "";
  return `Image search failed — ${detail}.${hint}`;
}

// ============ Excel export ============
// The workbook itself is built in lib/catalogue-workbook.js, shared with the
// Vercel function so both deployments produce the same file. Thumbnails are
// pre-built by scripts/build-xlsx-thumbs.mjs — Excel will not reliably render
// the WebP product images, and converting them at request time needed dwebp,
// which does not exist in a serverless runtime.
const { buildCatalogueWorkbook, exportFilename } = require("./lib/catalogue-workbook.js");
const XLSX_THUMB_DIR = path.join(__dirname, "public", "assets", "xlsx-thumbs");

function loadThumbFromDisk(name) {
  if (!/^[A-Za-z0-9._-]+\.jpg$/i.test(name)) return null;
  const file = path.join(XLSX_THUMB_DIR, name);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

// ============ simple session auth ============
const sessions = new Map(); // token -> { user, exp }
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function makeToken() { return crypto.randomBytes(24).toString("hex"); }

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/session=([a-f0-9]+)/);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || Date.now() > s.exp) { if (s) sessions.delete(m[1]); return null; }
  return s;
}

// ============ admin session auth ============
const adminSessions = new Map();

function getAdminSession(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/adminsession=([a-f0-9]+)/);
  if (!m) return null;
  const s = adminSessions.get(m[1]);
  if (!s || Date.now() > s.exp) { if (s) adminSessions.delete(m[1]); return null; }
  return s;
}

// ============ HTTP server ============
function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, headers));
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
    ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp",
    ".svg":"image/svg+xml", ".ico":"image/x-icon" };
  fs.readFile(filePath, (err, data) => {
    if (err) { send(res, 404, "Not found"); return; }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise(resolve => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT_NUM}`);
  const pathn = url.pathname;
  const origin = req.headers.origin || "";

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ---- API: wholesale-login ----
  if ((pathn === "/api/wholesale-login" || pathn === "/api/login") && req.method === "POST") {
    const body = await readBody(req);
    let creds = {};
    try { creds = JSON.parse(body); } catch {}
    const usernameInput = (creds.email || creds.username || "").trim();
    const passwordInput = creds.password || "";
    const client = findClient(CLIENTS, usernameInput, passwordInput);
    if (client) {
      const tok = makeToken();
      sessions.set(tok, { user: client.username || client.email, exp: Date.now() + SESSION_MS });
      const clientObj = toClientProfile(client);
      send(res, 200, { ok: true, success: true, client: clientObj }, {
        "Set-Cookie": `session=${tok}; HttpOnly; Path=/; Max-Age=${SESSION_MS/1000}; SameSite=Lax`,
      });
    } else {
      send(res, 401, { ok: false, success: false, error: "invalid" });
    }
    return;
  }

  // ---- API: brands available to export, with counts ----
  if (pathn === "/api/export-brands" && req.method === "GET") {
    if (!getSession(req)) { send(res, 401, { error: "Sign in again to export." }); return; }
    const groups = groupByBrand(getItems().items.filter(it => it.k));
    send(res, 200, { brands: groups.map(g => ({ brand: g.brand, count: g.items.length })) });
    return;
  }

  // ---- API: Excel export of the in-stock catalogue, grouped by brand ----
  // A HEAD is the session pre-flight: it answers 200/401 without building the
  // workbook, so the page can report an expired session before starting a
  // download it cannot cancel.
  if (pathn === "/api/export.xlsx" && req.method === "HEAD") {
    res.writeHead(getSession(req) ? 200 : 401);
    res.end();
    return;
  }

  if (pathn === "/api/export.xlsx" && req.method === "GET") {
    // This file is the entire wholesale price list, so it is the one product
    // route that requires a signed-in client. Sessions are in-memory, so a
    // server restart invalidates them while the browser still has the catalogue
    // open — the UI turns this 401 into "please sign in again" rather than a
    // silent failure.
    if (!getSession(req)) { send(res, 401, { error: "Sign in again to export." }); return; }
    try {
      // ?brands=Logitech,Onten selects a subset; absent means everything.
      const wanted = (url.searchParams.get("brands") || "")
        .split(",").map(b => b.trim()).filter(Boolean);
      const buf = await buildCatalogueWorkbook(
        getItems().items.filter(it => it.k), loadThumbFromDisk, wanted);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFilename()}"`,
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
      });
      res.end(buf);
    } catch (e) {
      console.error("  export failed:", e.message);
      send(res, 500, { error: `Could not build the export: ${e.message}` });
    }
    return;
  }

  // ---- API: status (admin only — reports config state) ----
  if (pathn === "/api/status" && req.method === "GET") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const data = getItems();
    const missing = missingZohoConfig();
    send(res, 200, {
      zohoConfigured: missing.length === 0,
      missingConfig: missing,
      dataSource: data.dataSource,
      itemCount: data.items.length,
      cacheFileExists: fs.existsSync(CACHE_FILE),
      lastSyncOk,
      lastSyncError,
      syncIntervalMinutes: SYNC_INTERVAL_MINUTES || 5,
    });
    return;
  }

  // ---- API: products / items ----
  if (pathn === "/api/products" || pathn === "/api/items") {
    const data = getItems();
    const payload = JSON.stringify({ updatedAt: data.updatedAt, dataSource: data.dataSource, products: data.items, items: data.items });

    // The catalog re-polls this endpoint every 60s and on every tab focus. The
    // payload only changes when a Zoho sync or an admin edit lands, so tag it
    // and let unchanged polls terminate as a 304 with no body. "no-cache" (not
    // "no-store") is what makes that possible: the browser may keep the
    // response but must revalidate it before reuse, so clients still see edits
    // immediately.
    const etag = '"' + crypto.createHash("sha1").update(payload).digest("hex") + '"';
    const headers = { "Cache-Control": "no-cache", "ETag": etag };

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    send(res, 200, payload, headers);
    return;
  }

  // ---- Admin API ----
  if (pathn === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    let creds = {};
    try { creds = JSON.parse(body); } catch {}
    if (ADMIN_USERNAME && ADMIN_PASSWORD && creds.username === ADMIN_USERNAME && creds.password === ADMIN_PASSWORD) {
      const tok = makeToken();
      adminSessions.set(tok, { user: creds.username, exp: Date.now() + SESSION_MS });
      send(res, 200, { ok: true }, {
        "Set-Cookie": `adminsession=${tok}; HttpOnly; Path=/; Max-Age=${SESSION_MS/1000}; SameSite=Lax`,
      });
    } else {
      send(res, 401, { ok: false, error: "invalid" });
    }
    return;
  }

  if (pathn === "/api/admin/logout" && req.method === "POST") {
    const cookie = req.headers.cookie || "";
    const m = cookie.match(/adminsession=([a-f0-9]+)/);
    if (m) adminSessions.delete(m[1]);
    send(res, 200, { ok: true }, { "Set-Cookie": "adminsession=; Path=/; Max-Age=0" });
    return;
  }

  if (pathn === "/api/admin/items") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const data = getItems();
    send(res, 200, data);
    return;
  }

  if (pathn === "/api/admin/images") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    send(res, 200, { images: imageFiles.map(f => `/assets/product_images/${f}`) });
    return;
  }

  if (pathn === "/api/admin/override" && req.method === "POST") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const body = await readBody(req);
    let data = {};
    try { data = JSON.parse(body); } catch {}
    const { itemId, reset, n, p, wholesale_price, retail, price, stock, quantity, k, in_stock, d, description, brand, category, sku, s, barcode, img } = data;
    if (!itemId) { send(res, 400, { error: "itemId required" }); return; }
    const overrides = loadOverrides();
    if (reset) {
      delete overrides[itemId];
      saveOverrides(overrides);
      send(res, 200, { ok: true, reset: true });
      return;
    }
    if (!overrides[itemId]) overrides[itemId] = {};

    const finalP = p !== undefined ? p : wholesale_price;
    const finalRetail = retail !== undefined ? retail : price;
    const finalStock = stock !== undefined ? stock : quantity;
    const finalK = k !== undefined ? k : in_stock;
    const finalD = d !== undefined ? d : description;
    const finalS = s !== undefined ? s : sku;

    const setOrDelete = (field, value) => {
      if (value === null) delete overrides[itemId][field];
      else if (value !== undefined) overrides[itemId][field] = value;
    };

    setOrDelete('n', n);
    setOrDelete('p', finalP === null ? null : (finalP !== undefined ? Number(finalP) : undefined));
    setOrDelete('retail', finalRetail === null ? null : (finalRetail !== undefined ? Number(finalRetail) : undefined));
    setOrDelete('stock', finalStock === null ? null : (finalStock !== undefined ? Number(finalStock) : undefined));
    setOrDelete('k', finalK === null ? null : (finalK !== undefined ? Boolean(finalK) : undefined));
    setOrDelete('d', finalD);
    setOrDelete('brand', brand);
    setOrDelete('category', category);
    setOrDelete('s', finalS);
    setOrDelete('barcode', barcode);
    setOrDelete('img', img);

    if (Object.keys(overrides[itemId]).length === 0) delete overrides[itemId];
    saveOverrides(overrides);
    send(res, 200, { ok: true, item: overrides[itemId] || null });
    return;
  }

  if (pathn === "/api/admin/upload" && req.method === "POST") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const body = await readBody(req);
    let data = {};
    try { data = JSON.parse(body); } catch {}
    const { filename, imageData } = data;
    if (!filename || !imageData) { send(res, 400, { error: "filename and imageData required" }); return; }
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const m = imageData.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    if (!m) { send(res, 400, { error: "invalid imageData" }); return; }
    fs.writeFileSync(path.join(IMAGE_DIR, safeName), Buffer.from(m[1], "base64"));
    if (!imageFiles.includes(safeName)) imageFiles.push(safeName);
    send(res, 200, { ok: true, img: `/assets/product_images/${safeName}` });
    return;
  }

  // ---- Auto-Find Images Online ----
  //
  // This used to call DuckDuckGo's internal i.js endpoint and nothing else. On
  // this network duckduckgo.com does not resolve to a reachable host at all
  // (connections time out, while google/bing/github respond in <1s), so the
  // feature could never work here — and every failure surfaced in the admin UI
  // as the indistinguishable message "No images found".
  //
  // Providers are now tried in order and each reports why it failed, so the UI
  // can say "DuckDuckGo unreachable" instead of implying an empty result set.
  // Google is the reliable option: it is an official, documented API. Set
  // GOOGLE_API_KEY and GOOGLE_CSE_ID in .env to enable it (see README).
  if (pathn === "/api/admin/search-images") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const q = url.searchParams.get("q") || "";
    if (!q.trim()) { send(res, 400, { error: "Query required" }); return; }

    const cleanQuery = q.replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();
    const attempts = [];

    for (const provider of IMAGE_SEARCH_PROVIDERS) {
      if (!provider.enabled()) {
        attempts.push({ provider: provider.name, skipped: provider.disabledReason });
        continue;
      }
      try {
        const results = await provider.search(cleanQuery);
        if (results.length > 0) {
          send(res, 200, { results, provider: provider.name, attempts });
          return;
        }
        attempts.push({ provider: provider.name, error: "no results" });
      } catch (e) {
        // A blocked or unreachable provider must not look like "nothing found".
        const reason = e.name === "TimeoutError" || /abort/i.test(e.message)
          ? "unreachable (timed out)"
          : e.message;
        attempts.push({ provider: provider.name, error: reason });
        console.warn(`  image search via ${provider.name} failed: ${reason}`);
      }
    }

    send(res, 200, { results: [], attempts, error: describeSearchFailure(attempts) });
    return;
  }

  // ---- Attach Online Image (Download and Save) ----
  if (pathn === "/api/admin/attach-online-image" && req.method === "POST") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const body = await readBody(req);
    let data = {};
    try { data = JSON.parse(body); } catch {}
    const { itemId, imageUrl, filename } = data;
    if (!imageUrl || !filename) { send(res, 400, { error: "imageUrl and filename required" }); return; }
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(IMAGE_DIR, safeName);
    try {
      const imgFetch = await fetch(imageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      if (!imgFetch.ok) throw new Error(`HTTP ${imgFetch.status}`);
      const buf = Buffer.from(await imgFetch.arrayBuffer());
      fs.writeFileSync(dest, buf);
      if (!imageFiles.includes(safeName)) imageFiles.push(safeName);

      const localPath = `/assets/product_images/${safeName}`;
      if (itemId) {
        const overrides = loadOverrides();
        if (!overrides[itemId]) overrides[itemId] = {};
        overrides[itemId].img = localPath;
        saveOverrides(overrides);
      }
      send(res, 200, { ok: true, img: localPath });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // ---- Zoho refresh-token helper ----
  // The same generator exists as a Vercel function in api/zoho-callback.js, but
  // that one is unreachable when running locally, which is exactly when it is
  // needed. Exchanges a Self Client grant code for a refresh token and prints
  // the .env lines to paste. Nothing is written to disk or logged.
  if (pathn === "/api/zoho-callback") {
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const page = (body) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Zoho Refresh Token</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#FAF8F5;color:#17130E;padding:40px 20px}
.card{max-width:620px;margin:0 auto;background:#fff;border:2px solid #17130E;border-radius:18px;padding:30px;box-shadow:6px 6px 0 #17130E}
label{display:block;font-weight:700;font-size:13px;margin:16px 0 6px}
input,select{width:100%;padding:11px;font-size:14px;border:1.5px solid #D6CDBB;border-radius:10px;box-sizing:border-box;font-family:ui-monospace,monospace}
button{width:100%;margin-top:22px;padding:14px;background:#17130E;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer}
pre{background:#17130E;color:#8CE99A;padding:16px;border-radius:10px;overflow-x:auto;font-size:13px}
.hint{font-size:12.5px;color:#776E62;margin-top:5px}.err{background:#FDEDE9;border:1.5px solid #F9C5BB;color:#8A2B18;padding:14px;border-radius:10px;font-size:13.5px}</style>
</head><body><div class="card">${body}</div></body></html>`);
    };

    if (req.method === "GET") {
      page(`<h2>Get your Zoho refresh token</h2>
<p style="font-size:14px;color:#555">Paste the <b>grant code</b> from the API Console's <i>Generate Code</i> step. It expires within minutes, so do this straight away.</p>
<form method="POST">
  <label>Client ID</label><input name="client_id" value="${esc(ZOHO_CLIENT_ID)}" required>
  <label>Client Secret</label><input name="client_secret" value="${esc(ZOHO_CLIENT_SECRET)}" required>
  <label>Grant code</label><input name="code" placeholder="1000.abc123..." required autofocus>
  <label>Data centre</label>
  <select name="dc">
    <option value="https://accounts.zoho.com">books.zoho.com (default)</option>
    <option value="https://accounts.zoho.eu">books.zoho.eu</option>
    <option value="https://accounts.zoho.in">books.zoho.in</option>
    <option value="https://accounts.zoho.com.au">books.zoho.com.au</option>
    <option value="https://accounts.zoho.sa">books.zoho.sa</option>
  </select>
  <div class="hint">Must match the region your Zoho Books URL uses, or the code will be rejected.</div>
  <button type="submit">Exchange for refresh token</button>
</form>`);
      return;
    }

    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const dc = form.get("dc") || ZOHO_ACCOUNTS_DOMAIN;
      try {
        const r = await fetch(`${dc}/oauth/v2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: form.get("client_id") || "",
            client_secret: form.get("client_secret") || "",
            code: form.get("code") || "",
          }).toString(),
          signal: AbortSignal.timeout(20000),
        });
        const data = await r.json();
        if (!data.refresh_token) {
          page(`<h2>Zoho rejected that</h2><div class="err"><b>${esc(data.error || "unknown error")}</b>
<p style="margin:8px 0 0">${esc(data.error === "invalid_code"
  ? "The code was already used or has expired — generate a fresh one. Each code works exactly once."
  : data.error === "invalid_client"
  ? "Client ID/Secret wrong, or the data centre does not match the one that issued the code."
  : JSON.stringify(data))}</p></div>
<p style="margin-top:18px"><a href="/api/zoho-callback">Try again</a></p>`);
          return;
        }
        const api = dc.replace("accounts.zoho", "www.zohoapis");
        page(`<h2>Done — add these to .env</h2>
<p style="font-size:14px;color:#555">Then restart the server. This token is long-lived; keep it private.</p>
<pre>ZOHO_ORG_ID=&lt;your Organization ID&gt;
ZOHO_REFRESH_TOKEN=${esc(data.refresh_token)}${dc === "https://accounts.zoho.com" ? "" : `
ZOHO_ACCOUNTS_DOMAIN=${esc(dc)}
ZOHO_API_DOMAIN=${esc(api)}`}</pre>
<p class="hint">Organization ID: Zoho Books &rarr; Settings &rarr; Organization.</p>`);
      } catch (e) {
        page(`<h2>Could not reach Zoho</h2><div class="err">${esc(e.message)}</div>`);
      }
      return;
    }
  }

  // ---- static files (serve built React app from dist/, assets from public/) ----
  let file = pathn === "/" ? "/index.html" : pathn;
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const distPath = path.join(__dirname, "dist", safe);
  const publicPath = path.join(__dirname, "public", safe);

  if (fs.existsSync(distPath) && fs.statSync(distPath).isFile()) { serveStatic(res, distPath); return; }
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) { serveStatic(res, publicPath); return; }

  // SPA fallback: serve the built index.html for any unknown non-API route
  if (!pathn.startsWith("/api/")) {
    const distIndex = path.join(__dirname, "dist", "index.html");
    if (fs.existsSync(distIndex)) { serveStatic(res, distIndex); return; }
  }

  send(res, 404, "Not found");
});

// ============ boot ============
(async () => {
  if (!fs.existsSync(CACHE_FILE)) await syncNow();
  const mins = SYNC_INTERVAL_MINUTES || 5;
  setInterval(syncNow, mins * 60 * 1000);
  server.listen(PORT_NUM, () => {
    console.log(`\niTLand Wholesale Portal running at http://localhost:${PORT_NUM}`);
    if (!CLIENTS.length) {
      // Failing closed is correct, but silence would look like a broken login.
      console.log(`\n  !!  NO WHOLESALE ACCOUNTS CONFIGURED — every client login will be refused.`);
      console.log(`  !!  Set WHOLESALE_CLIENTS in .env, e.g.`);
      console.log(`  !!    WHOLESALE_CLIENTS=[{"username":"itland","password":"...","name":"iTLand Client"}]\n`);
    }
    if (!ADMIN_PASSWORD) {
      console.log(`  !!  ADMIN_PASSWORD is not set — the admin panel is closed.\n`);
    }

    const missing = missingZohoConfig();
    if (missing.length > 0) {
      // Previously this printed "Syncing from Zoho every N minutes" regardless,
      // so a portal serving 14 built-in demo products looked identical to a
      // fully synced one. Say plainly which setting is missing.
      console.log(`\n  !!  NOT CONNECTED TO ZOHO — serving ${FALLBACK_ITEMS.length} built-in demo products.`);
      console.log(`  !!  Missing: ${missing.join(", ")}`);
      console.log(`  !!  Add them to .env, then restart. See "Connecting Zoho" in README.md.\n`);
    } else if (!fs.existsSync(CACHE_FILE)) {
      console.log(`\n  !!  Zoho is configured but no cache was written yet — first sync may have failed.`);
      console.log(`  !!  Check the log above, or GET /api/status as an admin.\n`);
    } else {
      console.log(`Syncing from Zoho every ${mins} minute(s).`);
    }
    console.log(`Press Ctrl+C to stop.\n`);
  });
})();
