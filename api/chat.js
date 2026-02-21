import { Redis } from '@upstash/redis'
import { GoogleGenerativeAI } from "@google/generative-ai";
import { OAuth2Client } from 'google-auth-library';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const authClient = new OAuth2Client();

export default async function handler(req, res) {
    // 1. ZÍSKÁNÍ A OVĚŘENÍ TOKENU
    const authHeader = req.headers.authorization;
    let email = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const ticket = await authClient.verifyIdToken({
                idToken: token,
                // Ujisti se, že toto Client ID odpovídá tomu v auth.js / Google Cloud Console
                audience: "636272588894-duknv543nso4j9sj4j2d1qkq6tc690gf.apps.googleusercontent.com", 
            });
            const payload = ticket.getPayload();
            email = payload.email;
        } catch (e) {
            console.error("Token verification failed:", e);
            return res.status(401).json({ text: "Session expired. Please log in again." });
        }
    }

    if (!email) return res.status(401).json({ text: "Unauthorized: Please log in." });

    const userKey = `user_data:${email}`;

    // GET: Načtení historie
    if (req.method === 'GET') {
        try {
            const userData = await redis.get(userKey);
            return res.status(200).json({ chats: userData?.chats || {} });
        } catch (err) {
            return res.status(200).json({ chats: {} });
        }
    }

    if (req.method !== 'POST') return res.status(405).end();
    
    const { message, lang, chatId } = req.body;
    const currentChatId = chatId || `chat_${Date.now()}`;

    try {
        // Načtení dat uživatele nebo inicializace s lastReset
        let userData = await redis.get(userKey) || { 
            count: 0, 
            isPremium: false, 
            chats: {}, 
            lastReset: Date.now() 
        };
        
        if (Array.isArray(userData.chats)) userData.chats = {}; 

        // 1. RESET POČÍTADLA PO 24 HODINÁCH (OPRAVA)
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (userData.lastReset || 0) > ONE_DAY_MS) {
            userData.count = 0;
            userData.lastReset = Date.now();
        }

        // Inicializace chatu, pokud neexistuje
        if (!userData.chats[currentChatId]) {
            userData.chats[currentChatId] = { title: message.substring(0, 30) + "...", history: [] };
        }

        // 2. KONTROLA LIMITU (např. 5 zpráv denně pro free)
        const DAILY_LIMIT = 5;
        if (!userData.isPremium && userData.count >= DAILY_LIMIT) {
            return res.status(403).json({ 
                text: `Daily limit (${DAILY_LIMIT} messages) reached! Limit resets in 24h or upgrade to Premium.`, 
                limitReached: true 
            });
        }

        // AI Generování
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Respond in ${lang || 'en'}. User: ${message}`);
        const aiResponse = result.response.text();

        // Uložení historie
        userData.chats[currentChatId].history.push({ role: 'user', text: message });
        userData.chats[currentChatId].history.push({ role: 'ai', text: aiResponse });

        // Inkrementace počítadla (pouze pro free)
        if (!userData.isPremium) {
            userData.count += 1;
        }
        
        // Uložení zpět do Redis
        await redis.set(userKey, userData);
        res.status(200).json({ text: aiResponse, chatId: currentChatId });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ text: "System overload. Try again later." });
    }
}
