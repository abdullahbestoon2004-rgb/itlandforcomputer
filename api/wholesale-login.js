import { loadClients, findClient, toClientProfile } from '../lib/clients.js';

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

  const client = findClient(loadClients(process.env), email, password);

  if (!client) {
    return res.status(401).json({ error: 'Invalid email/username or password' });
  }

  return res.status(200).json({ success: true, client: toClientProfile(client) });
}
