// GET /api/refresh — refreshes prices by querying retailer search endpoints,
// then stores the result in Vercel KV. Triggered by Vercel Cron (see vercel.json)
// or manually: https://your-app.vercel.app/api/refresh
//
// Notes:
// - Personal / non-commercial use. Be polite: low frequency (cron is 2x daily),
//   sequential requests, small delays.
// - Retailers change or protect their endpoints; each fetcher fails soft.
//   Products keep their previous/base price if a lookup fails.
import { kv } from '@vercel/kv';
import base from '../data/products.json' assert { type: 'json' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Retailer fetchers: (productName) => price|null ----------

// Dan Murphy's — internal product search API
async function danMurphys(name) {
  try {
    const r = await fetch('https://api.danmurphys.com.au/apis/ui/Search/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ SearchTerm: name, PageSize: 1, PageNumber: 1 })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.Bundles?.[0]?.Products?.[0];
    const price = p?.Price ?? p?.Prices?.singleprice?.Value;
    return typeof price === 'number' ? price : null;
  } catch { return null; }
}

// BWS — same platform family as Dan Murphy's (Endeavour Group)
async function bws(name) {
  try {
    const r = await fetch('https://api.bws.com.au/apis/ui/Search/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ SearchTerm: name, PageSize: 1, PageNumber: 1 })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.Bundles?.[0]?.Products?.[0];
    const price = p?.Price ?? p?.Prices?.singleprice?.Value;
    return typeof price === 'number' ? price : null;
  } catch { return null; }
}

// Liquorland / First Choice / Vintage Cellars (Coles Liquor) — HTML fallback:
// fetch the search page and read the embedded __NEXT_DATA__ JSON.
function colesLiquor(host) {
  return async name => {
    try {
      const r = await fetch(`https://${host}/search?q=${encodeURIComponent(name)}`, {
        headers: { 'user-agent': UA, accept: 'text/html' }
      });
      if (!r.ok) return null;
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
      if (!m) return null;
      const j = JSON.parse(m[1]);
      const str = JSON.stringify(j);
      const pm = str.match(/"price":\s*([0-9]+(?:\.[0-9]+)?)/);
      return pm ? parseFloat(pm[1]) : null;
    } catch { return null; }
  };
}

const fetchers = {
  "Dan Murphy's": danMurphys,
  "BWS": bws,
  "Liquorland": colesLiquor('www.liquorland.com.au'),
  "First Choice Liquor": colesLiquor('www.firstchoiceliquor.com.au'),
  "Vintage Cellars": colesLiquor('www.vintagecellars.com.au'),
  // Thirsty Camel, Cellarbrations, Bottlemart, IGA Liquor, Porters, Sip'n Save,
  // The Bottle-O: state-based sites without stable search APIs — prices stay
  // at catalogue values and rely on community submissions.
};

export default async function handler(req, res) {
  const prev = (await kv.get('prices').catch(() => null)) || base;
  const out = [];
  let updatedCount = 0;

  for (const product of prev) {
    const prices = [];
    for (const row of product.prices) {
      const fn = fetchers[row.store];
      let price = row.price;
      if (fn) {
        const live = await fn(product.name);
        if (live && live > 1) { price = live; updatedCount++; }
        await sleep(400); // politeness delay
      }
      prices.push({ ...row, price });
    }
    out.push({ ...product, prices });
  }

  try {
    await kv.set('prices', out);
    await kv.set('prices_updated', new Date().toISOString());
  } catch (e) {
    return res.status(200).json({ ok: false, note: 'KV not configured; refresh ran but was not saved', updatedCount });
  }
  return res.status(200).json({ ok: true, updatedCount, products: out.length });
}
