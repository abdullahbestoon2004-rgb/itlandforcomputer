import { buildCatalogueCsv } from '../lib/catalogue-csv.js';
import { exportFilename } from '../lib/catalogue-rows.js';
import { resolveOrigin, fetchInStockItems, requestedBrands } from '../lib/export-request.js';

/**
 * Google Sheets export for the Vercel deployment, the serverless twin of the
 * route in server.cjs.
 *
 * Like api/export.xlsx.js there is no session check: sessions live in the Node
 * server's memory and /api/products on this deployment is already open, so
 * gating the spreadsheet would protect nothing.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // The frontend probes with HEAD before starting a download it cannot cancel.
  if (req.method === 'HEAD') return res.status(200).end();

  const origin = resolveOrigin(req);
  try {
    const items = await fetchInStockItems(origin);
    // The picture is an =IMAGE() formula, so the URL inside it has to be
    // absolute — hence the origin.
    const csv = buildCatalogueCsv(items, requestedBrands(req, origin), origin);
    const body = Buffer.from(csv, 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename('csv')}"`);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(body);
  } catch (e) {
    return res.status(500).json({ error: `Could not build the export: ${e.message}` });
  }
}
