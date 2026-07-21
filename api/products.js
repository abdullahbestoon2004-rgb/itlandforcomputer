const ZOHO_AUTH_DOMAIN = process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN ?? 'https://www.zohoapis.com';
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?q=80&w=600&auto=format&fit=crop';
const PER_PAGE = 200;

// ── Module-level caches (survive across requests on warm instances) ──
let cachedToken = null;
let tokenExpiresAt = 0;

let cachedProducts = null;
let productsExpiresAt = 0;
const PRODUCTS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID || '1000.06T75SSOK56I52CL0GHJL45YVSG7DK',
      client_secret: process.env.ZOHO_CLIENT_SECRET || '783ace0cbad1786e5b0fd1834c72e63668c59978fb',
      grant_type: 'refresh_token',
    }).toString(),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return cachedToken;
}

async function fetchPage(accessToken, orgId, page) {
  const url = `${ZOHO_API_DOMAIN}/books/v3/items?organization_id=${orgId}&page=${page}&per_page=${PER_PAGE}&status=active`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Zoho API error: HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Zoho error: ${data.message}`);
  return data;
}

const BATCH_SIZE = 5; // fetch 5 pages at a time in parallel

async function fetchAllItems(accessToken, orgId) {
  const first = await fetchPage(accessToken, orgId, 1);
  const items = [...(first.items ?? [])];
  if (!first.page_context?.has_more_page) return items;

  let nextPage = 2;
  while (true) {
    const batch = await Promise.all(
      Array.from({ length: BATCH_SIZE }, (_, i) => fetchPage(accessToken, orgId, nextPage + i))
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
  return (item.custom_fields ?? []).find((f) => f.label === label)?.value ?? null;
}

function normalizeItem(item, index) {
  const wholesaleRaw = getCustomField(item, 'Wholesale Price');
  const wholesalePrice = wholesaleRaw != null ? parseFloat(String(wholesaleRaw).replace(/[^0-9.]/g, '')) : null;

  const imageUrl = getCustomField(item, 'Image URL');
  const stockOnHand = item.stock_on_hand != null ? Number(item.stock_on_hand) : null;
  const barcode = getCustomField(item, 'Barcode') || getCustomField(item, 'UPC') || getCustomField(item, 'EAN') || item.name || '';

  return {
    id: String(item.item_id),
    zoho_item_id: String(item.item_id),
    name: item.name ?? '',
    sku: item.sku ?? '',
    barcode: barcode,
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

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const orgId = process.env.ZOHO_ORG_ID;
  if (!orgId) return res.status(500).json({ error: 'ZOHO_ORG_ID is not set' });
  if (!process.env.ZOHO_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'ZOHO_REFRESH_TOKEN is not set.' });
  }

  try {
    if (cachedProducts && Date.now() < productsExpiresAt) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ products: cachedProducts });
    }

    const token = await getAccessToken();
    const items = await fetchAllItems(token, orgId);
    const products = items.map((item, i) => normalizeItem(item, i));

    cachedProducts = products;
    productsExpiresAt = Date.now() + PRODUCTS_TTL_MS;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ products });
  } catch (err) {
    console.error('api/products error:', err);
    return res.status(500).json({ error: err.message });
  }
}
