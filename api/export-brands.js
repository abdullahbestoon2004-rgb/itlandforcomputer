import { groupByBrand } from '../lib/brands.js';

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

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    const r = await fetch(`${proto}://${host}/api/products`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error(`products endpoint returned ${r.status}`);
    const data = await r.json();
    const items = (data.products || data.items || []).filter(it => it.k ?? it.in_stock);
    const groups = groupByBrand(items);
    return res.status(200).json({ brands: groups.map(g => ({ brand: g.brand, count: g.items.length })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
