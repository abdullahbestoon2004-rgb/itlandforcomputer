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
  "Anker_555_USB_C_Hub.jpg", "Anker_PowerExpand_7-in-1.jpg", "DM_USB_Flash_Drive.jpg", "Dell_WD19S_Dock.jpg",
  "Elgato_Stream_Deck_MK2.jpg", "JBL_Flip_6.jpeg", "JBL_Tune_770NC.jpg", "Jabra_Evolve2_65.jpg",
  "Jabra_Evolve_40.jpg", "Jabra_Speak2_75.jpg", "Jabra_Speak_510.jpg", "Jabra_Speak_510_UC.jpeg",
  "Lention_CB-CE18.jpg", "Lention_USB_C_Hub.jpg", "Logitech_B100.png", "Logitech_B220_Silent.jpg",
  "Logitech_B330_Silent_Plus.jpg", "Logitech_BCC950.png", "Logitech_Blue_Snowball.png", "Logitech_Blue_Yeti.jpg",
  "Logitech_Brio_100.png", "Logitech_Brio_300.png", "Logitech_Brio_301.jpg", "Logitech_Brio_305.webp",
  "Logitech_Brio_4K.png", "Logitech_Brio_500.png", "Logitech_C270.jpg", "Logitech_C310.jpg",
  "Logitech_C505.png", "Logitech_C615.jpg", "Logitech_C920_PRO.png", "Logitech_C922.png",
  "Logitech_C925e.jpg", "Logitech_C930e.webp", "Logitech_ConferenceCam_Connect.jpg", "Logitech_Craft.jpg",
  "Logitech_Desk_Mat.jpg", "Logitech_Driving_Force_Shifter.png", "Logitech_Flight_Panels_Bundle.jpg",
  "Logitech_Flight_Radio_Panel.jpg", "Logitech_G213.png", "Logitech_G29.jpeg", "Logitech_G300s.jpeg",
  "Logitech_G305.png", "Logitech_G309.png", "Logitech_G413_TKL.png", "Logitech_G435.png",
  "Logitech_G502_Lightspeed.jpg", "Logitech_G513.png", "Logitech_G515_TKL.jpg", "Logitech_G633.jpg",
  "Logitech_G635.jpg", "Logitech_G733.png", "Logitech_G840_XL.jpg", "Logitech_G915_TKL.jpg",
  "Logitech_G920.png", "Logitech_G923.png", "Logitech_G933.jpg", "Logitech_G933S.jpg",
  "Logitech_G_Pro_2_Lightspeed.png", "Logitech_G_Pro_Keyboard.png", "Logitech_G_Pro_Wired.jpg",
  "Logitech_G_Pro_Wireless.png", "Logitech_G_Pro_X_2.jpeg", "Logitech_G_Pro_X_Superlight.jpeg",
  "Logitech_G_Pro_X_Superlight_2_DEX.png", "Logitech_H110.jpeg", "Logitech_H111.png", "Logitech_H151.png",
  "Logitech_H340.jpg", "Logitech_H570e.png", "Logitech_K120.jpg", "Logitech_K375s.jpg",
  "Logitech_K380.png", "Logitech_K480.jpg", "Logitech_K580.jpg", "Logitech_K780.png",
  "Logitech_Keys-To-Go_2.png", "Logitech_Lift_Vertical.png", "Logitech_Line_Friends_Mouse.jpg",
  "Logitech_Litra_Beam.png", "Logitech_Litra_Glow.png", "Logitech_Logi_Dock.jpg", "Logitech_M170.jpg",
  "Logitech_M171.jpg", "Logitech_M185.png", "Logitech_M196_Bluetooth_Mouse.jpg", "Logitech_M235.jpg",
  "Logitech_M317.png", "Logitech_M330_Silent_Plus.png", "Logitech_M705.png", "Logitech_MK120.png",
  "Logitech_MK270.jpg", "Logitech_MK470.png", "Logitech_MK710.jpg", "Logitech_MK850.png",
  "Logitech_MX_Anywhere_3S.png", "Logitech_MX_Brio.png", "Logitech_MX_Brio_4K.png", "Logitech_MX_Brio_705.jpg",
  "Logitech_MX_Creative_Console.png", "Logitech_MX_Keys_Business.jpg", "Logitech_MX_Keys_Combo_Gen2.jpg",
  "Logitech_MX_Keys_Mini.png", "Logitech_MX_Keys_S.jpg", "Logitech_MX_Master_3S.jpg", "Logitech_MX_Master_4.png",
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
  "Onten_OTN-7598.png", "Onten_OTN-8120.jpg", "Onten_OTN-9118.jpg", "Onten_OTN-9175K.webp",
  "Onten_OTN-9199A.webp", "Onten_OTN-9299.jpg", "Onten_OTN-9399.webp", "Onten_OTN-9591A.webp",
  "Onten_OTN-9598.jpg", "Onten_OTN-CS21.jpg", "Onten_OTN-CS341.jpg", "Onten_OTN-MS661_Plus.jpg",
  "Onten_OTN-UC101.jpg", "Onten_OTN-UC302.jpg", "Onten_OTN-UC601.jpg", "Onten_OTN-UC602.jpg",
  "Onten_OTN-UC620.jpg", "Onten_OTN-UCA9702.webp", "Onten_OTN-UCD22.jpg", "Onten_USB-C_0.2M.jpg",
  "Plantronics_Blackwire_C3200.jpg", "Plantronics_Voyager_4210_UC.jpg", "Poly_Blackwire_3310.jpg",
  "Poly_Blackwire_C3210.webp", "Poly_Sync_20.jpg", "Poly_Sync_20_Plus.jpg", "Poly_Voyager_4310.jpg",
  "Poly_Voyager_4320_UC.webp", "Poly_Voyager_Focus_2.jpg", "Razer_DeathAdder.jpg", "Samsung_T7_Shield.jpg",
  "SanDisk_Extreme_Portable_SSD.jpg", "UGREEN_USB_C_Hub.png", "Vention_HDMI_Cable.jpg"
];

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

