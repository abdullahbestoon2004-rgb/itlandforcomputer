import { requireAdmin } from '../../lib/admin-session.js';
import { putImage } from '../../lib/blob-upload.js';
import { readOverrides, writeOverrides, blobConfigured, NOT_CONFIGURED } from '../../lib/overrides-store.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Take an image found by Auto-Find, store it, and attach it to the item.
 *
 * The remote URL is fetched and re-hosted rather than saved as-is: a search
 * result points at somebody else's server, which may rate-limit, hotlink-block
 * or simply delete the file, and the catalogue would then show a broken image
 * with no record of what it used to be.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  if (!blobConfigured()) return res.status(501).json({ error: NOT_CONFIGURED });

  const { itemId, imageUrl, filename } = req.body ?? {};
  if (!imageUrl || !filename) return res.status(400).json({ error: 'imageUrl and filename required' });

  try {
    const r = await fetch(imageUrl, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) throw new Error(`that URL is ${type}, not an image`);

    const url = await putImage(filename, Buffer.from(await r.arrayBuffer()), type);

    if (itemId) {
      const overrides = await readOverrides();
      if (!overrides[itemId]) overrides[itemId] = {};
      overrides[itemId].img = url;
      await writeOverrides(overrides);
    }
    return res.status(200).json({ ok: true, img: url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
