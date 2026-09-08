/**
 * Applying an admin edit to the overrides map
 * ===========================================
 * Single source of truth for what "save this item" means, shared by the route
 * in server.cjs and the Vercel function in api/admin/override.js so the two
 * cannot drift — the same reason lib/product-matching.js and lib/brands.js
 * exist.
 *
 * Three states per field, and they are all different:
 *   undefined  the panel did not send it   -> leave whatever is stored
 *   null       the panel cleared it        -> drop the override, fall back to Zoho
 *   a value    the panel set it            -> store it
 *
 * The panel sends some fields under two names because the catalogue is served
 * in a short form (n/p/s/d/k) and the admin screen was written against the long
 * one (name/wholesale_price/sku/description/in_stock). Both are accepted.
 */

/** Mutates `overrides` and returns the entry for `itemId`, or null once empty. */
export function applyOverrideEdit(overrides, data) {
  const {
    itemId, n, p, wholesale_price, retail, price, stock, quantity,
    k, in_stock, d, description, brand, category, sku, s, barcode, img,
  } = data;
  if (!itemId) throw new Error('itemId required');

  if (!overrides[itemId]) overrides[itemId] = {};
  const entry = overrides[itemId];

  const pick = (a, b) => (a !== undefined ? a : b);
  const num = (v) => (v === null ? null : v !== undefined ? Number(v) : undefined);

  const set = (field, value) => {
    if (value === null) delete entry[field];
    else if (value !== undefined) entry[field] = value;
  };

  const finalK = pick(k, in_stock);
  set('n', n);
  set('p', num(pick(p, wholesale_price)));
  set('retail', num(pick(retail, price)));
  set('stock', num(pick(stock, quantity)));
  set('k', finalK === null ? null : finalK !== undefined ? Boolean(finalK) : undefined);
  set('d', pick(d, description));
  set('brand', brand);
  set('category', category);
  set('s', pick(s, sku));
  set('barcode', barcode);
  set('img', img);

  // An entry with nothing left in it is not "an override that sets nothing" —
  // it is the absence of an override, and must not shadow the Zoho record.
  if (Object.keys(entry).length === 0) {
    delete overrides[itemId];
    return null;
  }
  return entry;
}
