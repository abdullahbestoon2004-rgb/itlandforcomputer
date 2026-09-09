/**
 * Serverless export plumbing
 * ==========================
 * Shared by the Vercel export functions. Each of them has to answer the same
 * two questions — what is this deployment's own address, and what is in stock
 * right now — and a function has no catalogue on disk, so it asks its own
 * /api/products over HTTP the way a browser would.
 *
 * The Node server needs none of this: it holds the items in memory and reads
 * the images from the filesystem.
 */

/** This deployment's own origin, behind whatever proxy terminated the request. */
export function resolveOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/** In-stock catalogue, fetched from this deployment's own product endpoint. */
export async function fetchInStockItems(origin) {
  const res = await fetch(`${origin}/api/products`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`products endpoint returned ${res.status}`);
  const data = await res.json();
  return (data.products || data.items || []).filter(it => it.k ?? it.in_stock);
}

/** ?brands=Logitech,Onten selects a subset; absent means everything. */
export function requestedBrands(req, origin) {
  const raw = new URL(req.url, origin).searchParams.get('brands') || '';
  return raw.split(',').map(b => b.trim()).filter(Boolean);
}
