/**
 * Where admin edits live
 * ======================
 * server.cjs writes overrides.json next to itself and re-reads it per request.
 * A serverless function has no writable disk — its filesystem is the read-only
 * deployment bundle — so an edit made in the admin panel on the deployed site
 * has nowhere to go unless something outside the bundle holds it.
 *
 * That something is Vercel Blob. Connecting a Blob store to the project injects
 * BLOB_READ_WRITE_TOKEN automatically, and this module starts using it with no
 * further configuration. Until then, reads fall back to the overrides.json
 * committed in the repo (so existing overrides still show) and writes fail with
 * an error that says exactly what is missing, rather than reporting success and
 * silently discarding the edit.
 *
 * The plain REST API is used rather than @vercel/blob to avoid adding a runtime
 * dependency for one PUT and one GET.
 */
const API = 'https://blob.vercel-storage.com';
const PATHNAME = 'overrides.json';
const READ_TTL_MS = 5000;      // an edit must be visible on the next page load

let cache = null;
let cacheExpires = 0;

export const blobConfigured = (env = process.env) => Boolean(env.BLOB_READ_WRITE_TOKEN);

export const NOT_CONFIGURED =
  'Saving is not enabled on this deployment: no Blob store is connected, so there is ' +
  'nowhere to write the change. Connect one in the Vercel dashboard (Storage → Create ' +
  'Database → Blob) and redeploy; no code change is needed.';

async function blobUrl(token) {
  const r = await fetch(`${API}?prefix=${encodeURIComponent(PATHNAME)}&limit=1`, {
    headers: { authorization: `Bearer ${token}`, 'x-api-version': '7' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`blob list failed: HTTP ${r.status}`);
  const data = await r.json();
  return data.blobs?.find(b => b.pathname === PATHNAME)?.url || null;
}

/** The overrides map. Never throws — a store that is down must not break the catalogue. */
export async function readOverrides(env = process.env) {
  if (cache && Date.now() < cacheExpires) return cache;

  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const url = await blobUrl(token);
      if (url) {
        // Bust the CDN: Blob URLs are cached, and a stale read here would show
        // the admin their previous edit right after they saved a new one.
        const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          cache = await r.json();
          cacheExpires = Date.now() + READ_TTL_MS;
          return cache;
        }
      }
      // No blob yet: nothing has been saved on this deployment. Fall through to
      // the committed file so overrides made in the repo still apply.
    } catch { /* fall through to the bundled copy */ }
  }

  // The committed copy. vercel.json's includeFiles puts it in the function
  // bundle: read through a computed path, nothing else would, and the three
  // image overrides silently did not apply on the deployment because of it.
  // cwd is not guaranteed to be the project root either, so try both.
  try {
    const [fs, path, url] = await Promise.all([import('node:fs'), import('node:path'), import('node:url')]);
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    for (const p of [path.join(process.cwd(), 'overrides.json'), path.join(here, '..', 'overrides.json')]) {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch { /* no bundled overrides either */ }
  return {};
}

/** Persist the whole map. Throws when there is no store — the caller must report that. */
export async function writeOverrides(overrides, env = process.env) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error(NOT_CONFIGURED);

  const r = await fetch(`${API}/${PATHNAME}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-cache-control-max-age': '0',
    },
    body: JSON.stringify(overrides, null, 2),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`could not save: blob store returned HTTP ${r.status}`);

  cache = overrides;
  cacheExpires = Date.now() + READ_TTL_MS;
  return true;
}
