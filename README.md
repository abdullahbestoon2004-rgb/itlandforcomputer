# iTLand Wholesale Portal (React)

A private, login-protected, trilingual (Kurdish / Arabic / English) **React** website where
your wholesale clients search your Zoho Books inventory and see stock + wholesale prices.

Same design and same Zoho backend as before — the frontend is now a real React (Vite) app.

---

## Project layout

```
itland-portal/
├─ lib/                ← shared backend logic (used by all three API backends)
│  ├─ product-matching.js  ← Zoho item -> portal shape, + image matching
│  └─ clients.js           ← who may sign in
├─ src/                ← React app (the frontend)
│  ├─ App.jsx          ← main app: state, routing, API calls
│  ├─ Login.jsx        ← login screen
│  ├─ Catalog.jsx      ← search + grid + filters
│  ├─ Detail.jsx       ← single item view
│  ├─ components.jsx   ← shared bits (language bar, stock badge)
│  ├─ i18n.js          ← Kurdish / Arabic / English text
│  └─ styles.css       ← design tokens + styles
├─ public/assets/      ← logo
├─ index.html          ← Vite entry
├─ vite.config.js      ← dev server + proxy to backend
├─ server.cjs          ← backend: talks to Zoho, login, search API
├─ local-api-server.mjs ← lightweight local API (no Zoho sync loop)
├─ api/                ← Vercel serverless versions of the same endpoints
├─ build-prices.cjs    ← loads wholesale prices from Zoho
└─ config.json         ← YOUR Zoho keys + client logins (keep private)
```

The backend (`server.cjs`, `build-prices.cjs`) is unchanged from the plain-JS version —
your Zoho keys never reach the browser.

---

## First-time setup

1. Open a terminal in this folder and install everything:
   ```
   npm install
   ```

2. Load wholesale prices from Zoho (one time, and again whenever you change prices):
   ```
   npm run prices
   ```

3. Build the React app:
   ```
   npm run build
   ```

4. Start the server (it serves the built app + talks to Zoho):
   ```
   npm start
   ```

5. Open **http://localhost:3000** and log in with `demo` / `demo123`.

---

## Working on the design (live reload)

While editing the React files, run TWO terminals:

- Terminal 1 — the backend:
  ```
  npm run server
  ```
- Terminal 2 — the Vite dev server (hot reload):
  ```
  npm run dev
  ```
  Then open **http://localhost:5173**. Edits to `src/` update instantly.
  (The dev server proxies `/api` and `/assets` to the backend automatically.)

When you're happy, run `npm run build` again so `npm start` serves the new version.

---

## Client logins

Edit the `CLIENTS` list in **config.json**:

```json
"CLIENTS": [
  { "username": "ahmad", "password": "choose-a-password", "name": "Ahmad Stores" },
  { "username": "sara",  "password": "another-password",  "name": "Sara Trading" }
]
```

Restart the server after changes.

---

## Connecting Zoho

**The portal ships disconnected.** With no Zoho credentials it serves 14 built-in demo
products, and both the startup log and `GET /api/status` (admin session required) say so:

```
  !!  NOT CONNECTED TO ZOHO — serving 14 built-in demo products.
  !!  Missing: ZOHO_ORG_ID, ZOHO_REFRESH_TOKEN
```

Everything on the server side is wired and tested; it only needs these two values, which
have to come from your own Zoho account:

**1. Organization ID** — Zoho Books → Settings → Organization → *Organization ID*
(a number like `891234567`).

**2. Refresh token** — a one-time OAuth exchange:

