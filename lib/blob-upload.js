/**
 * Uploading product art from the deployed admin panel
 * ===================================================
 * server.cjs writes the file into public/assets/product_images and returns a
 * site-relative path. On Vercel that directory is part of the read-only
 * deployment bundle, so an uploaded image goes to the same Blob store the
 * overrides use, and the item's `img` override becomes the blob's absolute URL
 * instead of a relative path. The catalogue renders either without changes.
 */
const API = 'https://blob.vercel-storage.com';
const MAX_BYTES = 8 * 1024 * 1024;

/** Keep the name recognisable but harmless as a URL path segment. */
export const safeName = (name) =>
  String(name).split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'image';

/** Uploads to `product_images/<name>` and returns the public URL. */
export async function putImage(name, buffer, contentType, env = process.env) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('no Blob store is connected to this deployment');
  if (buffer.length > MAX_BYTES) throw new Error(`image is too large (${Math.round(buffer.length / 1024)} KB, limit 8 MB)`);

  const r = await fetch(`${API}/product_images/${safeName(name)}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': contentType || 'application/octet-stream',
      'x-add-random-suffix': '0',
    },
    body: buffer,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`blob store returned HTTP ${r.status}`);
  const data = await r.json();
  if (!data.url) throw new Error('blob store returned no URL');
  return data.url;
}
