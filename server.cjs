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

const ZOHO_CLIENT_ID        = process.env.ZOHO_CLIENT_ID        || CONFIG.ZOHO_CLIENT_ID || '1000.06T75SSOK56I52CL0GHJL45YVSG7DK';
const ZOHO_CLIENT_SECRET    = process.env.ZOHO_CLIENT_SECRET    || CONFIG.ZOHO_CLIENT_SECRET || '783ace0cbad1786e5b0fd1834c72e63668c59978fb';
const ZOHO_ORG_ID           = process.env.ZOHO_ORG_ID           || CONFIG.ZOHO_ORG_ID;
const ZOHO_REFRESH_TOKEN    = process.env.ZOHO_REFRESH_TOKEN    || CONFIG.ZOHO_REFRESH_TOKEN;
const ZOHO_ACCOUNTS_DOMAIN  = process.env.ZOHO_ACCOUNTS_DOMAIN  || CONFIG.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN       = process.env.ZOHO_API_DOMAIN       || CONFIG.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const WHOLESALE_FIELD       = process.env.WHOLESALE_FIELD       || CONFIG.WHOLESALE_FIELD;
const SYNC_INTERVAL_MINUTES = process.env.SYNC_INTERVAL_MINUTES || CONFIG.SYNC_INTERVAL_MINUTES || 5;
const CLIENTS = CONFIG.CLIENTS || JSON.parse(process.env.WHOLESALE_CLIENTS || process.env.CLIENTS || '[{"username":"itland","email":"itland","password":"itland123","name":"iTLand Client"}]');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || CONFIG.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD || "";

const CACHE_FILE = path.join(__dirname, "items-cache.json");
const PORT_NUM = process.env.PORT || CONFIG.PORT || 3000;

// ============ image matching ============
const IMAGE_DIR = path.join(__dirname, "public", "assets", "product_images");
let imageFiles = [];
try { imageFiles = fs.readdirSync(IMAGE_DIR); } catch {}

const BRAND_SYNONYMS = {
  logitech: ['logitech', 'logi', 'ultimate ears', 'astro', 'blue yeti', 'blue snowball'],
  poly: ['poly', 'plantronics', 'polycom'],
  plantronics: ['poly', 'plantronics', 'polycom'],
  jabra: ['jabra'],
  jbl: ['jbl'],
  anker: ['anker', 'soundcore', 'eufy', 'nebula'],
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
  const reg = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  return reg.test(text);
}

