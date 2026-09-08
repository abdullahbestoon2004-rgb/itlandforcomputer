import { requireAdmin } from '../../lib/admin-session.js';
import { putImage } from '../../lib/blob-upload.js';
import { blobConfigured, NOT_CONFIGURED } from '../../lib/overrides-store.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

/** Store an image the admin picked from their machine. See lib/blob-upload.js. */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  if (!blobConfigured()) return res.status(501).json({ error: NOT_CONFIGURED });

  const { filename, imageData } = req.body ?? {};
  if (!filename || !imageData) return res.status(400).json({ error: 'filename and imageData required' });

  const m = String(imageData).match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'invalid imageData' });

  try {
    const url = await putImage(filename, Buffer.from(m[2], 'base64'), m[1]);
    return res.status(200).json({ ok: true, img: url });
  } catch (e) {
    return res.status(500).json({ error: `Could not store the image: ${e.message}` });
  }
}
