/**
 * Shared product matching + normalization
 * ======================================
 * Single source of truth for turning a raw Zoho Books item into the shape the
 * portal serves, and for matching it to a local product image.
 *
 * Previously this logic was copy-pasted into three files (server.cjs,
 * local-api-server.mjs, api/products.js) — ~180 lines each, kept in sync by
 * hand. The matcher copies were still equivalent when extracted (verified by a
 * 590-case differential test), but the login handler beside them had already
 * drifted and shipped a bug, so the risk was not hypothetical.
 *
 * The image list is injected rather than read here, because each backend
 * discovers images differently: server.cjs reads the directory (and appends to
 * it at runtime when the admin uploads), while the serverless paths use the
 * pre-built product-image-manifest.js.
 *
 * Use createMatcher() to bind an image source once, then call the returned
 * findProductImage(item, overrides) / normalizeItem(item, index, overrides).
 */

export function getCustomField(item, label) {
  return (item.custom_fields ?? []).find(f => f.label === label)?.value ?? null;
}

export function getWholesalePrice(item) {
  const customFields = item.custom_fields ?? [];
  const cf = customFields.find((f) =>
    /wholesale|office\s*price/i.test(f.label ?? '') ||
    /wholesale|office/i.test(f.api_name ?? '')
  );
  if (cf && cf.value != null && cf.value !== '') {
    const parsed = parseFloat(String(cf.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (item.custom_field_hash && typeof item.custom_field_hash === 'object') {
    for (const [k, val] of Object.entries(item.custom_field_hash)) {
      if (/wholesale|office/i.test(k) && val != null && val !== '') {
        const v = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        if (!isNaN(v) && v > 0) return v;
      }
    }
  }
  for (const [k, val] of Object.entries(item)) {
    if (/^(?:cf_)?(?:wholesale|office_price|wholesale_price|wholesale_rate)$/i.test(k) && val != null && val !== '') {
      const v = parseFloat(String(val).replace(/[^0-9.]/g, ''));
      if (!isNaN(v) && v > 0) return v;
    }
  }
  const desc = `${item.description ?? ''} ${item.purchase_description ?? ''}`;
  const match = desc.match(/(?:Office\s+Price|Wholesale\s+Price|Wholesale|Office\s*Price)[^0-9]*(\d+(?:[.,]\d+)?)\s*\$?/i);
  if (match) {
    const parsed = parseFloat(match[1].replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (item.purchase_rate != null && Number(item.purchase_rate) > 0) return Number(item.purchase_rate);
  return null;
}

const VERIFIED_SKU_IMAGES = {
  cbce18: '/assets/product_images/Lention_CB-CE18_Official.webp',
  a83830a1: '/assets/product_images/Anker_555_USB_C_Hub_Official.webp',
  otn9118: '/assets/product_images/Onten_OTN-9118.webp',
  '910006628': '/assets/product_images/Logitech_G_Pro_X_Superlight_2.webp',
};

// Words that describe a product category, colour or feature rather than
// identifying a specific model. Matching one of these is not evidence that two
// products are the same thing: "K400 Plus Wireless Touch Keyboard" and
// "G Pro Keyboard" share only the word "keyboard".
// Specifications that look like model codes because they mix letters and
// digits: 60fps, 1080p, 4K, 100W, USB3, 2M. Treating these as models made the
// "no model in the image, but one in the title" guard fire on almost any
// product with a detailed description — a StreamCam listing whose description
// merely said "60fps" could not match Logitech_StreamCam.webp.
const SPEC_TOKENS =
  // NB: a bare "10m"/"15m" is deliberately NOT listed as a unit — cable length
  // is the model distinction between Logitech's Group 10M and 15M cables.
  /^(?:\d+(?:fps|hz|khz|w|k|v|a|mm|cm|ft|gb|tb|mb|mah|bit|p|gbps|mbps|dpi|in|ch|x)|usb\d*|type\d*|v\d(?:\d)?|\d+x\d+|4k|8k|2k|1080p|1440p|720p|3d|2in1|3in1|4in1|5in1|6in1|7in1|8in1|9in1|10in1|11in1)$/;

const GENERIC_TOKENS = new Set([
  'plus', 'silent', 'pro', 'max', 'mini', 'slim', 'wireless', 'bluetooth',
  'lightspeed', 'dex', 'usb', 'usbc', 'type', 'combo', 'kit', 'set', 'bundle',
  'keyboard', 'mouse', 'headset', 'headphone', 'headphones', 'webcam', 'camera',
  'speaker', 'speakers', 'speakerphone', 'cable', 'hub', 'dock', 'station',
  'adapter', 'charger', 'microphone', 'mic', 'stand', 'mount', 'receiver',
  'black', 'white', 'grey', 'gray', 'graphite', 'silver', 'blue', 'red',
  'wired', 'portable', 'gaming', 'business', 'office', 'stereo', 'multimedia',
]);

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

export function findProductImage(item, { overrides = {}, images = [] } = {}) {
  const itemId = String(item.id || item.item_id || item.zoho_item_id || '');
  if (itemId && overrides[itemId]?.img) return overrides[itemId].img;
  if (item.sku && overrides[item.sku]?.img) return overrides[item.sku].img;

  // Ignore the free-form Zoho Image URL field; it is not model-safe.

  const rawName = (item.name || item.n || '').trim();
  const rawSku = (item.sku || item.s || '').trim();
  const rawDesc = (item.description || item.purchase_description || item.d || '').replace(/\s+/g, ' ').trim();
  const rawBrand = (item.brand || getCustomField(item, 'Brand') || '').trim();
  const skuKey = normalizeString(rawSku).replace(/\s+/g, '');
  if (VERIFIED_SKU_IMAGES[skuKey]) return VERIFIED_SKU_IMAGES[skuKey];

  // Strip price patterns and trailing numbers from text before matching
  const stripPrices = (str) => {
    return (str || '')
      .replace(/(?:office\s+price|wholesale\s+price|retail\s+price|price)\s*[:\(]?\s*\$?\s*\d+(?:[.,]\d+)?\s*\$?\)?\s*[a-z]?/gi, ' ')
      .replace(/\(\s*\d+\s*\$\s*\)/gi, ' ')
      .replace(/\$\s*\d+(?:[.,]\d+)?/gi, ' ');
  };

  const cleanName = stripPrices(rawName);
  const cleanSku = stripPrices(rawSku);
  const cleanDesc = stripPrices(rawDesc);

  // Combine clean product title (excluding barcode from dense number searches)
  const combinedText = [cleanName, cleanSku, cleanDesc, rawBrand]
    .filter(Boolean).join(' ')
    // "Sync 20+" -> "Sync 20 plus", so it can out-score the plain "Sync 20" art.
    .replace(/\+/g, ' plus ');
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

  // Extract explicit standalone model versions (e.g. 2, 3, 3s, 4k, 500, 920, 10m, 15m)
  const titleTokens = titleText.split(/\s+/);
  const titleNumbers = titleTokens.filter(t => /\d/.test(t));

  // The product's own model codes: tokens mixing letters and digits, like m240,
  // k400, mk295, c920, g502, ce18, 10m. A bare number is deliberately excluded —
  // titles are full of incidental numbers (120W, 2M, 8-in-1, pack sizes) that
  // would make this test far too aggressive.
  const titleModelCodes = titleTokens.filter(t =>
    t.length >= 3 && /[a-z]/.test(t) && /\d/.test(t) && !SPEC_TOKENS.test(t));

  let bestFile = null;
  let bestScore = 0;

  for (const file of images) {
    const rawNoExt = file.replace(/\.[^.]+$/, '');
    const parts = rawNoExt.split('_');
    const imgBrand = parts[0].toLowerCase();
    const modelTokens = parts.slice(1).map(p => p.toLowerCase());
    const fullModelName = modelTokens.join(' ');
    const modelDense = fullModelName.replace(/[^a-z0-9]/g, '');

    if (productBrand) {
      const allowedAliases = BRAND_SYNONYMS[productBrand] || [productBrand];
      const isBrandMatch = allowedAliases.some(a => a === imgBrand || BRAND_SYNONYMS[imgBrand]?.includes(a));
      if (!isBrandMatch) continue;
    } else {
      if (!matchesWordExact(titleText, imgBrand)) continue;
    }

    let score = 0;

    // Full dense or word match
    if (modelDense.length >= 3 && titleDense.includes(modelDense)) {
      score += 500 + modelDense.length * 10;
    } else if (fullModelName && matchesWordExact(titleText, fullModelName)) {
      score += 450 + fullModelName.length * 10;
    }

    let matchedDistinctiveTokens = 0;
    let totalDistinctiveTokens = 0;
    // "Strong" tokens are model identifiers (numbers and alphanumeric codes) as
    // opposed to ordinary words. A candidate that shares only ordinary words
    // with the product is not a match, however many of them it shares.
    let strongTokens = 0;
    let strongMatched = 0;
    let mismatchedNumberPenalty = false;

    for (const token of modelTokens) {
      const subTokens = token.split(/[^a-z0-9]/).filter(Boolean);
      for (const st of subTokens) {
        if (st.length === 0) continue;
        const hasDigits = /\d/.test(st);
        const isAlphaOnly = /^[a-z]+$/.test(st);
        const stDense = st.replace(/[^a-z0-9]/g, '');

        if (hasDigits && /[a-z]/.test(st)) {
          // Alpha-numeric model code (e.g. 3s, c920, g502, mk270, 770nc, 10m).
          // These are inherently distinctive, so a dense (punctuation-stripped)
          // match is safe: "MXMaster3S" should still match "MX Master 3S".
          totalDistinctiveTokens++;
          strongTokens++;
          const denseHit = titleDense.includes(stDense) &&
            // Guard against matching a longer, different code: the image's
            // "c270" must not be satisfied by the product's "c270i".
            !titleModelCodes.some(code => code !== st && code.startsWith(st));
          if (matchesWordExact(titleText, st) || denseHit) {
            score += 250 + st.length * 5;
            matchedDistinctiveTokens++;
            strongMatched++;
          } else {
            const numOnly = st.replace(/[^0-9]/g, '');
            if (numOnly.length >= 2 && matchesWordExact(titleText, numOnly)) {
              score += 150 + numOnly.length * 5;
              matchedDistinctiveTokens++;
              strongMatched++;
            } else {
              mismatchedNumberPenalty = true;
            }
          }
        } else if (hasDigits) {
          // Pure number (e.g. 2, 3, 20, 510, 920). These MUST match on a word
          // boundary. The old code also accepted a dense substring hit, which
          // meant the "2" in "G Pro 2" was satisfied by the "2" inside an
          // unrelated "M240" or "MK295" — the single largest source of wrong
          // images, since almost every product code contains some digit.
          totalDistinctiveTokens++;
          strongTokens++;
          if (matchesWordExact(titleText, st)) {
            score += (st.length >= 2 ? 150 : 120) + st.length * 5;
            matchedDistinctiveTokens++;
            strongMatched++;
          } else {
            mismatchedNumberPenalty = true;
          }
        } else if (isAlphaOnly && st.length >= 2 && !GENERIC_TOKENS.has(st) &&
                   // Two-letter tokens count: "MX" is the whole difference
                   // between MX Brio and Brio, and ignoring it let the premium
                   // MX Brio land on plain Brio 101 listings.
                   
                   // A fragment of the brand name is not model evidence: the
                   // "Logi" in Logi_Dock is satisfied by the word "Logitech" in
                   // any Logitech listing, which made that dock a catch-all for
                   // the whole brand (it was landing on Brio webcams).
                   !(imgBrand.startsWith(st) || st.startsWith(imgBrand))) {
          // Weak evidence: a real word that is not a category noun.
          totalDistinctiveTokens++;
          if (matchesWordExact(titleText, st) || titleDense.includes(stDense)) {
            score += 70 + st.length * 3;
            matchedDistinctiveTokens++;
          }
        }
      }
    }

    if (mismatchedNumberPenalty) {
      score = Math.max(0, score - 200);
    }

    // Version disambiguation (Superlight vs Superlight 2, Brio 4K vs Brio 500).
    // Only meaningful when the IMAGE itself names a bare version: otherwise the
    // spec numbers that litter product titles ("USB 3.2", "4 in 1", "6-in-1")
    // penalise every candidate for not containing them, which is what kept the
    // correct Onten UC620 art below the score threshold.
    const imageHasBareVersion = modelTokens.some(mt => /^(?:\d{1,2}|4k|10m|15m)$/.test(mt));
    for (const tn of imageHasBareVersion ? titleNumbers : []) {
      if (['2', '3', '4', '6', '4k', '10m', '15m'].includes(tn)) {
        const imageHasNum = modelTokens.some(mt => mt.includes(tn) || mt.replace(/[^a-z0-9]/g, '') === tn);
        if (imageHasNum) {
          score += 100;
        } else {
          score = Math.max(0, score - 150);
        }
      }
    }

    // Require matching at least 1 distinctive model token to avoid matching brand-only items
    if (totalDistinctiveTokens > 0 && matchedDistinctiveTokens === 0) {
      continue;
    }

    // If the candidate image names a specific model (has numbers or codes in
    // its filename), the product must match at least one of them. Agreeing only
    // on words like "keyboard" or "pro" is how "K400 Plus Touch Keyboard" ended
    // up showing the G Pro keyboard.
    if (strongTokens > 0 && strongMatched === 0) {
      continue;
    }

    // Converse check. If the image names no model at all (e.g. "Logi_Dock",
    // "Lention_USB_C_Hub") but the product does ("M240", "MK295", "CB-C36"),
    // the image cannot be of that product — nothing in it accounts for the
    // model the customer asked for. Without this, model-less filenames act as
    // catch-alls for their whole brand.
    if (strongTokens === 0 && titleModelCodes.length > 0) {
      continue;
    }

    // A product-line name in the image filename must appear in the product
    // title. "Evolve" and "Speak2" are different Jabra lines that happen to
    // share the number 40, and matching on the number alone put a headset on a
    // speakerphone listing. Only reasonably long, non-generic words count, so
    // short prefixes like Onten's "OTN" are unaffected.
    const seriesWords = modelTokens
      .flatMap(t => t.split(/[^a-z0-9]/))
      .filter(t => t.length >= 5 && /^[a-z]+$/.test(t) && !GENERIC_TOKENS.has(t));
    if (seriesWords.some(w => !matchesWordExact(titleText, w) && !titleDense.includes(w))) {
      continue;
    }

    if (totalDistinctiveTokens > 0 && matchedDistinctiveTokens === totalDistinctiveTokens) {
      score += 200;
    } else if (totalDistinctiveTokens > 1 && matchedDistinctiveTokens < totalDistinctiveTokens) {
      score = Math.max(0, score - 80);
    }

    if (score >= 120 && score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile ? `/assets/product_images/${bestFile}` : null;
}

export function normalizeItem(item, index, { overrides = {}, images = [] } = {}) {
  const wholesalePrice = getWholesalePrice(item);
  const matchedImage = findProductImage(item, { overrides, images });
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

  const stockVal = ov.stock !== undefined ? Number(ov.stock) : (stockOnHand ?? item.stock ?? 0);
  const inStockVal = ov.k !== undefined ? Boolean(ov.k) : (ov.stock !== undefined ? stockVal > 0 : (stockOnHand === null || stockOnHand > 0 || Boolean(item.in_stock || item.k)));
  const wholesaleVal = ov.p !== undefined ? (ov.p === null ? null : Number(ov.p)) : (wholesalePrice ?? (item.p != null ? Number(item.p) : (item.wholesale_price != null ? Number(item.wholesale_price) : null)));
  const retailVal = ov.retail !== undefined ? (ov.retail === null ? null : Number(ov.retail)) : Number(item.rate ?? item.retail ?? item.price ?? 0);
  const nameVal = ov.n != null ? ov.n : modelName;
  const descVal = ov.d != null ? ov.d : rawDesc;
  const brandVal = ov.brand != null ? ov.brand : ((getCustomField(item, 'Brand') || item.brand) ?? '');
  const categoryVal = ov.category != null ? ov.category : (item.product_type ?? item.category ?? 'Accessories');
  const skuVal = ov.s != null ? ov.s : (ov.sku != null ? ov.sku : rawSku);
  const barcodeVal = ov.barcode != null ? ov.barcode : barcode;
  const imgList = ov.img !== undefined ? (ov.img ? [ov.img] : []) : (matchedImage ? [matchedImage] : []);
  const imgVal = imgList[0] || null;

  return {
    id: itemId,
    zoho_item_id: itemId,
    n: nameVal,
    name: nameVal,
    sku: skuVal,
    s: skuVal,
    barcode: barcodeVal,
    d: descVal,
    description: descVal,
    price: retailVal,
    retail: retailVal,
    wholesale_price: wholesaleVal,
    p: wholesaleVal,
    category: categoryVal,
    brand: brandVal,
    images: imgList,
    img: imgVal,
    featured: getCustomField(item, 'Featured')?.toLowerCase() === 'true',
    order_index: index,
    stock_on_hand: stockVal,
    stock: stockVal,
    in_stock: inStockVal,
    k: inStockVal,
  };
}

/**
 * Bind an image source once and get back call-site-compatible helpers.
 * `imagesSource` may be an array or a function returning one — pass a function
 * (or a stable array reference) when the list can grow at runtime.
 */
export function createMatcher(imagesSource) {
  const images = () => (typeof imagesSource === 'function' ? imagesSource() : imagesSource) || [];
  return {
    findProductImage: (item, overrides = {}) => findProductImage(item, { overrides, images: images() }),
    normalizeItem: (item, index, overrides = {}) => normalizeItem(item, index, { overrides, images: images() }),
    getCustomField,
    getWholesalePrice,
  };
}
