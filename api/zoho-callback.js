const ZOHO_AUTH_DOMAIN = process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.com';

export default async function handler(req, res) {
  const { code } = req.query ?? {};

  if (!code) {
    return res.status(400).send(`
      <h2>Missing Code</h2>
      <p>Pass your generated code from Zoho in the URL: <code>/api/zoho-callback?code=YOUR_CODE_HERE</code></p>
    `);
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send('<h2>Error</h2><p>ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET environment variable is missing on Vercel.</p>');
  }

  try {
    const tokenRes = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: code.trim(),
      }).toString(),
    });

    const data = await tokenRes.json();

    if (!data.refresh_token) {
      return res.status(400).send(`
        <h2>Token Exchange Failed</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <p>Your code might have expired (codes expire after 5-10 minutes). Please generate a new code in Zoho Self Client and try again.</p>
      `);
    }

    return res.status(200).send(`
      <div style="font-family: system-ui, sans-serif; padding: 30px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1F9D57;">Success! Here is your ZOHO_REFRESH_TOKEN:</h2>
        <textarea style="width: 100%; height: 80px; font-size: 14px; padding: 10px;" readonly onclick="this.select()">${data.refresh_token}</textarea>
        <p>Copy this refresh token and update <b>ZOHO_REFRESH_TOKEN</b> in your Vercel Environment Variables, then Redeploy.</p>
      </div>
    `);
  } catch (err) {
    return res.status(500).send(`<h2>Error</h2><p>${err.message}</p>`);
  }
}
