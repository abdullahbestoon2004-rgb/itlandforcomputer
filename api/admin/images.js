import { LOCAL_IMAGES } from '../../product-image-manifest.js';
import { requireAdmin } from '../../lib/admin-session.js';

/**
 * The product art available to attach to an item.
 *
 * server.cjs scans public/assets/product_images at boot; a function has no such
 * directory to scan, so the list comes from the pre-built manifest — the same
 * substitution api/products.js makes for image matching.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;
  return res.status(200).json({
    images: LOCAL_IMAGES.map(f => `/assets/product_images/${f}`),
  });
}
