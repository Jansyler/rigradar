import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    // 1. ZÍSKÁNÍ A OVĚŘENÍ RELACE PŘES REDIS
    const authHeader = req.headers.authorization;
    let verifiedEmail = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            verifiedEmail = await redis.get(`session:${token}`);
        } catch (e) {
            console.error("Redis session verification failed:", e);
        }
    }

    // Pokud token neexistuje, je neplatný nebo ho poslal starý kód
    if (!verifiedEmail) {
        return res.status(401).json({ error: "Unauthorized. Please log in." });
    }

    // 2. KONTROLA PREMIUM STATUSU
    try {
        const userData = await redis.get(`user_data:${verifiedEmail}`) || {};
        const isPremium = userData.isPremium === true; 
        
        return res.status(200).json({ isPremium, email: verifiedEmail });
    } catch (error) {
        return res.status(500).json({ error: "Database error." });
    }
}