function findProductImage(item, overrides = {}) {
  // 1. Direct Item Override
  const itemId = String(item.id || item.item_id || item.zoho_item_id || '');
  if (itemId && overrides[itemId]?.img) {
    return overrides[itemId].img;
  }
  if (item.sku && overrides[item.sku]?.img) {
    return overrides[item.sku].img;
  }

  // 2. Custom field in Zoho
  const customImg = getCustomField(item, 'Image URL');
  if (customImg && typeof customImg === 'string' && customImg.startsWith('http')) return customImg;

  const rawName = (item.name || item.n || '').trim();
  const rawSku = (item.sku || item.s || '').trim();
  const rawDesc = (item.description || item.purchase_description || item.d || '').replace(/\s+/g, ' ').trim();
  const rawBrand = (item.brand || getCustomField(item, 'Brand') || '').trim();

  // Combine Name, SKU, Description, Purchase Description, Barcode to catch Zoho titles
  const combinedText = [rawName, rawSku, rawDesc, rawBrand, item.barcode].filter(Boolean).join(' ');
  const titleText = normalizeString(combinedText);
  const titleDense = combinedText.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Determine Product Brand
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

  for (const file of LOCAL_IMAGES) {
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

        // Alpha-numeric code (e.g. "c920", "g502", "mk270", "otn5138", "3s")
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

    // Must exceed confidence threshold
    if (score >= 100 && score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile ? `/assets/product_images/${bestFile}` : null;
}

function normalizeItem(item, index, overrides = {}) {
  const wholesalePrice = getWholesalePrice(item);
  const matchedImage = findProductImage(item, overrides);
  const stockOnHand = item.stock_on_hand != null ? Number(item.stock_on_hand) : (item.available_stock != null ? Number(item.available_stock) : null);
  const customBarcode = getCustomField(item, 'Barcode') || getCustomField(item, 'UPC') || getCustomField(item, 'EAN');

  const rawName = (item.name ?? '').trim();
  const rawSku = (item.sku ?? '').trim();
  const rawDesc = (item.purchase_description || item.description || '').replace(/\s+/g, ' ').trim();
  const isNameDigits = /^\d+$/.test(rawName);

  // Extract clean title from description if name is just barcode/digits
  let nameFromDesc = rawDesc
    .replace(/\s+\d{3,}-\d{4,}.*$/, '')
    .replace(/\s+Office\s+Price.*$/i, '')
    .replace(/\s+Wholesale\s+Price.*$/i, '')
    .replace(/\s+Price\s+\d.*$/i, '')
    .trim();

  const modelName = (isNameDigits || !rawName) ? (nameFromDesc || rawSku || rawName) : rawName;
  const barcode = customBarcode || (isNameDigits ? rawName : (rawSku || rawName));
  const itemId = String(item.id || item.item_id || item.zoho_item_id || index + 1);

  // Apply admin overrides if present
  const ov = overrides[itemId] || {};
  const fallbackImgList = Array.isArray(item.images) && item.images.length > 0 ? item.images : (item.img ? [item.img] : []);

  return {
    id: itemId,
    zoho_item_id: itemId,
    name: ov.n != null ? ov.n : modelName,
    sku: rawSku,
    barcode: barcode,
    description: rawDesc,
    price: Number(item.rate ?? item.price ?? 0),
    wholesale_price: ov.p !== undefined ? ov.p : wholesalePrice,
    category: item.product_type ?? item.category ?? 'Accessories',
    brand: (getCustomField(item, 'Brand') || item.brand) ?? '',
    images: ov.img !== undefined ? (ov.img ? [ov.img] : []) : (matchedImage ? [matchedImage] : fallbackImgList),
    featured: getCustomField(item, 'Featured')?.toLowerCase() === 'true',
    order_index: index,
    stock_on_hand: stockOnHand ?? item.stock ?? null,
    in_stock: stockOnHand === null || stockOnHand > 0 || Boolean(item.in_stock || item.k),
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

const FALLBACK_PRODUCTS = [
  {
    id: "1", zoho_item_id: "1", name: "Logitech MX Master 3S Wireless Mouse",
    sku: "910-006557", barcode: "097855174574", brand: "Logitech", category: "Mouse",
    price: 99.99, wholesale_price: 79.99, in_stock: true, stock_on_hand: 25,
    description: "Quiet Click wireless performance mouse with 8K DPI tracking and ergonomic design.",
    images: ["/assets/product_images/Logitech_MX_Master_3S.jpg"]
  },
  {
    id: "2", zoho_item_id: "2", name: "Logitech MX Keys S Wireless Keyboard",
    sku: "920-011558", barcode: "097855174581", brand: "Logitech", category: "Keyboard",
    price: 119.99, wholesale_price: 94.99, in_stock: true, stock_on_hand: 18,
    description: "Fluid typing illuminated keyboard with Smart Actions and USB-C fast charging.",
    images: ["/assets/product_images/Logitech_MX_Keys_S.jpg"]
  },
  {
    id: "3", zoho_item_id: "3", name: "Anker 555 USB-C Hub 8-in-1 PowerExpand",
    sku: "A83830A1", barcode: "194644023456", brand: "Anker", category: "Adapter / Hub",
    price: 69.99, wholesale_price: 49.99, in_stock: true, stock_on_hand: 40,
    description: "Multiport adapter with 100W Power Delivery, 4K HDMI, Ethernet, and SD card reader.",
    images: ["/assets/product_images/Anker_555_USB_C_Hub.jpg"]
  },
  {
    id: "4", zoho_item_id: "4", name: "Poly Voyager Focus 2 UC Headset",
    sku: "213726-01", barcode: "017229172455", brand: "Poly", category: "Headset",
    price: 249.99, wholesale_price: 199.99, in_stock: true, stock_on_hand: 12,
    description: "Stereo Bluetooth headset with active noise canceling (ANC) and smart sensors.",
    images: ["/assets/product_images/Poly_Voyager_Focus_2.jpg"]
  },
  {
    id: "5", zoho_item_id: "5", name: "Jabra Evolve2 65 Wireless Headset",
    sku: "26599-989-999", barcode: "5706991022835", brand: "Jabra", category: "Headset",
    price: 219.99, wholesale_price: 175.00, in_stock: true, stock_on_hand: 15,
    description: "Professional wireless headset engineered to keep you focused with noise isolating foam.",
    images: ["/assets/product_images/Jabra_Evolve2_65.jpg"]
  },
  {
    id: "6", zoho_item_id: "6", name: "JBL Flip 6 Portable Waterproof Speaker",
    sku: "JBLFLIP6BLKAM", barcode: "050036387063", brand: "JBL", category: "Speakers",
    price: 129.95, wholesale_price: 98.50, in_stock: true, stock_on_hand: 30,
    description: "Powerful 2-way speaker system delivering loud, crystal clear, powerful sound.",
    images: ["/assets/product_images/JBL_Flip_6.jpeg"]
  },
  {
    id: "7", zoho_item_id: "7", name: "Logitech Brio 4K Ultra HD Webcam",
    sku: "960-001105", barcode: "097855125439", brand: "Logitech", category: "Video Conference",
    price: 199.99, wholesale_price: 155.00, in_stock: true, stock_on_hand: 10,
    description: "Premium 4K webcam with HDR and Windows Hello support for professional video calls.",
    images: ["/assets/product_images/Logitech_Brio_4K.png"]
  },
  {
    id: "8", zoho_item_id: "8", name: "Onten 9118 USB-C Multiport Docking Station",
    sku: "OTN-9118", barcode: "6956328391181", brand: "Onten", category: "Adapter / Hub",
    price: 45.00, wholesale_price: 32.00, in_stock: true, stock_on_hand: 50,
    description: "Aluminum 11-in-1 USB-C dock with dual HDMI, VGA, RJ45 Gigabit Ethernet and USB 3.0 ports.",
    images: ["/assets/product_images/Onten_OTN-9118.jpg"]
  },
  {
    id: "9", zoho_item_id: "9", name: "Lention USB-C Hub with 4K HDMI",
    sku: "CB-CE18", barcode: "6970420180123", brand: "Lention", category: "Adapter / Hub",
    price: 35.00, wholesale_price: 24.50, in_stock: true, stock_on_hand: 45,
    description: "Compact Type-C adapter with 4K HDMI output, 3 USB 3.0 ports, and Power Delivery.",
    images: ["/assets/product_images/Lention_USB_C_Hub.jpg"]
  },
  {
    id: "10", zoho_item_id: "10", name: "Logitech G Pro X Superlight 2 Wireless Gaming Mouse",
    sku: "910-006628", barcode: "097855184511", brand: "Logitech", category: "Mouse",
    price: 159.99, wholesale_price: 129.99, in_stock: true, stock_on_hand: 20,
    description: "Next-gen 60g ultralight esports mouse with LIGHTFORCE hybrid switches and HERO 2 sensor.",
    images: ["/assets/product_images/Logitech_G_Pro_X_Superlight_2_DEX.png"]
  },
  {
    id: "11", zoho_item_id: "11", name: "Poly Sync 20 Plus Bluetooth Speakerphone",
    sku: "216867-01", barcode: "017229171236", brand: "Poly", category: "Video Conference",
    price: 179.99, wholesale_price: 139.00, in_stock: true, stock_on_hand: 16,
    description: "Smart speakerphone for conference calls and music with multi-microphone steerable array.",
    images: ["/assets/product_images/Poly_Sync_20_Plus.jpg"]
  },
  {
    id: "12", zoho_item_id: "12", name: "Elgato Stream Deck MK.2",
    sku: "10GAA9901", barcode: "840006637400", brand: "Elgato", category: "Streaming",
    price: 149.99, wholesale_price: 119.00, in_stock: true, stock_on_hand: 22,
    description: "15 customizable LCD keys to control apps, tools, and platforms with tactile feedback.",
    images: ["/assets/product_images/Elgato_Stream_Deck_MK2.jpg"]
  },
  {
    id: "13", zoho_item_id: "13", name: "JBL Tune 770NC Wireless Over-Ear Headphones",
    sku: "JBLT770NCBLU", barcode: "050036394511", brand: "JBL", category: "Headset",
    price: 129.95, wholesale_price: 89.00, in_stock: true, stock_on_hand: 28,
    description: "Adaptive Noise Cancelling wireless headphones with JBL Pure Bass Sound and 70H battery life.",
    images: ["/assets/product_images/JBL_Tune_770NC.jpg"]
  },
  {
    id: "14", zoho_item_id: "14", name: "Samsung T7 Shield 1TB Portable SSD",
    sku: "MU-PE1T0S/AM", barcode: "887276633856", brand: "Samsung", category: "Adapter / Hub",
    price: 134.99, wholesale_price: 99.00, in_stock: true, stock_on_hand: 35,
    description: "Rugged external solid state drive with IP65 dust and water resistance and USB 3.2 Gen 2.",
    images: ["/assets/product_images/Samsung_T7_Shield.jpg"]
  }
];

  let overrides = {};
  try {
    const fs = await import('fs');
    const path = await import('path');
    const overridesPath = path.join(process.cwd(), 'overrides.json');
    if (fs.existsSync(overridesPath)) {
      overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    }
  } catch {}

  const orgId = process.env.ZOHO_ORG_ID;
  if (!orgId || !process.env.ZOHO_REFRESH_TOKEN) {
    return res.status(200).json({ products: FALLBACK_PRODUCTS.map((p, i) => normalizeItem(p, i, overrides)) });
  }

  try {
    if (cachedProducts && Date.now() < productsExpiresAt) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ products: cachedProducts });
    }

    const token = await getAccessToken();
    const items = await fetchAllItems(token, orgId);
    const products = items.map((item, i) => normalizeItem(item, i, overrides));

    cachedProducts = products.length > 0 ? products : FALLBACK_PRODUCTS;
    productsExpiresAt = Date.now() + PRODUCTS_TTL_MS;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ products: cachedProducts });
  } catch (err) {
    console.error('api/products error:', err);
    return res.status(200).json({ products: FALLBACK_PRODUCTS.map((p, i) => normalizeItem(p, i, overrides)) });
  }
}
