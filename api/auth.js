import { Redis } from '@upstash/redis'
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto'; // Zabudováno v Node.js, bezpečné šifrování

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const authClient = new OAuth2Client();

// Funkce pro vygenerování a uložení relace na 7 dní
const generateSession = async (email) => {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await redis.set(`session:${sessionToken}`, email, { ex: 60 * 60 * 24 * 7 });
    return sessionToken;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { action } = req.query; // ?action=login | register | google

    try {
        // --- 1. GOOGLE LOGIN ---
        if (action === 'google') {
            const { idToken } = req.body;
            const ticket = await authClient.verifyIdToken({
                idToken,
                audience: "636272588894-duknv543nso4j9sj4j2d1qkq6tc690gf.apps.googleusercontent.com",
            });
            const email = ticket.getPayload().email;
            
            const sessionToken = await generateSession(email);
            return res.status(200).json({ token: sessionToken, email });
        }
        
        // --- 2. VLASTNÍ REGISTRACE ---
        if (action === 'register') {
            const { email, password } = req.body;
            if (!email || !password || password.length < 6) {
                return res.status(400).json({ error: "Invalid email or password too short (min 6 chars)" });
            }

            // Kontrola, zda uživatel neexistuje
            const existing = await redis.get(`user_auth:${email}`);
            if (existing) return res.status(400).json({ error: "User already exists. Please log in." });
            
            // Zašifrování hesla (Salt + Hash)
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync(password, salt, 64).toString('hex');
            
            // Uložení hesla do databáze
            await redis.set(`user_auth:${email}`, `${salt}:${hash}`);
            
            const sessionToken = await generateSession(email);
            return res.status(200).json({ token: sessionToken, email });
        }

        // --- 3. VLASTNÍ PŘIHLÁŠENÍ ---
        if (action === 'login') {
            const { email, password } = req.body;
            
            const stored = await redis.get(`user_auth:${email}`);
            if (!stored) return res.status(400).json({ error: "Invalid credentials" });
            
            const [salt, key] = stored.split(':');
            const hashedBuffer = crypto.scryptSync(password, salt, 64);
            
            if (key !== hashedBuffer.toString('hex')) {
                return res.status(400).json({ error: "Invalid credentials" });
            }
            
            const sessionToken = await generateSession(email);
            return res.status(200).json({ token: sessionToken, email });
        }

        res.status(400).json({ error: "Unknown action" });

    } catch (error) {
        console.error("Auth API Error:", error);
        res.status(500).json({ error: "Authentication failed. Try again." });
    }
}
