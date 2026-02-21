import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. ZÍSKÁNÍ A OVĚŘENÍ RELACE PŘES NAŠI REDIS DATABÁZI
  const authHeader = req.headers.authorization;
  let verifiedEmail = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      verifiedEmail = await redis.get(`session:${token}`);
  }

  if (!verifiedEmail) {
      return res.status(401).json({ error: "Unauthorized. Please log in." });
  }

  const { query, stores, ownerEmail, condition, minPrice, maxPrice } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  // Bezpečnostní pojistka: uživatel může skenovat jen pod svým emailem
  if (ownerEmail !== verifiedEmail) {
      return res.status(403).json({ error: "Forbidden. Email mismatch." });
  }

  // 2. KONTROLA PREMIUM LIMITŮ
  // Zjistíme z databáze, zda má uživatel zaplaceno Premium
  const userData = await redis.get(`user_data:${verifiedEmail}`) || {};
  const isPremium = userData.isPremium === true;

  // Vyžádané obchody (pokud nevybere, dáme eBay)
  const requestedStores = stores && stores.length > 0 ? stores : ['ebay'];

  // Pokud NENÍ premium a chce skenovat Amazon nebo Alzu -> ZAMÍTNOUT
  if (!isPremium) {
      const premiumStores = ['amazon', 'alza'];
      const wantsPremiumStore = requestedStores.some(store => premiumStores.includes(store.toLowerCase()));
      
      if (wantsPremiumStore) {
          return res.status(403).json({ 
              error: 'Amazon and Alza are available for Premium users only. Upgrade to access.' 
          });
      }
  }

  // 3. Odeslání do fronty (do Pythonu)
  try {
    const task = JSON.stringify({
      query: query,
      stores: requestedStores,
      ownerEmail: verifiedEmail,
      condition: condition || 'any',
      minPrice: minPrice || null,
      maxPrice: maxPrice || null,
      timestamp: Date.now(),
      priority: isPremium, // Premium uživatelé mají přednost ve frontě!
      source: 'user_request'
    });

    await redis.rpush('scan_queue', task);
    return res.status(200).json({ success: true, message: 'Scan queued successfully' });

  } catch (error) {
    console.error("Redis Error:", error);
    return res.status(500).json({ error: "Database error." });
  }
}
