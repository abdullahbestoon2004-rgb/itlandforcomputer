# iTLand Wholesale Portal (React)

A private, login-protected, trilingual (Kurdish / Arabic / English) **React** website where
your wholesale clients search your Zoho Books inventory and see stock + wholesale prices.

Same design and same Zoho backend as before — the frontend is now a real React (Vite) app.

---

## Project layout

```
itland-portal/
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
