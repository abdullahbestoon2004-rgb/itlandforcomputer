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

function getWholesalePrice(item) {
  const customFields = item.custom_fields ?? [];
  const cf = customFields.find((f) =>
    /wholesale|office\s*price/i.test(f.label ?? '') ||
    /wholesale|office/i.test(f.api_name ?? '')
  );
  if (cf && cf.value != null && cf.value !== '') {
    const parsed = parseFloat(String(cf.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const desc = `${item.description ?? ''} ${item.purchase_description ?? ''}`;
  const match = desc.match(/(?:Office\s+Price|Wholesale\s+Price|Wholesale|Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
  if (match) {
    const parsed = parseFloat(match[1].replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (item.rate != null && Number(item.rate) > 0) return Number(item.rate);
  if (item.purchase_rate != null && Number(item.purchase_rate) > 0) return Number(item.purchase_rate);
  return null;
}

const LOCAL_IMAGES = [
  "Anker_PowerExpand_7-in-1.jpg", "DM_USB_Flash_Drive.jpg", "Dell_WD19S_Dock.jpg",
  "Elgato_Stream_Deck_MK2.jpg", "JBL_Flip_6.jpeg", "JBL_Tune_770NC.jpg", "Jabra_Evolve_40.jpg",
  "Jabra_Speak2_75.jpg", "Jabra_Speak_510.jpg", "Jabra_Speak_510_UC.jpeg", "Lention_USB_C_Hub.jpg",
  "Logitech_B100.png", "Logitech_B220_Silent.jpg", "Logitech_B330_Silent_Plus.jpg", "Logitech_BCC950.png",
  "Logitech_Blue_Snowball.png", "Logitech_Blue_Yeti.jpg", "Logitech_Brio_100.png", "Logitech_Brio_300.png",
  "Logitech_Brio_301.jpg", "Logitech_Brio_305.webp", "Logitech_Brio_4K.png", "Logitech_Brio_500.png",
  "Logitech_C270.jpg", "Logitech_C310.jpg", "Logitech_C505.png", "Logitech_C615.jpg", "Logitech_C920_PRO.png",
  "Logitech_C922.png", "Logitech_C925e.jpg", "Logitech_C930e.webp", "Logitech_ConferenceCam_Connect.jpg",
  "Logitech_Craft.jpg", "Logitech_Desk_Mat.jpg", "Logitech_Driving_Force_Shifter.png",
  "Logitech_Flight_Panels_Bundle.jpg", "Logitech_Flight_Radio_Panel.jpg", "Logitech_G213.png",
  "Logitech_G29.jpeg", "Logitech_G300s.jpeg", "Logitech_G305.png", "Logitech_G309.png",
  "Logitech_G413_TKL.png", "Logitech_G435.png", "Logitech_G502_Lightspeed.jpg", "Logitech_G513.png",
  "Logitech_G515_TKL.jpg", "Logitech_G633.jpg", "Logitech_G635.jpg", "Logitech_G733.png",
  "Logitech_G840_XL.jpg", "Logitech_G915_TKL.jpg", "Logitech_G920.png", "Logitech_G923.png",
  "Logitech_G933.jpg", "Logitech_G933S.jpg", "Logitech_G_Pro_2_Lightspeed.png", "Logitech_G_Pro_Keyboard.png",
  "Logitech_G_Pro_Wired.jpg", "Logitech_G_Pro_Wireless.png", "Logitech_G_Pro_X_2.jpeg",
  "Logitech_G_Pro_X_Superlight.jpeg", "Logitech_G_Pro_X_Superlight_2_DEX.png", "Logitech_H110.jpeg",
  "Logitech_H111.png", "Logitech_H151.png", "Logitech_H340.jpg", "Logitech_H570e.png",
  "Logitech_K120.jpg", "Logitech_K375s.jpg", "Logitech_K380.png", "Logitech_K480.jpg",
  "Logitech_K580.jpg", "Logitech_K780.png", "Logitech_Keys-To-Go_2.png", "Logitech_Lift_Vertical.png",
  "Logitech_Line_Friends_Mouse.jpg", "Logitech_Litra_Beam.png", "Logitech_Litra_Glow.png",
  "Logitech_Logi_Dock.jpg", "Logitech_M170.jpg", "Logitech_M171.jpg", "Logitech_M185.png",
  "Logitech_M196_Bluetooth_Mouse.jpg", "Logitech_M235.jpg", "Logitech_M317.png", "Logitech_M330_Silent_Plus.png",
  "Logitech_M705.png", "Logitech_MK120.png", "Logitech_MK270.jpg", "Logitech_MK470.png",
  "Logitech_MK710.jpg", "Logitech_MK850.png", "Logitech_MX_Anywhere_3S.png", "Logitech_MX_Brio.png",
  "Logitech_MX_Brio_4K.png", "Logitech_MX_Brio_705.jpg", "Logitech_MX_Creative_Console.png",
  "Logitech_MX_Keys_Business.jpg", "Logitech_MX_Keys_Combo_Gen2.jpg", "Logitech_MX_Keys_Mini.png",
  "Logitech_MX_Keys_S.jpg", "Logitech_MX_Master_3S.jpg", "Logitech_MX_Master_4.png",
  "Logitech_MX_Mechanical.jpg", "Logitech_MX_Mechanical_Mini.png", "Logitech_MX_Vertical.jpg",
  "Logitech_MeetUp.jpg", "Logitech_MeetUp_2.png", "Logitech_POP_Keys.png", "Logitech_Pebble_Keys_2.jpg",
  "Logitech_Pebble_M350.png", "Logitech_Pebble_Mouse_2.png", "Logitech_R400.jpeg", "Logitech_R800.png",
  "Logitech_Rally_Bar.jpg", "Logitech_Rally_Mic_Pod_Cat_Coupler.png", "Logitech_Rally_Mic_Pod_Mount.png",
  "Logitech_Rally_Mounting_Kit.png", "Logitech_Rally_Plus.png", "Logitech_Rally_System.jpg",
  "Logitech_Scribe.png", "Logitech_Sight.png", "Logitech_Signature_M550_L.jpg", "Logitech_Signature_M650.jpg",
  "Logitech_Signature_Slim_Combo_MK955.png", "Logitech_Signature_Slim_Solar_Plus.png", "Logitech_Spotlight.jpg",
  "Logitech_StreamCam.png", "Logitech_Tap_IP.png", "Logitech_Unifying_Receiver.png", "Logitech_Voice_M380.png",
  "Logitech_Wave_Keys.png", "Logitech_Yeti_GX.png", "Logitech_Z150.jpg", "Logitech_Z200.png",
  "Logitech_Z207.jpg", "Logitech_Z313.jpg", "Logitech_Z333.jpg", "Logitech_Z407.jpg",
  "Logitech_Z623.jpg", "Logitech_Z906.jpg", "Logitech_Zone_Vibe_100.png", "Logitech_Zone_Wireless.jpg",
  "Logitech_Zone_Wireless_2.jpg", "Onten_OTN-5138HV.jpg", "Onten_OTN-5215B.jpg", "Onten_OTN-5222.webp",
  "Onten_OTN-7598.png", "Onten_OTN-8120.jpg", "Onten_OTN-9175K.webp", "Onten_OTN-9199A.webp",
  "Onten_OTN-9299.jpg", "Onten_OTN-9399.webp", "Onten_OTN-9591A.webp", "Onten_OTN-9598.jpg",
  "Onten_OTN-CS21.jpg", "Onten_OTN-CS341.jpg", "Onten_OTN-MS661_Plus.jpg", "Onten_OTN-UC101.jpg",
  "Onten_OTN-UC302.jpg", "Onten_OTN-UC601.jpg", "Onten_OTN-UC602.jpg", "Onten_OTN-UC620.jpg",
  "Onten_OTN-UCA9702.webp", "Onten_OTN-UCD22.jpg", "Onten_USB-C_0.2M.jpg", "Plantronics_Blackwire_C3200.jpg",
  "Plantronics_Voyager_4210_UC.jpg", "Poly_Blackwire_3310.jpg", "Poly_Blackwire_C3210.webp",
  "Poly_Sync_20.jpg", "Poly_Sync_20_Plus.jpg", "Poly_Voyager_4310.jpg", "Poly_Voyager_4320_UC.webp",
  "Razer_DeathAdder.jpg", "Samsung_T7_Shield.jpg", "SanDisk_Extreme_Portable_SSD.jpg",
  "UGREEN_USB_C_Hub.png", "Vention_HDMI_Cable.jpg"
];

function findProductImage(item) {
  const customImg = getCustomField(item, 'Image URL');
  if (customImg && typeof customImg === 'string' && customImg.startsWith('http')) return customImg;

  const rawName = (item.name ?? '').trim();
  const rawSku = (item.sku ?? '').trim();
  const rawDesc = `${item.description ?? ''} ${item.purchase_description ?? ''}`.trim();

  const fullText = `${rawName} ${rawSku} ${rawDesc}`.toLowerCase();
  const textWords = new Set(fullText.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 0));

  let bestFile = null;
  let bestScore = 0;

  for (const file of LOCAL_IMAGES) {
    const nameWithoutExt = file.replace(/\.[^.]+$/, '');
    const tokens = nameWithoutExt.split(/[_\-]/).map(t => t.toLowerCase()).filter(t => t.length > 1);

    const modelToken = tokens.find(t => t.length >= 3 && /\d/.test(t));

    if (modelToken && textWords.has(modelToken)) {
      const score = 100 + modelToken.length;
      if (score > bestScore) {
        bestScore = score;
        bestFile = file;
      }
    } else {
      const matched = tokens.filter(t => textWords.has(t)).length;
      if (matched === tokens.length && matched > 1 && matched > bestScore) {
        bestScore = matched;
        bestFile = file;
      }
    }
  }

  return bestFile ? `/assets/product_images/${bestFile}` : null;
}

function normalizeItem(item, index) {
  const wholesalePrice = getWholesalePrice(item);
  const matchedImage = findProductImage(item);
  const stockOnHand = item.stock_on_hand != null ? Number(item.stock_on_hand) : null;
  const customBarcode = getCustomField(item, 'Barcode') || getCustomField(item, 'UPC') || getCustomField(item, 'EAN');

  const rawName = (item.name ?? '').trim();
  const rawSku = (item.sku ?? '').trim();
  const isNameDigits = /^\d+$/.test(rawName);

  const modelName = (isNameDigits && rawSku) ? rawSku : (rawName || rawSku);
  const barcode = customBarcode || (isNameDigits ? rawName : (rawSku || rawName));

  return {
    id: String(item.item_id),
    zoho_item_id: String(item.item_id),
    name: modelName,
    sku: rawSku,
    barcode: barcode,
    description: item.description ?? '',
    price: Number(item.rate ?? 0),
    wholesale_price: wholesalePrice,
    category: item.product_type ?? 'Accessories',
    brand: getCustomField(item, 'Brand') ?? '',
    images: matchedImage ? [matchedImage] : [],
    featured: getCustomField(item, 'Featured')?.toLowerCase() === 'true',
    order_index: index,
    stock_on_hand: stockOnHand,
    in_stock: stockOnHand === null || stockOnHand > 0,
  };
}

const imageSearchCache = new Map();

async function getDDGImage(query) {
  if (imageSearchCache.has(query)) return imageSearchCache.get(query);
  try {
    const initRes = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const initText = await initRes.text();
    const vqdMatch = initText.match(/vqd=[\"']?([^&\"'\s]+)/) || initText.match(/vqd=\"([^\"]+)\"/);
    if (!vqdMatch) return null;
    const vqd = vqdMatch[1];
    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const imgData = await imgRes.json();
    if (imgData.results && imgData.results.length > 0) {
      const imgUrl = imgData.results[0].image;
      imageSearchCache.set(query, imgUrl);
      return imgUrl;
    }
  } catch (err) {
    console.error('Image search error:', err.message);
  }
  return null;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// ── Server ───────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/product-image') {
    const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
    if (!query) return json(res, 400, { error: 'Missing query' });
    const img = await getDDGImage(query);
    if (img) return json(res, 200, { ok: true, img });
    return json(res, 404, { ok: false, error: 'No image found' });
  }

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
