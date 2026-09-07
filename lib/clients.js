/**
 * Shared wholesale client credentials
 * ===================================
 * Single source of truth for "who may sign in, and what do we call them".
 *
 * This existed in three near-copies (server.cjs, local-api-server.mjs,
 * api/wholesale-login.js) which had genuinely diverged: server.cjs matched on
 * `username` only and threw on a record without one, while the other two
 * matched `email` or `username`. A client defined by email alone could sign in
 * on Vercel and in dev but not in production.
 */

/**
 * Fallback account used when WHOLESALE_CLIENTS is unset.
 *
 * SECURITY: this is a working credential committed to the repo, so the portal
 * is reachable with itland/itland123 even with no .env present. It exists so a
 * fresh checkout boots; it should be deleted before the portal is exposed
 * publicly, and real accounts should carry hashed passwords rather than
 * plaintext. Deleting it is a one-line change here instead of three.
 */
export const DEFAULT_CLIENTS = [
  { username: 'itland', email: 'itland', password: 'itland123', name: 'iTLand Client' },
];

/** Read and parse the configured client list, falling back to DEFAULT_CLIENTS. */
export function loadClients(env = process.env) {
  const raw = env.WHOLESALE_CLIENTS || env.CLIENTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // Malformed config must not silently widen access — fall through to the
      // default rather than leaving the list empty (which would deny everyone
      // and look like an outage) or throwing at request time.
    }
  }
  return DEFAULT_CLIENTS;
}

/**
 * Find the client matching an identifier (email OR username, case- and
 * whitespace-insensitive) and an exact password. Returns the record, or null.
 */
export function findClient(clients, identifier, password) {
  const input = String(identifier ?? '').toLowerCase().trim();
  if (!input || password == null || password === '') return null;
  return (clients || []).find(c =>
    ((c.email || '').toLowerCase().trim() === input ||
     (c.username || '').toLowerCase().trim() === input) &&
    c.password === password) || null;
}

/** The public-safe subset of a client record sent to the browser. */
export function toClientProfile(client) {
  return {
    name: client.name || client.username || 'Client',
    company: client.company || null,
    email: client.email || client.username,
  };
}
