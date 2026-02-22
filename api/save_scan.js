import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    // 1. ZÍSKÁNÍ TOKENU Z HTTP-ONLY COOKIE
    const cookieHeader = req.headers.cookie || '';
    const tokenMatch = cookieHeader.match(/rr_auth_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) return res.status(401).json({ error: 'Unauthorized. No cookie.' });

    let verifiedEmail = null;
    try {
        verifiedEmail = await redis.get(`session:${token}`);
    } catch (e) {
        console.error("Redis verification failed:", e);
    }

    if (!verifiedEmail) {
        return res.status(401).json({ error: 'Unauthorized. Session expired.' });
    }

    const { deal } = req.body;
    if (!deal || !deal.id) return res.status(400).json({ error: 'Invalid deal data' });

    try {
        const savedKey = `saved_scans:${verifiedEmail}`;
        
        // 2. Načteme existující scany pro kontrolu duplikátů
        const currentSaved = await redis.lrange(savedKey, 0, -1);
        
        // 🛡️ Robustní kontrola duplikátů
        const alreadySaved = currentSaved.some(item => {
            try {
                // Upstash může vrátit objekt nebo string, ošetříme obojí
                const parsed = typeof item === 'string' ? JSON.parse(item) : item;
                return String(parsed.id) === String(deal.id);
            } catch (e) { 
                return false; 
            }
        });

        if (alreadySaved) {
             return res.status(200).json({ status: 'Already saved' });
        }

        // 3. ULOŽENÍ (Důležité: Ukládáme jako STRING, aby lrange fungovalo konzistentně)
        const dealString = JSON.stringify(deal);
        
        // Přidáme na začátek seznamu
        await redis.lpush(savedKey, dealString);
        
        // Omezíme na posledních 50 položek
        await redis.ltrim(savedKey, 0, 49);
        
        return res.status(200).json({ status: 'Saved', id: deal.id });

    } catch (error) {
        console.error("Save Scan Error:", error);
        return res.status(500).json({ error: 'Database error while saving' });
    }
}
