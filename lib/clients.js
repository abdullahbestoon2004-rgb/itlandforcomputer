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
 *
 * Accounts are configured entirely through the WHOLESALE_CLIENTS environment
 * variable, e.g.
 *   WHOLESALE_CLIENTS=[{"username":"acme","password":"...","name":"Acme Ltd"}]
 * Passwords are still compared in plaintext; hashing them is the next step
 * before this is exposed publicly.
 */

/**
 * Read and parse the configured client list from WHOLESALE_CLIENTS.
 *
 * There is deliberately NO built-in fallback account. A working default login
 * used to be hardcoded here, which meant anyone with the source could sign in
 * to a deployment that had no .env. Missing or malformed config now yields an
 * empty list, so every login is refused — failing closed is the safe direction,
 * and the server says so loudly at startup.
 */
export function loadClients(env = process.env) {
  const raw = env.WHOLESALE_CLIENTS || env.CLIENTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Never fall back to a permissive default on malformed JSON.
    return [];
  }
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
