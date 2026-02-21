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
        let userData = await redis.get(userKey) || { 
            count: 0, 
            isPremium: false, 
            chats: {}, 
            lastReset: Date.now() 
        };
        
        if (Array.isArray(userData.chats)) userData.chats = {}; 

        // 1. RESET POČÍTADLA PO 24 HODINÁCH
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (userData.lastReset || 0) > ONE_DAY_MS) {
            userData.count = 0;
            userData.lastReset = Date.now();
        }

        // Inicializace chatu, pokud neexistuje
        if (!userData.chats[currentChatId]) {
            userData.chats[currentChatId] = { title: message.substring(0, 30) + "...", history: [] };
        }

        // 2. KONTROLA LIMITU
        const DAILY_LIMIT = 5;
        if (!userData.isPremium && userData.count >= DAILY_LIMIT) {
            return res.status(403).json({ 
                text: `Daily limit (${DAILY_LIMIT} messages) reached! Limit resets in 24h or upgrade to Premium.`, 
                limitReached: true 
            });
        }

        // --- 3. OPRAVA: PAMĚŤ PRO AI ---
        // Vezmeme posledních 10 zpráv z Redis, aby AI mělo kontext (paměť), ale nepřetekl limit
        const pastMessages = userData.chats[currentChatId].history.slice(-10);
        const formattedHistory = pastMessages.map(msg => ({
            role: msg.role === 'ai' ? 'model' : 'user',
            parts: [{ text: msg.text || "" }]
        }));

        // Změna na 1.5-flash kvůli občasným chybám s 2.0 stringem v Node SDK
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // Vytvoříme konverzaci včetně předchozí historie
        const chat = model.startChat({
            history: formattedHistory
        });

        // AI nyní ví, o čem jste se bavili dřív!
        const result = await chat.sendMessage(`Respond in ${lang || 'en'}. User says: ${message}`);
        let aiResponse = "";
        
        try {
            aiResponse = result.response.text();
        } catch (safetyError) {
            console.error("Gemini blokace textu:", safetyError);
            aiResponse = "I'm sorry, but I cannot process that specific request due to safety filters or content size limits. Try shortening your message.";
        }

        // Uložení historie do databáze
        userData.chats[currentChatId].history.push({ role: 'user', text: message });
        userData.chats[currentChatId].history.push({ role: 'ai', text: aiResponse });

        // Inkrementace počítadla (pouze pro free)
        if (!userData.isPremium) {
            userData.count += 1;
        }
        
        await redis.set(userKey, userData);
        res.status(200).json({ text: aiResponse, chatId: currentChatId });

    } catch (error) {
        // Sem to spadne jen při kritické chybě (např. chyba Redis nebo úplný pád Vercelu)
        console.error("Critical Backend Error:", error);
        res.status(500).json({ text: "Backend service error. Please try refreshing the page." });
    }
}
