import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    // 1. ZÍSKÁNÍ A OVĚŘENÍ TVÉHO SESSION TOKENU
    const authHeader = req.headers.authorization;
    let verifiedEmail = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            // Najdeme email v databázi podle tokenu
            verifiedEmail = await redis.get(`session:${token}`);
        } catch (e) {
            console.error("Redis verification failed:", e);
        }
    }

    // Pokud nemáme ověřený email, nepustíme ho dál
    if (!verifiedEmail) {
        return res.status(401).json({ error: 'Unauthorized. Please log in again.' });
    }

    const { dealId } = req.body; // Email už z těla nepotřebujeme, máme ho z Redisu!
    if (!dealId) return res.status(400).json({ error: 'Missing dealId' });

    try {
        const savedKey = `saved_scans:${verifiedEmail}`;
        
        // 2. Načteme všechny uložené scany
        const currentSaved = await redis.lrange(savedKey, 0, -1);
        
        // 3. Vyfiltrujeme ten, který chceme smazat (převádíme na String pro 100% shodu)
        const newSavedList = currentSaved.filter(item => {
            try {
                const parsed = typeof item === 'string' ? JSON.parse(item) : item;
                return String(parsed.id) !== String(dealId); 
            } catch (e) { 
                return true; 
            }
        });

        // 4. Pokud se délka seznamu nezměnila, nic jsme nesmazali
        if (currentSaved.length === newSavedList.length) {
             return res.status(200).json({ status: 'Not found or already deleted' });
        }

        // 5. Přepíšeme seznam v Redisu
        await redis.del(savedKey); 
        
        if (newSavedList.length > 0) {
            // Použijeme rpush pro zachování pořadí. 
            // Důležité: Upstash Redis rpush s rozbaleným polem (...list) funguje skvěle.
            await redis.rpush(savedKey, ...newSavedList);
        }
        
        return res.status(200).json({ status: 'Deleted' });

    } catch (error) {
        console.error("Unsave Error:", error);
        return res.status(500).json({ error: 'Database error' });
    }
}
