const ZOHO_AUTH_DOMAIN = process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.com';

export default async function handler(req, res) {
  // CORS & Content-Type
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let code = req.query.code;
  let clientId = req.query.client_id || process.env.ZOHO_CLIENT_ID;
  let clientSecret = req.query.client_secret || process.env.ZOHO_CLIENT_SECRET;

  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyStr = Buffer.concat(chunks).toString();
    const params = new URLSearchParams(bodyStr);
    code = params.get('code') || code;
    clientId = params.get('client_id') || clientId;
    clientSecret = params.get('client_secret') || clientSecret;
  }

  // If no code submitted yet, show interactive token generator form
  if (!code) {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Zoho Token Generator</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #FAF8F5; color: #17130E; padding: 40px 20px; }
          .card { max-width: 540px; margin: 0 auto; background: #fff; border: 2px solid #17130E; border-radius: 18px; padding: 32px; box-shadow: 6px 6px 0 #17130E; }
          h2 { margin-top: 0; font-size: 22px; }
          label { display: block; font-weight: 700; font-size: 13px; margin: 14px 0 6px; }
          input { width: 100%; padding: 12px; font-size: 14px; border: 1.5px solid #D6CDBB; border-radius: 10px; box-sizing: border-box; font-family: monospace; }
          button { width: 100%; margin-top: 22px; padding: 14px; background: #17130E; color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
          .hint { font-size: 12.5px; color: #776E62; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔑 Get Zoho Refresh Token</h2>
          <p style="font-size: 14px; color: #555;">Fill in the Client ID & Secret from your <b>Self Client</b> tab, along with your fresh Code:</p>
          <form method="POST">
            <label>1. Client ID (from Client Secret tab)</label>
            <input type="text" name="client_id" value="${clientId || ''}" placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXX" required />

            <label>2. Client Secret (from Client Secret tab)</label>
            <input type="password" name="client_secret" value="${clientSecret || ''}" placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" required />

            <label>3. Fresh Code (from Generate Code button)</label>
            <input type="text" name="code" placeholder="1000.xxxxxxxxxxxxxxxxxxxxxxxx" required />
            <div class="hint">Codes expire in 3–5 minutes. Paste it right after generating.</div>

            <button type="submit">Generate Refresh Token</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const tokenRes = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        code: code.trim(),
      }).toString(),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #DE3A1E;">❌ Zoho Error</h2>
          <pre style="background: #FFF0ED; border: 1.5px solid #F9C5BB; padding: 16px; border-radius: 12px; overflow-x: auto;">${JSON.stringify(data, null, 2)}</pre>
          <p>Make sure the <b>Client ID</b> and <b>Client Secret</b> match the exact application ("Self Client") where you generated the code.</p>
          <a href="/api/zoho-callback" style="display: inline-block; padding: 10px 18px; background: #17130E; color: #fff; text-decoration: none; border-radius: 8px;">Try Again</a>
        </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1F9D57;">✅ Success! Here is your ZOHO_REFRESH_TOKEN:</h2>
        <textarea style="width: 100%; height: 80px; font-size: 14px; padding: 12px; border: 2px solid #17130E; border-radius: 10px; font-family: monospace;" readonly onclick="this.select()">${data.refresh_token}</textarea>
        <p>1. Copy the refresh token above.</p>
        <p>2. Go to Vercel $\\rightarrow$ Settings $\\rightarrow$ Environment Variables $\\rightarrow$ set <b>ZOHO_REFRESH_TOKEN</b> to this value.</p>
        <p>3. Also make sure <b>ZOHO_CLIENT_ID</b> is set to: <code>${clientId}</code></p>
        <p>4. Also make sure <b>ZOHO_CLIENT_SECRET</b> is set to: <code>${clientSecret}</code></p>
        <p>5. Click <b>Redeploy</b> in Vercel!</p>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(`<h2>Error</h2><p>${err.message}</p>`);
  }
}
