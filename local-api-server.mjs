import { LOCAL_IMAGES } from './product-image-manifest.js';
import { createMatcher } from './lib/product-matching.js';
import { loadClients, findClient, toClientProfile } from './lib/clients.js';
// Local API server — mirrors the Vercel serverless functions for development.
// Run alongside Vite: node local-api-server.mjs
// Vite proxies /api/* to this server (see vite.config.js).

import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const lines = readFileSync(join(__dir, '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const ZOHO_AUTH_DOMAIN = process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN  = process.env.ZOHO_API_DOMAIN  ?? 'https://www.zohoapis.com';
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?q=80&w=600&auto=format&fit=crop';
const PORT = Number(process.env.PORT) || 3000;

// ── Caches ───────────────────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

let cachedProducts = null;
let productsExpiresAt = 0;
const PRODUCTS_TTL_MS = 60 * 60 * 1000;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const res = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return cachedToken;
}

const PER_PAGE = 200;

async function fetchPage(token, orgId, page) {
  const res = await fetch(
    `${ZOHO_API_DOMAIN}/books/v3/items?organization_id=${orgId}&page=${page}&per_page=${PER_PAGE}&status=active`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  if (!res.ok) throw new Error(`Zoho API HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Zoho error: ${data.message}`);
  return data;
}

const BATCH_SIZE = 5;

async function fetchAllItems(token, orgId) {
  const first = await fetchPage(token, orgId, 1);
  const items = [...(first.items ?? [])];
  if (!first.page_context?.has_more_page) return items;

  let nextPage = 2;
  while (true) {
    const batch = await Promise.all(
      Array.from({ length: BATCH_SIZE }, (_, i) => fetchPage(token, orgId, nextPage + i))
    );
    let done = false;
    for (const page of batch) {
      items.push(...(page.items ?? []));
      if (!page.page_context?.has_more_page) { done = true; break; }
    }
    if (done) break;
    nextPage += BATCH_SIZE;
  }
  return items;
}

// Shared with server.cjs and the Vercel functions — see lib/product-matching.js.
// This process reads images from the pre-built manifest rather than the disk.
const { findProductImage, normalizeItem } = createMatcher(LOCAL_IMAGES);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

const FALLBACK_PRODUCTS = [
  {
    id: "1", zoho_item_id: "1", name: "Logitech MX Master 3S Wireless Mouse",
    sku: "910-006557", barcode: "097855174574", brand: "Logitech", category: "Mouse",
    price: 99.99, wholesale_price: 79.99, in_stock: true, stock_on_hand: 25,
    description: "Quiet Click wireless performance mouse with 8K DPI tracking and ergonomic design.",
    images: ["/assets/product_images/Logitech_MX_Master_3S.webp"]
  },
  {
    id: "2", zoho_item_id: "2", name: "Logitech MX Keys S Wireless Keyboard",
    sku: "920-011558", barcode: "097855174581", brand: "Logitech", category: "Keyboard",
    price: 119.99, wholesale_price: 94.99, in_stock: true, stock_on_hand: 18,
    description: "Fluid typing illuminated keyboard with Smart Actions and USB-C fast charging.",
    images: ["/assets/product_images/Logitech_MX_Keys_S.webp"]
  },
  {
    id: "3", zoho_item_id: "3", name: "Anker 555 USB-C Hub 8-in-1 PowerExpand",
    sku: "A83830A1", barcode: "194644023456", brand: "Anker", category: "Adapter / Hub",
    price: 69.99, wholesale_price: 49.99, in_stock: true, stock_on_hand: 40,
    description: "Multiport adapter with 100W Power Delivery, 4K HDMI, Ethernet, and SD card reader.",
    images: ["/assets/product_images/Anker_555_USB_C_Hub_Official.webp"]
  },
  {
    id: "4", zoho_item_id: "4", name: "Poly Voyager Focus 2 UC Headset",
    sku: "213726-01", barcode: "017229172455", brand: "Poly", category: "Headset",
    price: 249.99, wholesale_price: 199.99, in_stock: true, stock_on_hand: 12,
    description: "Stereo Bluetooth headset with active noise canceling (ANC) and smart sensors.",
    images: ["/assets/product_images/Poly_Voyager_Focus_2.webp"]
  },
  {
    id: "5", zoho_item_id: "5", name: "Jabra Evolve2 65 Wireless Headset",
    sku: "26599-989-999", barcode: "5706991022835", brand: "Jabra", category: "Headset",
    price: 219.99, wholesale_price: 175.00, in_stock: true, stock_on_hand: 15,
    description: "Professional wireless headset engineered to keep you focused with noise isolating foam.",
    images: ["/assets/product_images/Jabra_Evolve2_65.webp"]
  },
  {
    id: "6", zoho_item_id: "6", name: "JBL Flip 6 Portable Waterproof Speaker",
    sku: "JBLFLIP6BLKAM", barcode: "050036387063", brand: "JBL", category: "Speakers",
    price: 129.95, wholesale_price: 98.50, in_stock: true, stock_on_hand: 30,
    description: "Powerful 2-way speaker system delivering loud, crystal clear, powerful sound.",
    images: ["/assets/product_images/JBL_Flip_6.webp"]
  },
  {
    id: "7", zoho_item_id: "7", name: "Logitech Brio 4K Ultra HD Webcam",
    sku: "960-001105", barcode: "097855125439", brand: "Logitech", category: "Video Conference",
    price: 199.99, wholesale_price: 155.00, in_stock: true, stock_on_hand: 10,
    description: "Premium 4K webcam with HDR and Windows Hello support for professional video calls.",
    images: ["/assets/product_images/Logitech_Brio_4K.webp"]
  },
  {
    id: "8", zoho_item_id: "8", name: "Onten 9118 USB-C Multiport Docking Station",
    sku: "OTN-9118", barcode: "6956328391181", brand: "Onten", category: "Adapter / Hub",
    price: 45.00, wholesale_price: 32.00, in_stock: true, stock_on_hand: 50,
    description: "Aluminum 11-in-1 USB-C dock with dual HDMI, VGA, RJ45 Gigabit Ethernet and USB 3.0 ports.",
    images: ["/assets/product_images/Onten_OTN-9118.webp"]
  },
  {
    id: "9", zoho_item_id: "9", name: "Lention USB-C Hub with 4K HDMI",
    sku: "CB-CE18", barcode: "6970420180123", brand: "Lention", category: "Adapter / Hub",
    price: 35.00, wholesale_price: 24.50, in_stock: true, stock_on_hand: 45,
    description: "Compact Type-C adapter with 4K HDMI output, 3 USB 3.0 ports, and Power Delivery.",
    images: ["/assets/product_images/Lention_CB-CE18_Official.webp"]
  },
  {
    id: "10", zoho_item_id: "10", name: "Logitech G Pro X Superlight 2 Wireless Gaming Mouse",
    sku: "910-006628", barcode: "097855184511", brand: "Logitech", category: "Mouse",
    price: 159.99, wholesale_price: 129.99, in_stock: true, stock_on_hand: 20,
    description: "Next-gen 60g ultralight esports mouse with LIGHTFORCE hybrid switches and HERO 2 sensor.",
    images: ["/assets/product_images/Logitech_G_Pro_X_Superlight_2.webp"]
  },
  {
    id: "11", zoho_item_id: "11", name: "Poly Sync 20 Plus Bluetooth Speakerphone",
    sku: "216867-01", barcode: "017229171236", brand: "Poly", category: "Video Conference",
    price: 179.99, wholesale_price: 139.00, in_stock: true, stock_on_hand: 16,
    description: "Smart speakerphone for conference calls and music with multi-microphone steerable array.",
    images: ["/assets/product_images/Poly_Sync_20_Plus.webp"]
  },
  {
    id: "12", zoho_item_id: "12", name: "Elgato Stream Deck MK.2",
    sku: "10GAA9901", barcode: "840006637400", brand: "Elgato", category: "Streaming",
    price: 149.99, wholesale_price: 119.00, in_stock: true, stock_on_hand: 22,
    description: "15 customizable LCD keys to control apps, tools, and platforms with tactile feedback.",
    images: ["/assets/product_images/Elgato_Stream_Deck_MK2.webp"]
  },
  {
    id: "13", zoho_item_id: "13", name: "JBL Tune 770NC Wireless Over-Ear Headphones",
    sku: "JBLT770NCBLU", barcode: "050036394511", brand: "JBL", category: "Headset",
    price: 129.95, wholesale_price: 89.00, in_stock: true, stock_on_hand: 28,
    description: "Adaptive Noise Cancelling wireless headphones with JBL Pure Bass Sound and 70H battery life.",
    images: ["/assets/product_images/JBL_Tune_770NC.webp"]
  },
  {
    id: "14", zoho_item_id: "14", name: "Samsung T7 Shield 1TB Portable SSD",
    sku: "MU-PE1T0S/AM", barcode: "887276633856", brand: "Samsung", category: "Adapter / Hub",
    price: 134.99, wholesale_price: 99.00, in_stock: true, stock_on_hand: 35,
    description: "Rugged external solid state drive with IP65 dust and water resistance and USB 3.2 Gen 2.",
    images: ["/assets/product_images/Samsung_T7_Shield.webp"]
  }
];

// ── Server ───────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/products') {
    try {
      let overrides = {};
      try {
        const overridesPath = join(__dir, 'overrides.json');
        if (readFileSync && readFileSync(overridesPath, 'utf8')) {
          overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
        }
      } catch {}

      if (cachedProducts && Date.now() < productsExpiresAt) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ products: cachedProducts }));
      }
      if (!process.env.ZOHO_REFRESH_TOKEN || !process.env.ZOHO_ORG_ID) {
        cachedProducts = FALLBACK_PRODUCTS.map((p, i) => normalizeItem(p, i, overrides));
        productsExpiresAt = Date.now() + PRODUCTS_TTL_MS;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ products: cachedProducts }));
      }
      const token = await getAccessToken();
      const items = await fetchAllItems(token, process.env.ZOHO_ORG_ID);
      const products = items.map((item, i) => normalizeItem(item, i, overrides));
      cachedProducts = products.length > 0 ? products : FALLBACK_PRODUCTS.map((p, i) => normalizeItem(p, i, overrides));
      productsExpiresAt = Date.now() + PRODUCTS_TTL_MS;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ products: cachedProducts }));
    } catch (err) {
      console.error('Zoho API Error, using fallback products:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ products: FALLBACK_PRODUCTS.map((p, i) => normalizeItem(p, i, overrides)) }));
    }
    return;
  }

  if (url.pathname === '/api/wholesale-login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { email, password } = JSON.parse(body || '{}');
        const client = findClient(loadClients(process.env), email, password);
        if (!client) return json(res, 401, { error: 'Invalid email or password' });
        json(res, 200, { success: true, client: toClientProfile(client) });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
}).listen(PORT, () => {
  console.log(`✓ Local API server running on http://localhost:${PORT}`);
});
