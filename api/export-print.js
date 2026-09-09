import { buildCataloguePrintPage } from '../lib/catalogue-print.js';
import { resolveOrigin, fetchInStockItems, requestedBrands } from '../lib/export-request.js';

/**
 * PDF export for the Vercel deployment, the serverless twin of the route in
 * server.cjs.
 *
 * It serves a print-styled page rather than a PDF file: the browser writes the
 * PDF, which is why this is opened in a tab instead of downloaded. See
 * lib/catalogue-print.js for why the rendering is not done here.
 *
 * Like api/export.xlsx.js there is no session check: sessions live in the Node
 * server's memory and /api/products on this deployment is already open.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'HEAD') return res.status(200).end();

  const origin = resolveOrigin(req);
  try {
    const items = await fetchInStockItems(origin);
    const html = buildCataloguePrintPage(items, requestedBrands(req, origin));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).json({ error: `Could not build the export: ${e.message}` });
  }
}
