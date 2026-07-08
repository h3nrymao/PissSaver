// GET /api/prices — returns the latest price data.
// Serves live-refreshed data from Vercel KV if available, else the base catalogue.
import { kv } from '@vercel/kv';
import { readFileSync } from 'fs';
import { join } from 'path';
const base = JSON.parse(readFileSync(join(process.cwd(), 'data', 'products.json'), 'utf8'));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
  try {
    const live = await kv.get('prices');
    if (live && Array.isArray(live) && live.length) {
      return res.status(200).json({ source: 'live', updated: await kv.get('prices_updated'), products: live });
    }
  } catch (e) { /* KV not configured — fall through */ }
  return res.status(200).json({ source: 'base', updated: null, products: base });
}
