import { issueSession, sessionCookie, SESSION_MS } from '../../lib/admin-session.js';

/**
 * Admin sign-in for the Vercel deployment — the serverless twin of the route in
 * server.cjs. Without it the deployed admin screen answered every sign-in with
 * 404, which read as "wrong password" but meant "this endpoint does not exist".
 *
 * The 503 below matters: if ADMIN_PASSWORD is unset in the Vercel project, no
 * password can ever be correct, and answering 401 would send someone off to
 * retype a password that was never going to work.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ADMIN_USERNAME = 'admin', ADMIN_PASSWORD } = process.env;
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
