import { requireAdmin } from '../../lib/admin-session.js';

/**
 * Auto-Find Images, for the Vercel deployment.
 *
 * Only Google Custom Search is offered here. server.cjs tries several providers
 * because it runs on a developer machine where one or another may be blocked;
 * a function has no such quirks, and a documented API key is the only provider
 * that can be relied on.
 *
 * When the keys are absent the reply says so. The admin UI shows `error`
 * verbatim, and "No images found" for a missing API key was the exact
 * confusion this wording was introduced to end.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAdmin(req, res)) return;

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
