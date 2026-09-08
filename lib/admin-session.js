/**
 * Admin session cookie
 * ====================
 * Stateless, signed, and therefore usable from a serverless function.
 *
 * server.cjs keeps admin sessions in a `Map` and hands out an opaque random
 * token. That cannot work on Vercel: each request may hit a different instance
 * with its own empty Map, so a token minted by the login call would be
 * unrecognised by the very next request. Rather than add a session store, the
 * cookie carries its own claims and an HMAC over them, so any instance can
 * verify it with nothing but the secret.
 *
 * The secret is ADMIN_SESSION_SECRET when set. Otherwise it falls back to
 * ADMIN_PASSWORD, which is already required for logging in — a deployment with
 * one env var set therefore works, and changing the admin password invalidates
 * every outstanding session, which is the behaviour you want anyway.
 */
import crypto from 'node:crypto';

export const COOKIE = 'adminsession';
export const SESSION_MS = 8 * 60 * 60 * 1000;   // 8 hours, as in server.cjs

const secret = (env) => env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || '';

const sign = (payload, key) =>
  crypto.createHmac('sha256', key).update(payload).digest('base64url');

/** `<user>.<expiry>.<hmac>` — everything the verifier needs. */
export function issueSession(user, env, now = Date.now()) {
  const key = secret(env);
  if (!key) throw new Error('no admin secret configured');
  const payload = `${Buffer.from(String(user)).toString('base64url')}.${now + SESSION_MS}`;
  return `${payload}.${sign(payload, key)}`;
}

/** The session's user, or null if absent, malformed, expired or unsigned. */
export function readSession(cookieHeader, env, now = Date.now()) {
  const key = secret(env);
  if (!key) return null;
  const m = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;

  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [user64, expStr, mac] = parts;
  const payload = `${user64}.${expStr}`;

  const expected = sign(payload, key);
  // Constant-time: timingSafeEqual throws on a length mismatch, so check first.
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;
  return Buffer.from(user64, 'base64url').toString() || null;
}

export const sessionCookie = (value, maxAgeSeconds) =>
  `${COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure`;

/**
 * Guard for the admin endpoints: returns the user, or writes 401 and returns
 * null so the caller can `if (!requireAdmin(req, res)) return;`.
 */
export function requireAdmin(req, res, env = process.env) {
  const user = readSession(req.headers?.cookie, env);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return user;
}
