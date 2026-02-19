import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, stores, ownerEmail } = req.body;
  
  if (!query) return res.status(400).json({ error: 'Query is required' });

  // 1. Rate Limiting (Ochrana proti spamu - 2 requesty za 15s)
  const ip = req.headers['x-forwarded-for'] || 'unknown_ip';
  const rateLimitKey = `rate_limit:${ip}`;

  try {
    const requests = await redis.incr(rateLimitKey);
    if (requests === 1) {
        await redis.expire(rateLimitKey, 15);
    }
    if (requests > 2) {
        return res.status(429).json({ error: 'Wait 15s before next scan!' });
    }

    // 2. Příprava dat pro Python (radar.py)
    const task = JSON.stringify({
      query: query,
      stores: stores && stores.length > 0 ? stores : ['ebay'],
      ownerEmail: ownerEmail || 'system',
      timestamp: Date.now(),
      priority: true,
      source: 'user_request'
    });

    // 3. Odeslání do fronty (OPRAVENO: používáme task, ne payload)
    await redis.rpush('scan_queue', task);

    return res.status(200).json({ success: true, message: 'Scan queued' });
  } catch (error) {
    console.error("Redis Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
