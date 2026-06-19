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

// ----- load config -----
const CONFIG = require("./config.json");
const {
  ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORG_ID, ZOHO_REFRESH_TOKEN,
  ZOHO_ACCOUNTS_DOMAIN, ZOHO_API_DOMAIN,
  CLIENTS, SYNC_INTERVAL_MINUTES, PORT,
  WHOLESALE_FIELD,
} = CONFIG;

const CACHE_FILE = path.join(__dirname, "items-cache.json");
const PORT_NUM = PORT || 3000;

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

// ============ HTTP server ============
function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, headers));
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
    ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon" };
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
    const cache = getCache();
    send(res, 200, { updatedAt: cache.updatedAt, items: cache.items });
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
