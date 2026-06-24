/**
 * iTLand Wholesale Portal — Standalone API Client
 * ------------------------------------------------
 * Copy this file into any project.
 * Set ITLAND_URL to wherever the iTLand server is running.
 *
 * Usage:
 *   import { login, getItems, adminLogin, ... } from './itland-api.js';
 */

const ITLAND_URL = "http://localhost:3000";

function req(path, opts = {}) {
  return fetch(ITLAND_URL + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Login as a regular client. Returns { ok: true } or throws on failure. */
export async function login(username, password) {
  const res = await req("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error("Invalid username or password");
  return data;
}

/** Log out the current client session. */
export async function logout() {
  await req("/api/logout", { method: "POST" });
}

/** Check if a client session is active. Returns true/false. */
export async function isLoggedIn() {
  const res = await req("/api/me");
  const data = await res.json();
  return data.loggedIn === true;
}

// ── Products ──────────────────────────────────────────────────────────────────

/**
 * Fetch all products. Requires an active client session (call login first).
 *
 * Each item:
 * {
 *   id:      string,
 *   n:       string,   // product name
 *   s:       string,   // SKU
 *   barcode: string,   // barcode / Zoho item name
 *   p:       number | null,  // wholesale price
 *   retail:  number | null,  // retail price
 *   k:       boolean,  // true = in stock
 *   stock:   number,
 *   d:       string,   // short description
 *   img:     string | null,  // image path, e.g. "/assets/product_images/Logitech_MX_Master_3S.jpg"
 * }
 */
export async function getItems() {
  const res = await req("/api/items");
  if (res.status === 401) throw new Error("Not logged in");
  const data = await res.json();
  return data.items || [];
}

/**
 * Get full image URL for an item (prepends the server base URL).
 * Usage: <img src={getImageUrl(item.img)} />
 */
export function getImageUrl(imgPath) {
  if (!imgPath) return null;
  if (imgPath.startsWith("http")) return imgPath;
  return ITLAND_URL + imgPath;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Login as admin. Returns { ok: true } or throws on failure. */
export async function adminLogin(username, password) {
  const res = await req("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error("Invalid admin credentials");
  return data;
}

/** Log out the admin session. */
export async function adminLogout() {
  await req("/api/admin/logout", { method: "POST" });
}

/** Fetch all products as admin (includes items without prices). */
export async function adminGetItems() {
  const res = await req("/api/admin/items");
  if (res.status === 401) throw new Error("Not logged in as admin");
  const data = await res.json();
  return data.items || [];
}

/** Get the list of all available product image paths. */
export async function adminGetImages() {
  const res = await req("/api/admin/images");
  const data = await res.json();
  return (data.images || []).map(getImageUrl);
}

/**
 * Edit a product's name, price, or image.
 * Pass null to reset a field back to the original Zoho value.
 *
 * Example:
 *   await adminSaveProduct({ itemId: "123", n: "New Name", p: 9.99 });
 *   await adminSaveProduct({ itemId: "123", img: null }); // reset image
 */
export async function adminSaveProduct({ itemId, n, p, img }) {
  const res = await req("/api/admin/override", {
    method: "POST",
    body: JSON.stringify({ itemId, n, p, img }),
  });
  if (res.status === 401) throw new Error("Not logged in as admin");
  return await res.json();
}

/**
 * Upload a new product image from a File object (e.g. from <input type="file">).
 * Returns the full image URL.
 *
 * Example:
 *   const url = await adminUploadImage(file);
 *   await adminSaveProduct({ itemId: "123", img: url });
 */
export async function adminUploadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const res = await req("/api/admin/upload", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, imageData: e.target.result }),
        });
        const data = await res.json();
        if (!data.img) throw new Error("Upload failed");
        resolve(getImageUrl(data.img));
      } catch (err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}
