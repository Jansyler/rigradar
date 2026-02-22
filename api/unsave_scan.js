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

    const { dealId } = req.body; 
    if (!dealId) return res.status(400).json({ error: 'Missing dealId' });

    try {
        const savedKey = `saved_scans:${verifiedEmail}`;
        const currentSaved = await redis.lrange(savedKey, 0, -1);
        
        const newSavedList = currentSaved.filter(item => {
            try {
                const parsed = typeof item === 'string' ? JSON.parse(item) : item;
                return String(parsed.id) !== String(dealId); 
            } catch (e) { return true; }
        });

        if (currentSaved.length === newSavedList.length) {
             return res.status(200).json({ status: 'Not found or already deleted' });
        }

        await redis.del(savedKey); 
        
        if (newSavedList.length > 0) {
            await redis.rpush(savedKey, ...newSavedList);
        }
        
        return res.status(200).json({ status: 'Deleted' });

    } catch (error) {
        console.error("Unsave Error:", error);
        return res.status(500).json({ error: 'Database error' });
    }
}
