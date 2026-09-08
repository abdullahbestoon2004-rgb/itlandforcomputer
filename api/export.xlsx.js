import { buildCatalogueWorkbook, exportFilename } from '../lib/catalogue-workbook.js';

/**
 * Excel export for the Vercel deployment.
 *
 * The Node server (server.cjs) has its own route; this is the serverless twin,
 * without which the deployed site returned 404 for the Export button. Both use
 * lib/catalogue-workbook.js so the file is identical.
 *
 * Two differences from the server route, both forced by the platform:
 *
 *  - Pictures are fetched over HTTP from this deployment's own
 *    /assets/xlsx-thumbs/, since a function has no product images on disk and
 *    no image tooling to convert WebP with.
 *  - No session check. Sessions live in the Node server's memory and do not
 *    exist here, and /api/products on this deployment is already unauthenticated,
 *    so gating only the spreadsheet would protect nothing.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // The frontend probes with HEAD before starting a download it cannot cancel.
  if (req.method === 'HEAD') return res.status(200).end();

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  try {
    const listed = await fetch(`${origin}/api/products`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!listed.ok) throw new Error(`products endpoint returned ${listed.status}`);
    const data = await listed.json();
    const items = (data.products || data.items || []).filter(it => it.k ?? it.in_stock);

    // One fetch per distinct thumbnail, cached for the life of the request.
    const cache = new Map();
    const loadThumb = async (name) => {
      if (cache.has(name)) return cache.get(name);
      let buf = null;
      try {
        const r = await fetch(`${origin}/assets/xlsx-thumbs/${name}`, { signal: AbortSignal.timeout(15000) });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      } catch { buf = null; }
      cache.set(name, buf);
      return buf;
    };

    // ?brands=Logitech,Onten selects a subset; absent means everything.
    const raw = new URL(req.url, origin).searchParams.get('brands') || '';
    const wanted = raw.split(',').map(b => b.trim()).filter(Boolean);
    const file = await buildCatalogueWorkbook(items, loadThumb, wanted);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename()}"`);
    res.setHeader('Content-Length', file.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(file);
  } catch (e) {
    return res.status(500).json({ error: `Could not build the export: ${e.message}` });
  }
}
