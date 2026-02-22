import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// 🛡️ POMOCNÁ FUNKCE: Ochrana proti Prompt Injection
const sanitizeQuery = (q) => {
    if (typeof q !== 'string') return '';
    // Povolí jen písmena, čísla, mezery a základní znaky pro hardware (např. +, -, .)
    // Odstraní různé speciální znaky používané pro "Jailbreak" AI
    let cleaned = q.replace(/[^a-zA-Z0-9\s\-\.\+]/g, '').trim();
    // Omezí délku na 60 znaků (zabrání zaspamování AI obrovským textem)
    return cleaned.substring(0, 60);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. ZÍSKÁNÍ TOKENU Z HTTP-ONLY COOKIE (Už nevěříme hlavičce z frontendu)
  const cookieHeader = req.headers.cookie || '';
  const tokenMatch = cookieHeader.match(/rr_auth_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (!token) {
      return res.status(401).json({ error: "Unauthorized. Please log in." });
  }

  // Ověření session v Redisu
  let verifiedEmail = null;
  try {
      verifiedEmail = await redis.get(`session:${token}`);
  } catch (e) {
      console.error("Session verification failed:", e);
  }

  if (!verifiedEmail) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
  }

  // 2. NAČTENÍ A SANITIZACE VSTUPŮ
  // Poznámka: ownerEmail už od frontendu nebereme, použijeme verifiedEmail!
  const { query, stores, condition, minPrice, maxPrice } = req.body;
  
  const cleanQuery = sanitizeQuery(query);
  if (!cleanQuery || cleanQuery.length < 2) {
      return res.status(400).json({ error: 'Invalid or too short search query.' });
  }

  // Očištění a validace obchodů
  const allowedStores = ['ebay', 'amazon', 'alza', 'bazos'];
  let cleanStores = Array.isArray(stores) ? stores.map(s => String(s).toLowerCase()) : ['ebay'];
  cleanStores = cleanStores.filter(s => allowedStores.includes(s));
  if (cleanStores.length === 0) cleanStores = ['ebay'];

  // Očištění podmínek
  const validConditions = ['any', 'new', 'used'];
  const cleanCondition = validConditions.includes(condition) ? condition : 'any';

  // Očištění cen
  const cleanMin = minPrice ? Math.abs(Number(minPrice)) : null;
  const cleanMax = maxPrice ? Math.abs(Number(maxPrice)) : null;

  // 3. KONTROLA PREMIUM LIMITŮ
  try {
    const premiumData = await redis.get(`premium:${verifiedEmail}`);
    const isPremium = premiumData ? premiumData.isActive === true : false;

    // Pokud NENÍ premium a chce skenovat Amazon nebo Alzu -> ZAMÍTNOUT
    if (!isPremium) {
        const premiumStores = ['amazon', 'alza'];
        const wantsPremiumStore = cleanStores.some(store => premiumStores.includes(store));
        
        if (wantsPremiumStore) {
            return res.status(403).json({ 
                error: 'Amazon and Alza are available for Premium users only. Upgrade to access.' 
            });
        }
    }

    // 4. ODESLÁNÍ DO FRONTY PRO PYTHON WORKER
    const task = JSON.stringify({
      query: cleanQuery,
      stores: cleanStores,
      ownerEmail: verifiedEmail, // Bezpečně z naší DB!
      condition: cleanCondition,
      minPrice: cleanMin,
      maxPrice: cleanMax,
      timestamp: Date.now(),
      priority: isPremium,
      source: 'user_request'
    });

    await redis.rpush('scan_queue', task);
    return res.status(200).json({ success: true, message: 'Scan queued successfully' });

  } catch (error) {
    console.error("Database/Queue Error:", error);
    return res.status(500).json({ error: "Service unavailable. Try again later." });
  }
}
