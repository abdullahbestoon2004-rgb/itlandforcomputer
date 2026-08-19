export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  let clients = [];
  try {
    const raw = process.env.WHOLESALE_CLIENTS;
    clients = raw ? JSON.parse(raw) : [];
  } catch {
    clients = [];
  }
  if (!clients || !clients.length) {
    clients = [{ username: 'itland', email: 'itland', password: 'itland123', name: 'iTLand Client' }];
  }

  const input = email.toLowerCase().trim();
  const client = clients.find(
    (c) =>
      (c.email?.toLowerCase().trim() === input || c.username?.toLowerCase().trim() === input) &&
      c.password === password,
  );

  if (!client) {
    return res.status(401).json({ error: 'Invalid email/username or password' });
  }

  return res.status(200).json({
    success: true,
    client: { name: client.name ?? client.username ?? 'Client', company: client.company ?? null, email: client.email ?? client.username },
  });
}
