/**
 * build-prices.js
 * ----------------
 * Builds wholesale-prices.json  ->  { "<item_id>": <wholesalePrice>, ... }
 * The server reads this to attach wholesale prices to live stock data.
 *
 * Run whenever you've updated wholesale prices in Zoho:
 *   node build-prices.js
 *
 * It auto-detects whether Zoho returns custom fields in the fast list endpoint.
 * If yes -> quick. If no -> falls back to per-item detail calls (slower but works).
 */

const fs = require("fs");
const C = require("./config.json");

async function tok() {
  const p = new URLSearchParams({
    refresh_token: C.ZOHO_REFRESH_TOKEN, client_id: C.ZOHO_CLIENT_ID,
    client_secret: C.ZOHO_CLIENT_SECRET, grant_type: "refresh_token",
  });
  const r = await fetch(C.ZOHO_ACCOUNTS_DOMAIN + "/oauth/v2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("token error: " + JSON.stringify(d));
  return d.access_token;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readCF(it) {
  const cf = (it.custom_fields || []).find(f => f.api_name === C.WHOLESALE_FIELD);
  if (cf && cf.value !== "" && cf.value != null) return Number(cf.value);
  return null;
}

(async () => {
  const t = await tok();
  // page 1 to test for custom fields in list
  const probe = await fetch(C.ZOHO_API_DOMAIN + "/books/v3/items?organization_id=" + C.ZOHO_ORG_ID + "&per_page=5", {
    headers: { Authorization: "Zoho-oauthtoken " + t },
  });
  const pd = await probe.json();
  const listHasCF = pd.items && pd.items[0] && "custom_fields" in pd.items[0]
    && (pd.items[0].custom_fields || []).some(f => f.api_name === C.WHOLESALE_FIELD);

  const map = {};
  let page = 1, more = true, ids = [];
  console.log("Fetching item list...");
  while (more) {
    const r = await fetch(C.ZOHO_API_DOMAIN + "/books/v3/items?organization_id=" + C.ZOHO_ORG_ID + "&per_page=200&page=" + page, {
      headers: { Authorization: "Zoho-oauthtoken " + t },
    });
    if (r.status === 429) { await sleep(3000); continue; }
    const d = await r.json();
    for (const it of (d.items || [])) {
      if (listHasCF) {
        const v = readCF(it);
        if (v != null) map[it.item_id] = v;
      } else {
        ids.push(it.item_id);
      }
    }
    more = d.page_context && d.page_context.has_more_page;
    page++;
  }

  if (listHasCF) {
    console.log("List endpoint includes custom fields — fast path used.");
  } else {
    console.log("List endpoint lacks custom fields — fetching " + ids.length + " details (this takes a few minutes)...");
    let n = 0;
    for (const id of ids) {
      let ok = false;
      while (!ok) {
        const r = await fetch(C.ZOHO_API_DOMAIN + "/books/v3/items/" + id + "?organization_id=" + C.ZOHO_ORG_ID, {
          headers: { Authorization: "Zoho-oauthtoken " + t },
        });
        if (r.status === 429) { await sleep(3000); continue; }
        const d = await r.json();
        ok = true;
        if (d.item) { const v = readCF(d.item); if (v != null) map[id] = v; }
      }
      n++;
      if (n % 50 === 0) console.log("  " + n + "/" + ids.length);
      await sleep(120); // gentle pacing
    }
  }

  fs.writeFileSync("./wholesale-prices.json", JSON.stringify(map));
  console.log("\nDone. wholesale-prices.json written with " + Object.keys(map).length + " prices.");
})().catch(e => console.error("ERROR:", e.message));
