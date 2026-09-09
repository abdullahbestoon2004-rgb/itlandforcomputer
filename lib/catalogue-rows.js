/**
 * Catalogue rows
 * ==============
 * The shaping step every export shares: keep the brands that were asked for,
 * group the products, and flatten each one to the same fields.
 *
 * It exists because there are now three exports (Excel, Google Sheets, PDF)
 * built by three different serialisers. Without a common source of rows they
 * drift: a price rounded in one, a status worded differently in another, and a
 * customer comparing two downloads of the same catalogue finds they disagree.
 */
import { groupByBrand } from './brands.js';

/**
 * Canonical column order. `money` marks the two price columns, which each
 * format renders its own way — Excel as a currency number, CSV as a bare
 * number so Sheets keeps it numeric, the print page as a formatted string.
 */
export const COLUMNS = [
  { header: 'Image',       key: 'img',       width: 11 },
  { header: 'Product',     key: 'name',      width: 52 },
  { header: 'Code / SKU',  key: 'sku',       width: 20 },
  { header: 'Barcode',     key: 'barcode',   width: 18 },
  { header: 'Wholesale',   key: 'wholesale', width: 13, money: true },
  { header: 'Retail',      key: 'retail',    width: 13, money: true },
  { header: 'Stock',       key: 'stock',     width: 9 },
  { header: 'Status',      key: 'status',    width: 12 },
  { header: 'Category',    key: 'category',  width: 20 },
  { header: 'Description', key: 'desc',      width: 60 },
];

/**
 * Brand groups for an export.
 *
 * @param items   in-stock products, already filtered
 * @param brands  brand names to include; omit or empty for all
 * @returns { groups, included, scope }
 */
export function selectGroups(items, brands) {
  let groups = groupByBrand(items);
  if (brands && brands.length) {
    const wanted = new Set(brands.map(b => String(b).toLowerCase()));
    groups = groups.filter(g => wanted.has(g.brand.toLowerCase()));
  }
  return {
    groups,
    included: groups.reduce((n, g) => n + g.items.length, 0),
    scope: brands && brands.length ? `${groups.length} brands` : 'all brands',
  };
}

/** One product flattened to the canonical fields. */
export function productRow(it) {
  return {
    name: it.n || it.name || '',
    sku: it.s || it.sku || '',
    barcode: it.barcode || '',
    wholesale: it.p == null ? null : Number(it.p),
    retail: it.retail == null ? null : Number(it.retail),
    stock: Number(it.stock || 0),
    status: it.k ? 'In stock' : 'Out of stock',
    category: it.category || '',
    desc: it.d || it.description || '',
    img: it.img || null,
  };
}

/** Thumbnail filename for a product image path, or null. */
export function thumbName(imgPath) {
  if (!imgPath) return null;
  const file = String(imgPath).split('/').pop();
  if (!/^[A-Za-z0-9._-]+\.webp$/i.test(file)) return null;
  return file.replace(/\.webp$/i, '.jpg');
}

/**
 * Absolute image URL a spreadsheet can fetch, or null.
 *
 * Google Sheets' IMAGE() will not load WebP, and every matched product image
 * is WebP — so those point at the pre-built JPEG thumbnail instead. Images
 * that are already JPEG or PNG are linked where they are.
 */
export function sheetImageUrl(imgPath, origin) {
  if (!imgPath) return null;
  const base = String(origin || '').replace(/\/$/, '');
  const thumb = thumbName(imgPath);
  if (thumb) return `${base}/assets/xlsx-thumbs/${thumb}`;
  if (/\.(jpe?g|png|gif)$/i.test(imgPath)) return `${base}${imgPath}`;
  return null;
}

export const exportStamp = () => new Date().toISOString().slice(0, 10);

/** Download name for a format, e.g. itland-catalogue-2026-09-09.csv */
export const exportFilename = (ext = 'xlsx') => `itland-catalogue-${exportStamp()}.${ext}`;
