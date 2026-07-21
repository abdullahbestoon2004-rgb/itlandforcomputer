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
const PORT = 3000;

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

function getCustomField(item, label) {
  return (item.custom_fields ?? []).find(f => f.label === label)?.value ?? null;
}

function normalizeItem(item, index) {
  const wholesaleRaw = getCustomField(item, 'Wholesale Price');
  const wholesalePrice = wholesaleRaw != null ? parseFloat(String(wholesaleRaw).replace(/[^0-9.]/g, '')) : null;
  const imageUrl = getCustomField(item, 'Image URL');
  const stockOnHand = item.stock_on_hand != null ? Number(item.stock_on_hand) : null;
  return {
    id: String(item.item_id),
    zoho_item_id: String(item.item_id),
    name: item.name ?? '',
    description: item.description ?? '',
    price: Number(item.rate ?? 0),
    wholesale_price: isNaN(wholesalePrice) ? null : wholesalePrice,
    category: item.product_type ?? 'Accessories',
    brand: getCustomField(item, 'Brand') ?? '',
    images: imageUrl ? [imageUrl] : [PLACEHOLDER_IMAGE],
    featured: getCustomField(item, 'Featured')?.toLowerCase() === 'true',
    order_index: index,
    stock_on_hand: stockOnHand,
    in_stock: stockOnHand === null || stockOnHand > 0,
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// ── Server ───────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/products') {
    try {
      if (cachedProducts && Date.now() < productsExpiresAt) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ products: cachedProducts }));
      }
      const token = await getAccessToken();
      const items = await fetchAllItems(token, process.env.ZOHO_ORG_ID);
      const products = items.map((item, i) => normalizeItem(item, i));
      cachedProducts = products;
      productsExpiresAt = Date.now() + PRODUCTS_TTL_MS;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ products }));
    } catch (err) {
      console.error(err.message);
      json(res, 500, { error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/wholesale-login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        const { email, password } = JSON.parse(body);
        const input = (email || '').toLowerCase().trim();
        const clients = JSON.parse(process.env.WHOLESALE_CLIENTS ?? '[]');
        const client = clients.find(c =>
          ((c.email || '').toLowerCase().trim() === input || (c.username || '').toLowerCase().trim() === input) && c.password === password
        );
        if (!client) return json(res, 401, { error: 'Invalid email or password' });
        json(res, 200, { success: true, client: { name: client.name ?? client.username ?? 'Client', company: client.company ?? null, email: client.email ?? client.username } });
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