- In the [Zoho API Console](https://api-console.zoho.com/), create (or open) a **Self Client**.
- Under *Generate Code* enter scope `ZohoBooks.items.READ,ZohoBooks.settings.READ`
  (read-only is all the portal needs), set the duration to 10 minutes, then **Create** and
  pick your Books organization. Copy the code — it works once and expires quickly.
- With the server running (`npm run server`), open
  <http://localhost:3000/api/zoho-callback>. Paste the Client ID, Client Secret and the
  code, choose your data centre, and it returns the refresh token plus the exact `.env`
  lines to paste.

> Zoho runs regional data centres and **a grant code only works on the one that issued
> it**. Check your Zoho Books URL: `books.zoho.com` needs no extra settings, but `.eu`,
> `.in`, `.com.au` or `.sa` also require `ZOHO_ACCOUNTS_DOMAIN` and `ZOHO_API_DOMAIN`
> (the helper page prints these for you). A mismatch shows up as a confusing
> `invalid_client` rather than anything obvious.

**3. Put both in `.env`** (never commit it — it is already gitignored):

```
ZOHO_ORG_ID=891234567
ZOHO_REFRESH_TOKEN=1000.xxxxxxxx.xxxxxxxx
```

Restart the server. The startup banner should switch to `Syncing from Zoho every 5
minute(s).`, and `/api/products` should report `"dataSource": "zoho"` instead of `"demo"`.
If the first sync fails, the error is printed at startup and stored in `/api/status` as
`lastSyncError`.

> The Client ID and Secret currently hardcoded as fallbacks in the source were shared in
> chat and should be regenerated before this is exposed publicly.

---

## Product images

All product art is **WebP**, capped at 900px on the longest side (product cards render at
roughly 200px, the detail view at 260px). The set is 195 images totalling ~5 MB; the
original JPEG/PNG files were ~63 MB, large enough to make the catalog painful on mobile
data.

After adding images to `public/assets/product_images/`, regenerate the manifest that the
serverless backends read:

```bash
node -e "const fs=require('fs');const d='public/assets/product_images';const n=fs.readdirSync(d).filter(f=>f.endsWith('.webp')).sort();fs.writeFileSync('product-image-manifest.js','// Generated from public/assets/product_images. Keep this manifest in sync when adding assets.\n// Regenerate after adding images; all assets are WebP (see README performance notes).\nexport const LOCAL_IMAGES = [\n'+n.map(x=>'  \"'+x+'\",').join('\n')+'\n];\n')"
```

Filenames drive image matching: `Brand_Model_Words.webp`. The brand is the segment before
the first underscore, so `Logitech_MX_Master_3S.webp` matches Logitech MX Master 3S. The
extension is ignored by the matcher.

---

## Auto-Find Online (product image search)

The admin panel's **Auto-Find Online** button searches the web for product art.

It originally used DuckDuckGo only. **DuckDuckGo is unreachable from this network** —
`duckduckgo.com` and `html.duckduckgo.com` both time out, while Google, Bing and other
hosts answer in under a second — so the button could never return anything here, and the
admin UI reported it indistinguishably as "No images found".

Failures are now reported with their actual cause, and the search prefers an official API:

**Google Custom Search (recommended, 100 free queries/day)**

1. Create an API key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   and enable the **Custom Search API**.
2. Create a search engine at [programmablesearchengine.google.com](https://programmablesearchengine.google.com/):
   set it to search the entire web, and turn **Image search** ON. Copy the Search engine ID.
3. Add both to `.env`:

```
GOOGLE_API_KEY=AIza...
GOOGLE_CSE_ID=a1b2c3d4e5f6g7h8i
```

Restart the server. If the key is wrong or the quota is spent, Google's own explanation is
shown in the admin panel rather than a generic message.

DuckDuckGo is kept as a fallback for networks where it does work. Both providers are tried
in order, each has a 10-second timeout, and `/api/admin/search-images` returns an
`attempts` array showing what each one did — useful when diagnosing.

> Scraping search engines is inherently unreliable: Bing was also evaluated and returned
> unrelated results (medical slides for a headset query), so it was not used. The Google
> API is the only dependable option here.

---

## Excel export

Signed-in clients can download the in-stock catalogue as a single `.xlsx` from the **Export
to Excel** button in the catalog header. `GET /api/export.xlsx` builds it server-side with
`exceljs`.

The sheet is one worksheet with each brand introduced by its own heading row, followed by
that brand's products: image, name, code, barcode, wholesale and retail price, stock,
status, category and description. Prices carry a currency number format so they can be
totalled.

Two things worth knowing:

- **Product images come from pre-built thumbnails.** Excel does not reliably render WebP
  and every asset is WebP, so `npm run build:thumbs` writes a 128px JPEG per image into
  `public/assets/xlsx-thumbs/` (257 files, ~1 MB). **Run it after adding product images**,
  alongside regenerating the manifest. They are committed because `dwebp` exists on a
  developer machine but not in a serverless runtime, so converting at request time meant
  the deployed export could not have shown pictures at all. A missing thumbnail never
  fails the download.
- **Both deployments serve it.** `server.cjs` reads the thumbnails from disk;
  `api/export.xlsx.js` fetches the same files over HTTP from its own deployment. Both call
  `lib/catalogue-workbook.js`, so the file is identical either way — verified byte for byte.
- **The Node route requires a session; the serverless one cannot.** The file is the whole
  wholesale price list, so `server.cjs` returns 401 without a session. Sessions live in that
  process's memory and do not exist in a Vercel function, and `/api/products` there is
  already unauthenticated, so gating only the spreadsheet would protect nothing. Restarting
  the Node server logs clients out while their open tab still shows the catalogue — the UI
  turns that 401 into a "sign in again" prompt rather than a silent failure.

Brands are detected in [`lib/brands.js`](lib/brands.js), shared with the catalog's brand
filter so the two always agree. Zoho carries no brand on any item, so it is read from the
product name, SKU, then description, matching whole words only and preferring the earliest
mention — the maker leads a product name, while other brands appear later as compatibility
claims ("Poly Sync 20+ **Microsoft** Teams" is a Poly product).

---

## Keeping data fresh

- **Stock & new items:** automatic — the server re-syncs from Zoho every 5 minutes.
- **Wholesale prices:** run `npm run prices` again after updating prices in Zoho.

---

## Before going live

- **Regenerate your Zoho Client Secret** (the one used here was shared in chat), update
  `config.json`, and re-run `npm run prices`.
- **config.json is secret** — never commit it publicly or share it.
- Currently runs on localhost. To let clients reach it over the internet you'll deploy it
  to a host with HTTPS — ask and I'll walk you through it.
