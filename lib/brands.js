/**
 * Brand detection
 * ===============
 * Single source of truth for "which brand is this product?", shared by the
 * catalog's filter chips and the Excel export so the two always agree.
 *
 * Zoho carries no brand for any item — the field is empty on all 1,132 — so the
 * brand has to be read out of the product name, SKU or description.
 *
 * This replaces an earlier version in Catalog.jsx that knew only 7 brands and,
 * after its word-boundary test failed, fell back to a raw substring check. That
 * fallback made the Ultimate Ears alias "ue" match the "ue" inside "bluetooth",
 * filing 49 JBL, Poly, Jabra, AKG and Apple products under Logitech. Matching
 * here is word-boundary only, and aliases shorter than three characters are not
 * accepted at all.
 */

/**
 * Ordered brand list. Aliases include sub-brands and former names, so
 * Plantronics resolves to Poly and Logi/Logitech G to Logitech rather than
 * competing with them.
 *
 * Selection is by earliest mention in the product name (see detectBrand); a
 * longer alias only breaks a tie at the same position, so "Logitech G" beats
 * "Logitech" where both start the name.
 */
export const BRANDS = [
  { name: 'Logitech',    aliases: ['logitech', 'logitech g', 'logi', 'ultimate ears', 'astro gaming'] },
  { name: 'Onten',       aliases: ['onten', 'otn'] },
  { name: 'Lention',     aliases: ['lention'] },
  { name: 'Poly',        aliases: ['poly', 'plantronics', 'polycom', 'blackwire', 'voyager focus'] },
  { name: 'Jabra',       aliases: ['jabra'] },
  { name: 'JBL',         aliases: ['jbl'] },
  { name: 'Anker',       aliases: ['anker', 'soundcore', 'eufy', 'nebula', 'powerconf'] },
  { name: 'UGREEN',      aliases: ['ugreen'] },
  { name: 'Samsung',     aliases: ['samsung'] },
  { name: 'Dell',        aliases: ['dell', 'alienware'] },
  { name: 'HP',          aliases: ['hewlett packard', 'hp inc'] },
  { name: 'Lenovo',      aliases: ['lenovo', 'thinkpad'] },
  { name: 'Microsoft',   aliases: ['microsoft', 'xbox'] },
  { name: 'Apple',       aliases: ['apple', 'macbook', 'imac', 'airpods'] },
  { name: 'Asus',        aliases: ['asus', 'rog'] },
  { name: 'Acer',        aliases: ['acer', 'predator'] },
  { name: 'Elgato',      aliases: ['elgato'] },
  { name: 'Razer',       aliases: ['razer'] },
  { name: 'SteelSeries', aliases: ['steelseries'] },
  { name: 'SanDisk',     aliases: ['sandisk'] },
  { name: 'Kingston',    aliases: ['kingston', 'hyperx'] },
  { name: 'Vention',     aliases: ['vention'] },
  { name: 'Amalink',     aliases: ['amalink'] },
  { name: 'Rapoo',       aliases: ['rapoo'] },
  { name: 'Edifier',     aliases: ['edifier'] },
  { name: 'Maono',       aliases: ['maono'] },
  { name: 'EZASHY',      aliases: ['ezashy'] },
  { name: 'Niye',        aliases: ['niye'] },
  { name: 'LB-LINK',     aliases: ['lb-link', 'lblink', 'lb link'] },
  { name: 'Hotron',      aliases: ['hotron'] },
  { name: 'Aigo',        aliases: ['aigo'] },
  { name: 'Canon',       aliases: ['canon'] },
  { name: 'Beats',       aliases: ['beats'] },
  { name: 'AKG',         aliases: ['akg'] },
  { name: 'Blue',        aliases: ['blue yeti', 'blue snowball', 'blue microphones'] },
  { name: 'ZKTeco',      aliases: ['zkteco'] },
  { name: 'Ubiquiti',    aliases: ['ubiquiti', 'unifi'] },
  { name: 'Snowman',     aliases: ['snowman'] },
  { name: 'Ceamere',     aliases: ['ceamere'] },
  { name: 'DM',          aliases: ['dm '] },
];

/** Products with no recognisable brand are collected here. */
export const OTHER_BRAND = 'Other';

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * Index of a whole-word alias occurrence, or -1. Never a bare substring — see
 * the header note.
 */
function aliasIndex(haystack, alias) {
  const a = String(alias).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (a.length < 3) return -1;
  return haystack.indexOf(` ${a} `);
}

/**
 * Best brand for an item, or null.
 *
 * The name and SKU are searched first and only then the description, so a
 * product whose blurb mentions a compatible brand ("works with Logitech
 * Unifying") is still filed under its own.
 */
export function detectBrand(item) {
  if (!item) return null;
  const declared = String(item.brand || '').trim();
  if (declared) {
    const known = BRANDS.find(b => b.name.toLowerCase() === declared.toLowerCase()
      || b.aliases.some(a => a.trim() === declared.toLowerCase()));
    return known ? known.name : declared;
  }

  const primary = norm(`${item.n || item.name || ''} ${item.s || item.sku || ''}`);
  const secondary = norm(item.d || item.description || '');

  for (const haystack of [primary, secondary]) {
    let best = null;
    let bestPos = Infinity;
    let bestLen = 0;
    for (const brand of BRANDS) {
      for (const alias of brand.aliases) {
        const at = aliasIndex(haystack, alias);
        if (at === -1) continue;
        const len = alias.trim().length;
        // Earliest mention wins: the maker leads the product name, while other
        // brands appear later as compatibility or certification claims — which
        // is why "Poly Sync 20+ Microsoft Teams" is a Poly product, not a
        // Microsoft one. A longer alias only breaks a tie at the same position.
        if (at < bestPos || (at === bestPos && len > bestLen)) {
          best = brand.name;
          bestPos = at;
          bestLen = len;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** True when `item` belongs to `brandName` ('' matches everything). */
export function matchesBrand(item, brandName) {
  if (!brandName) return true;
  const detected = detectBrand(item);
  if (brandName === OTHER_BRAND) return detected === null;
  return (detected || '').toLowerCase() === String(brandName).toLowerCase();
}

/**
 * Group items by brand, largest group first, with "Other" last so the
 * unclassified tail does not interrupt the real brands.
 */
export function groupByBrand(items) {
  const groups = new Map();
  for (const item of items || []) {
    const brand = detectBrand(item) || OTHER_BRAND;
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(item);
  }
  const other = groups.get(OTHER_BRAND) || [];
  groups.delete(OTHER_BRAND);
  const sorted = [...groups.entries()]
    .map(([brand, list]) => ({ brand, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));
  if (other.length) sorted.push({ brand: OTHER_BRAND, items: other });
  return sorted;
}

/** Brand names present in a set of items, for the catalog's filter chips. */
export function brandsPresent(items) {
  return groupByBrand(items).map(g => g.brand).filter(b => b !== OTHER_BRAND);
}
