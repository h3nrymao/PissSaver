// GET  /api/community — list community-submitted prices
// POST /api/community — add one: { id, store, suburb, price }
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { id, store, suburb, price } = req.body || {};
    if (!id || !store || !suburb || !price || price <= 0 || String(store).length > 60)
      return res.status(400).json({ error: 'Invalid submission' });
    const list = (await kv.get('community').catch(() => [])) || [];
    list.push({ id: Number(id), store: String(store).slice(0, 60), suburb: String(suburb).slice(0, 60), price: Number(price), at: Date.now() });
    try { await kv.set('community', list.slice(-2000)); } catch { return res.status(200).json({ ok: false, note: 'KV not configured' }); }
    return res.status(200).json({ ok: true });
  }
  const list = (await kv.get('community').catch(() => [])) || [];
  return res.status(200).json(list);
}
