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

// ----- load config (local file falls back to environment variables) -----
let CONFIG = {};
try { CONFIG = require("./config.json"); } catch {}

const ZOHO_CLIENT_ID        = process.env.ZOHO_CLIENT_ID        || CONFIG.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET    = process.env.ZOHO_CLIENT_SECRET    || CONFIG.ZOHO_CLIENT_SECRET;
const ZOHO_ORG_ID           = process.env.ZOHO_ORG_ID           || CONFIG.ZOHO_ORG_ID;
const ZOHO_REFRESH_TOKEN    = process.env.ZOHO_REFRESH_TOKEN    || CONFIG.ZOHO_REFRESH_TOKEN;
const ZOHO_ACCOUNTS_DOMAIN  = process.env.ZOHO_ACCOUNTS_DOMAIN  || CONFIG.ZOHO_ACCOUNTS_DOMAIN;
const ZOHO_API_DOMAIN       = process.env.ZOHO_API_DOMAIN       || CONFIG.ZOHO_API_DOMAIN;
const WHOLESALE_FIELD       = process.env.WHOLESALE_FIELD       || CONFIG.WHOLESALE_FIELD;
const SYNC_INTERVAL_MINUTES = process.env.SYNC_INTERVAL_MINUTES || CONFIG.SYNC_INTERVAL_MINUTES || 5;
const CLIENTS = CONFIG.CLIENTS || JSON.parse(process.env.CLIENTS || "[]");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || CONFIG.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD || "";

const CACHE_FILE = path.join(__dirname, "items-cache.json");
const PORT_NUM = process.env.PORT || CONFIG.PORT || 3000;

// ============ image matching ============
const IMAGE_DIR = path.join(__dirname, "public", "assets", "product_images");
let imageFiles = [];
try { imageFiles = fs.readdirSync(IMAGE_DIR); } catch {}

function findImage(name) {
  if (!name || imageFiles.length === 0) return null;
  const words = new Set(name.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(t => t.length > 0));
  let best = null, bestScore = 0;
  for (const file of imageFiles) {
    const tokens = file.replace(/\.[^.]+$/, "").split(/[_\-]/).map(t => t.toLowerCase()).filter(t => t.length > 1);
    const matched = tokens.filter(t => words.has(t)).length;
    if (matched === tokens.length && matched > bestScore) { bestScore = matched; best = file; }
  }
  return best ? `/assets/product_images/${best}` : null;
}

const OVERRIDES_FILE = path.join(__dirname, "overrides.json");
function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")); } catch { return {}; }
}
function saveOverrides(o) { fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(o, null, 2)); }

function getItems() {
  const cache = getCache();
  const ov = loadOverrides();
  const items = cache.items.map(it => {
    const o = ov[it.id] || {};
    return {
      ...it,
      n:   o.n   !== undefined ? o.n   : it.n,
      p:   o.p   !== undefined ? o.p   : it.p,
      img: o.img !== undefined ? o.img : findImage(it.n),
    };
  });
  return { updatedAt: cache.updatedAt, items };
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

  // ---- API: login ----
  if (pathn === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    let creds = {};
    try { creds = JSON.parse(body); } catch {}
    if (checkLogin(creds.username, creds.password)) {
      const tok = makeToken();
      sessions.set(tok, { user: creds.username, exp: Date.now() + SESSION_MS });
      send(res, 200, { ok: true }, {
        "Set-Cookie": `session=${tok}; HttpOnly; Path=/; Max-Age=${SESSION_MS/1000}; SameSite=Lax`,
      });
    } else {
      send(res, 401, { ok: false, error: "invalid" });
    }
    return;
  }

  // ---- API: logout ----
  if (pathn === "/api/logout" && req.method === "POST") {
    const cookie = req.headers.cookie || "";
    const m = cookie.match(/session=([a-f0-9]+)/);
    if (m) sessions.delete(m[1]);
    send(res, 200, { ok: true }, { "Set-Cookie": "session=; Path=/; Max-Age=0" });
    return;
  }

  // ---- API: am I logged in? ----
  if (pathn === "/api/me") {
    const s = getSession(req);
    send(res, 200, { loggedIn: !!s });
    return;
  }

  // ---- API: items (protected) ----
  if (pathn === "/api/items") {
    const s = getSession(req);
    if (!s) { send(res, 401, { error: "unauthorized" }); return; }
    const data = getItems();
    send(res, 200, { updatedAt: data.updatedAt, items: data.items });
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
