import { requireAdmin } from '../../lib/admin-session.js';
import { applyOverrideEdit } from '../../lib/overrides.js';
import { readOverrides, writeOverrides, blobConfigured, NOT_CONFIGURED } from '../../lib/overrides-store.js';

/**
 * Save (or reset) one item's admin overrides on the Vercel deployment.
 *
 * The check below runs before anything is computed so that a deployment with no
 * Blob store says so up front. The alternative — accept the edit, fail at the
 * write, and return 500 — would tell the user their save "errored" when in fact
 * nothing about the request was wrong.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  if (!blobConfigured()) return res.status(501).json({ error: NOT_CONFIGURED });

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
