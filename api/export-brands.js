import { groupByBrand } from '../lib/brands.js';
import { resolveOrigin, fetchInStockItems } from '../lib/export-request.js';

/**
 * Brands available to export, with in-stock counts, for the export dialog.
 * The Node server has an equivalent route; this is its serverless twin.
 *
 * Like api/export.xlsx.js there is no session check: sessions live in the Node
 * server's memory and /api/products on this deployment is already open, so
 * gating a list of brand names would protect nothing.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const items = await fetchInStockItems(resolveOrigin(req));
    const groups = groupByBrand(items);
    return res.status(200).json({ brands: groups.map(g => ({ brand: g.brand, count: g.items.length })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
