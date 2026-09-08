import { requireAdmin } from '../../lib/admin-session.js';

/**
 * The catalogue as the admin panel wants it: `{ items: [...] }`.
 *
 * The products are fetched over HTTP from this deployment's own /api/products
 * rather than re-implementing the Zoho paging here — the same approach
 * api/export.xlsx.js takes, and it means overrides and image matching are
 * applied in exactly one place.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  try {
    const r = await fetch(`${proto}://${host}/api/products`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error(`products endpoint returned ${r.status}`);
    const data = await r.json();
    return res.status(200).json({ items: data.products || data.items || [] });
  } catch (e) {
    return res.status(500).json({ error: `Could not load the catalogue: ${e.message}` });
  }
}