function findProductImage(item) {
  if (!item || imageFiles.length === 0) return null;
  const rawName = (item.n || item.name || '').trim();
  const rawSku = (item.s || item.sku || '').trim();
  const rawDesc = (item.description || item.purchase_description || item.d || '').replace(/\s+/g, ' ').trim();
  const rawBrand = (item.brand || '').trim();

  // Combine Name, SKU, Description, Purchase Description, Barcode to catch Zoho titles
  const combinedText = [rawName, rawSku, rawDesc, rawBrand, item.barcode].filter(Boolean).join(' ');
  const titleText = normalizeString(combinedText);
  const titleDense = combinedText.toLowerCase().replace(/[^a-z0-9]/g, '');

  let productBrand = rawBrand.toLowerCase().trim();
  if (!productBrand) {
    for (const [bKey, aliases] of Object.entries(BRAND_SYNONYMS)) {
      if (aliases.some(a => matchesWordExact(titleText, a))) {
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
    const modelTokens = parts.slice(1).map(p => p.toLowerCase());
    const fullModelName = modelTokens.join(' ');
    const modelDense = fullModelName.replace(/[^a-z0-9]/g, '');

    // Strict Brand Match: skip if brand is mismatched
    if (productBrand) {
      const allowedAliases = BRAND_SYNONYMS[productBrand] || [productBrand];
      const isBrandMatch = allowedAliases.some(a => a === imgBrand || BRAND_SYNONYMS[imgBrand]?.includes(a));
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
    img: "/assets/product_images/Logitech_MX_Master_3S.jpg"
  },
  {
    id: "2", n: "Logitech MX Keys S Wireless Keyboard", s: "920-011558", barcode: "097855174581",
    brand: "Logitech", category: "Keyboard", p: 94.99, retail: 119.99, k: true, stock: 18,
    d: "Fluid typing illuminated keyboard with Smart Actions and USB-C fast charging.",
    img: "/assets/product_images/Logitech_MX_Keys_S.jpg"
  },
  {
    id: "3", n: "Anker 555 USB-C Hub 8-in-1 PowerExpand", s: "A83830A1", barcode: "194644023456",
    brand: "Anker", category: "Adapter / Hub", p: 49.99, retail: 69.99, k: true, stock: 40,
    d: "Multiport adapter with 100W Power Delivery, 4K HDMI, Ethernet, and SD card reader.",
    img: "/assets/product_images/Anker_555_USB_C_Hub.jpg"
  },
  {
    id: "4", n: "Poly Voyager Focus 2 UC Headset", s: "213726-01", barcode: "017229172455",
    brand: "Poly", category: "Headset", p: 199.99, retail: 249.99, k: true, stock: 12,
    d: "Stereo Bluetooth headset with active noise canceling (ANC) and smart sensors.",
    img: "/assets/product_images/Poly_Voyager_Focus_2.jpg"
  },
  {
    id: "5", n: "Jabra Evolve2 65 Wireless Headset", s: "26599-989-999", barcode: "5706991022835",
    brand: "Jabra", category: "Headset", p: 175.00, retail: 219.99, k: true, stock: 15,
    d: "Professional wireless headset engineered to keep you focused with noise isolating foam.",
    img: "/assets/product_images/Jabra_Evolve2_65.jpg"
  },
  {
    id: "6", n: "JBL Flip 6 Portable Waterproof Speaker", s: "JBLFLIP6BLKAM", barcode: "050036387063",
    brand: "JBL", category: "Speakers", p: 98.50, retail: 129.95, k: true, stock: 30,
    d: "Powerful 2-way speaker system delivering loud, crystal clear, powerful sound.",
    img: "/assets/product_images/JBL_Flip_6.jpeg"
  },
  {
    id: "7", n: "Logitech Brio 4K Ultra HD Webcam", s: "960-001105", barcode: "097855125439",
    brand: "Logitech", category: "Video Conference", p: 155.00, retail: 199.99, k: true, stock: 10,
    d: "Premium 4K webcam with HDR and Windows Hello support for professional video calls.",
    img: "/assets/product_images/Logitech_Brio_4K.png"
  },
  {
    id: "8", n: "Onten 9118 USB-C Multiport Docking Station", s: "OTN-9118", barcode: "6956328391181",
    brand: "Onten", category: "Adapter / Hub", p: 32.00, retail: 45.00, k: true, stock: 50,
    d: "Aluminum 11-in-1 USB-C dock with dual HDMI, VGA, RJ45 Gigabit Ethernet and USB 3.0 ports.",
    img: "/assets/product_images/Onten_OTN-9118.jpg"
  },
  {
    id: "9", n: "Lention USB-C Hub with 4K HDMI", s: "CB-CE18", barcode: "6970420180123",
    brand: "Lention", category: "Adapter / Hub", p: 24.50, retail: 35.00, k: true, stock: 45,
    d: "Compact Type-C adapter with 4K HDMI output, 3 USB 3.0 ports, and Power Delivery.",
    img: "/assets/product_images/Lention_USB_C_Hub.jpg"
  },
  {
    id: "10", n: "Logitech G Pro X Superlight 2 Wireless Gaming Mouse", s: "910-006628", barcode: "097855184511",
    brand: "Logitech", category: "Mouse", p: 129.99, retail: 159.99, k: true, stock: 20,
    d: "Next-gen 60g ultralight esports mouse with LIGHTFORCE hybrid switches and HERO 2 sensor.",
    img: "/assets/product_images/Logitech_G_Pro_X_Superlight_2_DEX.png"
  },
  {
    id: "11", n: "Poly Sync 20 Plus Bluetooth Speakerphone", s: "216867-01", barcode: "017229171236",
    brand: "Poly", category: "Video Conference", p: 139.00, retail: 179.99, k: true, stock: 16,
    d: "Smart speakerphone for conference calls and music with multi-microphone steerable array.",
    img: "/assets/product_images/Poly_Sync_20_Plus.jpg"
  },
  {
    id: "12", n: "Elgato Stream Deck MK.2", s: "10GAA9901", barcode: "840006637400",
    brand: "Elgato", category: "Streaming", p: 119.00, retail: 149.99, k: true, stock: 22,
    d: "15 customizable LCD keys to control apps, tools, and platforms with tactile feedback.",
    img: "/assets/product_images/Elgato_Stream_Deck_MK2.jpg"
  },
  {
    id: "13", n: "JBL Tune 770NC Wireless Over-Ear Headphones", s: "JBLT770NCBLU", barcode: "050036394511",
    brand: "JBL", category: "Headset", p: 89.00, retail: 129.95, k: true, stock: 28,
    d: "Adaptive Noise Cancelling wireless headphones with JBL Pure Bass Sound and 70H battery life.",
    img: "/assets/product_images/JBL_Tune_770NC.jpg"
  },
  {
    id: "14", n: "Samsung T7 Shield 1TB Portable SSD", s: "MU-PE1T0S/AM", barcode: "887276633856",
    brand: "Samsung", category: "Adapter / Hub", p: 99.00, retail: 134.99, k: true, stock: 35,
    d: "Rugged external solid state drive with IP65 dust and water resistance and USB 3.2 Gen 2.",
    img: "/assets/product_images/Samsung_T7_Shield.jpg"
  }
];

function getItems() {
  const cache = getCache();
  const ov = loadOverrides();
  const rawList = cache.items && cache.items.length > 0 ? cache.items : FALLBACK_ITEMS;
  const items = rawList.map(it => {
    const o = ov[it.id] || {};
    const autoImg = findProductImage(it);
    return {
      ...it,
      n:   o.n   !== undefined ? o.n   : it.n,
      p:   o.p   !== undefined ? o.p   : it.p,
      img: o.img !== undefined ? o.img : (autoImg || it.img || null),
    };
  });
  return { updatedAt: cache.updatedAt || Date.now(), items };
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

// Map a Zoho item to the shape the frontend design expects:
// { n:name, s:sku, c:category, p:wholesalePrice, k:inStock, d:specs }
function mapItem(it, priceMap) {
  const stock = it.available_stock != null ? it.available_stock
              : (it.stock_on_hand != null ? it.stock_on_hand : 0);

  const rawDesc = (it.purchase_description || it.description || "").replace(/\s+/g, " ").trim();

  // Extract product name from description — strip trailing part numbers and price info
  const nameFromDesc = rawDesc
    .replace(/\s+\d{3,}-\d{4,}.*$/, "")
    .replace(/\s+Office\s+Price.*$/i, "")
    .replace(/\s+Price\s+\d.*$/i, "")
    .trim();

  // Wholesale price: custom field → price map → embedded in description ("Office Price 6.4$ E")
  let wholesale = "";
  const cf = (it.custom_fields || []).find(f => f.api_name === WHOLESALE_FIELD);
  if (cf && cf.value !== "" && cf.value != null) wholesale = Number(cf.value);
  if ((wholesale === "" || isNaN(wholesale)) && priceMap[it.item_id] != null) wholesale = Number(priceMap[it.item_id]);
  if (wholesale === "" || isNaN(wholesale)) {
    const m = rawDesc.match(/(?:Office\s+Price|Wholesale\s+Price|Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
    if (m) wholesale = Number(m[1].replace(",", "."));
  }

  return {
    id: it.item_id,
    n: nameFromDesc || it.name || "",
    s: it.sku || "",
    barcode: it.name || "",
    c: "all",
    p: (wholesale === "" || isNaN(wholesale)) ? null : wholesale,
    retail: it.rate != null ? Number(it.rate) : null,
    k: Number(stock) > 0,
    stock: Number(stock),
    d: rawDesc.slice(0, 120),
  };
}

async function syncNow() {
  if (!ZOHO_ORG_ID || !ZOHO_REFRESH_TOKEN) {
    return;
  }
  try {
    console.log(new Date().toISOString(), "Syncing from Zoho...");
    const raw = await fetchAllItems();
    const priceMap = loadPriceMap();
    const items = raw.map(it => mapItem(it, priceMap));
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ updatedAt: Date.now(), items }, null, 0));
    console.log(`  cached ${items.length} items (${items.filter(i=>i.k).length} in stock)`);
  } catch (e) {
    console.error("  sync failed:", e.message);
  }
}

function getCache() {
  if (!fs.existsSync(CACHE_FILE)) return { updatedAt: 0, items: [] };
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { return { updatedAt: 0, items: [] }; }
}

// ============ simple session auth ============
const sessions = new Map(); // token -> { user, exp }
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function makeToken() { return crypto.randomBytes(24).toString("hex"); }

function checkLogin(username, password) {
  const u = (CLIENTS || []).find(c =>
    c.username.toLowerCase() === String(username).toLowerCase() && c.password === password);
  return !!u;
}

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
    if (checkLogin(usernameInput, passwordInput)) {
      const tok = makeToken();
      sessions.set(tok, { user: usernameInput, exp: Date.now() + SESSION_MS });
      const clientObj = { name: usernameInput || 'Client', company: null, email: usernameInput };
      send(res, 200, { ok: true, success: true, client: clientObj }, {
        "Set-Cookie": `session=${tok}; HttpOnly; Path=/; Max-Age=${SESSION_MS/1000}; SameSite=Lax`,
      });
    } else {
      send(res, 401, { ok: false, success: false, error: "invalid" });
    }
    return;
  }

  // ---- API: products / items ----
  if (pathn === "/api/products" || pathn === "/api/items") {
    const data = getItems();
    send(res, 200, { updatedAt: data.updatedAt, products: data.items, items: data.items });
    return;
  }

  // ---- Admin API ----
  if (pathn === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    let creds = {};
    try { creds = JSON.parse(body); } catch {}
    if (ADMIN_USERNAME && creds.username === ADMIN_USERNAME && creds.password === ADMIN_PASSWORD) {
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
    const { itemId, n, p, img } = data;
    if (!itemId) { send(res, 400, { error: "itemId required" }); return; }
    const overrides = loadOverrides();
    if (!overrides[itemId]) overrides[itemId] = {};
    if (n === null) delete overrides[itemId].n; else if (n !== undefined) overrides[itemId].n = n;
    if (p === null) delete overrides[itemId].p; else if (p !== undefined) overrides[itemId].p = p;
    if (img === null) delete overrides[itemId].img; else if (img !== undefined) overrides[itemId].img = img;
    if (Object.keys(overrides[itemId]).length === 0) delete overrides[itemId];
    saveOverrides(overrides);
    send(res, 200, { ok: true });
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
  if (pathn === "/api/admin/search-images") {
    if (!getAdminSession(req)) { send(res, 401, { error: "unauthorized" }); return; }
    const q = url.searchParams.get("q") || "";
    if (!q.trim()) { send(res, 400, { error: "Query required" }); return; }
    try {
      const cleanQuery = q.replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();
      const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery + " product")}`;
      const tokenRes = await fetch(tokenUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      const html = await tokenRes.text();
      const vqdMatch = html.match(/vqd=([0-9-]+)/) || html.match(/vqd=([a-zA-Z0-9_-]+)/) || html.match(/vqd="([^"]+)"/);
      if (!vqdMatch) { send(res, 200, { results: [] }); return; }
      const vqd = vqdMatch[1];
      const imgUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}`;
      const imgRes = await fetch(imgUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://duckduckgo.com/"
        }
      });
      const data = await imgRes.json();
      const results = (data.results || []).slice(0, 8).map(r => ({
        title: r.title,
        image: r.image,
        thumbnail: r.thumbnail,
        width: r.width,
        height: r.height,
        source: r.url
      }));
      send(res, 200, { results });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
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
    console.log(`Syncing from Zoho every ${mins} minute(s).`);
    console.log(`Press Ctrl+C to stop.\n`);
  });
})();
