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

function getWholesalePrice(item) {
  // 1. Custom fields matching Wholesale / Office Price
  const customFields = item.custom_fields ?? [];
  const cf = customFields.find((f) =>
    /wholesale|office\s*price/i.test(f.label ?? '') ||
    /wholesale|office/i.test(f.api_name ?? '')
  );
  if (cf && cf.value != null && cf.value !== '') {
    const parsed = parseFloat(String(cf.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 2. Regex in description or purchase description ("Office Price 15.5$" or "Wholesale Price 20$")
  const desc = `${item.description ?? ''} ${item.purchase_description ?? ''}`;
  const match = desc.match(/(?:Office\s+Price|Wholesale\s+Price|Wholesale|Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
  if (match) {
    const parsed = parseFloat(match[1].replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 3. Fallback to rate (item price in Zoho Books)
  if (item.rate != null && Number(item.rate) > 0) {
    return Number(item.rate);
  }

  // 4. Fallback to purchase_rate
  if (item.purchase_rate != null && Number(item.purchase_rate) > 0) {
    return Number(item.purchase_rate);
  }

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
  if (customImg && customImg.startsWith('http')) return customImg;

  const rawName = (item.name ?? '').trim();
  const rawSku = (item.sku ?? '').trim();
  const rawDesc = `${item.description ?? ''} ${item.purchase_description ?? ''}`.trim();

  const text = `${rawName} ${rawSku} ${rawDesc}`.toLowerCase();
  const words = new Set(text.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 0));

  let bestFile = null;
  let bestScore = 0;

  for (const file of LOCAL_IMAGES) {
    const tokens = file.replace(/\.[^.]+$/, '').split(/[_\-]/).map(t => t.toLowerCase()).filter(t => t.length > 1);
    const matched = tokens.filter(t => words.has(t)).length;
    if (matched > 0 && matched > bestScore) {
      bestScore = matched;
      bestFile = file;
    }
  }

  if (!bestFile || bestScore < 1) {
    for (const file of LOCAL_IMAGES) {
      const modelToken = file.replace(/\.[^.]+$/, '').split(/[_\-]/).find(t => t.length >= 3 && /\d/.test(t));
      if (modelToken && words.has(modelToken.toLowerCase())) {
        bestFile = file;
        break;
      }
    }
  }

  return bestFile ? `/assets/product_images/${bestFile}` : PLACEHOLDER_IMAGE;
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
    images: [matchedImage],
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
