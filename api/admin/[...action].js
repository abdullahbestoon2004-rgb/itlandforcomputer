import { LOCAL_IMAGES } from '../../product-image-manifest.js';
import { issueSession, sessionCookie, requireAdmin, SESSION_MS } from '../../lib/admin-session.js';
import { applyOverrideEdit } from '../../lib/overrides.js';
import { readOverrides, writeOverrides, blobConfigured, NOT_CONFIGURED } from '../../lib/overrides-store.js';
import { putImage } from '../../lib/blob-upload.js';

/**
 * The whole admin API for the Vercel deployment, in one function.
 *
 * Signing in on the deployed site used to answer 404 — which reads as a
 * rejected password but meant that every /api/admin/* route existed only in
 * server.cjs and the deployment had no admin backend at all.
 *
 * One catch-all rather than eight files, because eight would take the project
 * from 5 serverless functions to 13, and the Hobby plan allows 12. That build
 * completed and then failed at "Deploying outputs" with nothing in the build
 * log to explain it. Routing here also means the session check happens in
 * exactly one place instead of being repeated — and forgettable — per file.
 *
 * Behaviour matches the routes in server.cjs. What cannot match is storage: a
 * function's filesystem is the read-only deployment bundle, so saves go to
 * Vercel Blob (see lib/overrides-store.js) and say so plainly when no store is
 * connected, rather than reporting success and discarding the edit.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const methodNotAllowed = (res) => res.status(405).json({ error: 'Method not allowed' });
const needsStore = (res) => res.status(501).json({ error: NOT_CONFIGURED });

/* ── sign in / out ─────────────────────────────────────────────────────── */

function login(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { ADMIN_USERNAME = 'admin', ADMIN_PASSWORD } = process.env;
  // Without a password configured no credentials can ever be right, and
  // answering 401 would send someone off to retype a working password.
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      ok: false,
      error: 'The admin panel is closed: ADMIN_PASSWORD is not set on this deployment.',
    });
  }

  const { username, password } = req.body ?? {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'invalid' });
  }
  res.setHeader('Set-Cookie', sessionCookie(issueSession(username, process.env), SESSION_MS / 1000));
  return res.status(200).json({ ok: true });
}

function logout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  // The session is entirely in the cookie, so expiring it is the whole job.
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  return res.status(200).json({ ok: true });
}

/* ── reads ─────────────────────────────────────────────────────────────── */

/** The catalogue, fetched from this deployment's own /api/products. */
async function items(req, res) {
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

/**
 * Art available to attach. server.cjs scans the images directory at boot; a
 * function has none to scan, so the list comes from the pre-built manifest.
 */
function images(req, res) {
  return res.status(200).json({ images: LOCAL_IMAGES.map(f => `/assets/product_images/${f}`) });
}

/* ── writes ────────────────────────────────────────────────────────────── */

async function override(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!blobConfigured()) return needsStore(res);

  const data = req.body ?? {};
  if (!data.itemId) return res.status(400).json({ error: 'itemId required' });
  try {
    const overrides = await readOverrides();
    if (data.reset) {
      delete overrides[data.itemId];
      await writeOverrides(overrides);
      return res.status(200).json({ ok: true, reset: true });
    }
    const entry = applyOverrideEdit(overrides, data);
    await writeOverrides(overrides);
    return res.status(200).json({ ok: true, item: entry });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function upload(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!blobConfigured()) return needsStore(res);

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

/**
 * Take an image Auto-Find turned up and attach it to the item.
 *
 * It is re-hosted rather than linked: a search result points at somebody
 * else's server, which may rate-limit, hotlink-block or delete the file, and
 * the catalogue would then show a hole with no record of what belonged there.
 */
async function attachOnlineImage(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!blobConfigured()) return needsStore(res);

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

/**
 * Auto-Find. Only Google Custom Search is offered: server.cjs tries several
 * providers because a developer machine may have any of them blocked, but a
 * function has no such quirks and a documented API key is the one dependable
 * option. A missing key reports itself — "No images found" for an unset key was
 * the exact confusion this wording was introduced to end.
 */
async function searchImages(req, res) {
  const q = (req.query?.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query required' });

  const { GOOGLE_API_KEY, GOOGLE_CSE_ID } = process.env;
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    return res.status(200).json({
      results: [],
      error: 'Image search is not configured: set GOOGLE_API_KEY and GOOGLE_CSE_ID on this deployment.',
    });
  }
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_API_KEY)}`
      + `&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&searchType=image&num=10&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await r.json();
    if (data.error) return res.status(200).json({ results: [], error: `Google: ${data.error.message}` });
    return res.status(200).json({
      results: (data.items || []).map(it => ({
        url: it.link,
        thumbnail: it.image?.thumbnailLink || it.link,
        title: it.title,
        source: it.displayLink,
      })),
    });
  } catch (e) {
    return res.status(200).json({ results: [], error: `Search failed: ${e.message}` });
  }
}

/* ── router ────────────────────────────────────────────────────────────── */

// Everything except signing in and out needs a session.
const PUBLIC = new Set(['login', 'logout']);

const ROUTES = {
  login,
  logout,
  items,
  images,
  override,
  upload,
  'search-images': searchImages,
  'attach-online-image': attachOnlineImage,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = [].concat(req.query?.action ?? []).join('/');
  const route = ROUTES[action];
  if (!route) return res.status(404).json({ error: `Unknown admin action: ${action || '(none)'}` });

  if (!PUBLIC.has(action) && !requireAdmin(req, res)) return;
  return route(req, res);
}
