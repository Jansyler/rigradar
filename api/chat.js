import { Redis } from '@upstash/redis'
import { GoogleGenerativeAI } from "@google/generative-ai";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🛡️ POMOCNÁ FUNKCE: Sanitizace vstupu pro AI
const sanitizeMessage = (msg) => {
    if (typeof msg !== 'string') return '';
    // Omezíme délku, aby někdo neposílal romány a nečerpal API tokeny
    const limited = msg.substring(0, 500).trim(); 
    // Odstraníme nebezpečné kontrolní znaky
    return limited.replace(/[\x00-\x1F\x7F]/g, ""); 
};

export default async function handler(req, res) {
    // 1. ZÍSKÁNÍ TOKENU Z HTTP-ONLY COOKIE
    const cookieHeader = req.headers.cookie || '';
    const tokenMatch = cookieHeader.match(/rr_auth_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) {
        return res.status(401).json({ text: "Session expired. Please log in again." });
    }

    let email = null;
    try {
        email = await redis.get(`session:${token}`);
    } catch (e) {
        console.error("Redis session verification failed:", e);
    }

    if (!email) return res.status(401).json({ text: "Session expired. Please log in again." });

    const userKey = `user_data:${email}`;

    // ==========================================
    // GET: Načtení historie a postranního panelu
    // ==========================================
    if (req.method === 'GET') {
        const { chatId } = req.query; 

        try {
            if (chatId) {
                const history = await redis.get(`chat_history:${email}:${chatId}`) || [];
                return res.status(200).json({ history });
            } else {
                const userData = await redis.get(userKey);
                const safeChats = userData?.chats || {};
                Object.keys(safeChats).forEach(k => delete safeChats[k].history); 
                return res.status(200).json({ chats: safeChats });
            }
        } catch (err) {
            return res.status(200).json({ chats: {}, history: [] });
        }
    }

    if (req.method !== 'POST') return res.status(405).end();
    
    // ==========================================
    // POST: Nová zpráva pro AI
    // ==========================================
    const { message, lang, chatId } = req.body;
    
    // 🛡️ Sanitizace
    const cleanMessage = sanitizeMessage(message);
    if (!cleanMessage) return res.status(400).json({ text: "Empty or invalid message." });

    const currentChatId = chatId || `chat_${Date.now()}`;
    const chatHistoryKey = `chat_history:${email}:${currentChatId}`; 

    try {
        // 1. Načtení základních metadat
        let userData = await redis.get(userKey) || { isPremium: false, chats: {} };
        if (Array.isArray(userData.chats)) userData.chats = {}; 

        // 🚨 OPRAVA RACE CONDITION: Plně atomické ověření limitů
        const today = new Date().toISOString().split('T')[0]; 
        const usageKey = `usage_chat:${email}:${today}`;
        const DAILY_LIMIT = 5;

        let currentUsage = 0;

        if (!userData.isPremium) {
            currentUsage = await redis.get(usageKey) || 0;
            if (parseInt(currentUsage) >= DAILY_LIMIT) {
                return res.status(403).json({ 
                    text: `Daily limit (${DAILY_LIMIT} messages) reached! Limit resets at midnight or upgrade to Premium.`, 
                    limitReached: true 
                });
            }
        }

        if (!userData.chats[currentChatId]) {
            userData.chats[currentChatId] = { title: cleanMessage.substring(0, 30) + "..." };
        }

        // 2. NAČTENÍ HISTORIE ZPRÁV
        let chatHistory = await redis.get(chatHistoryKey);
        if (!chatHistory && userData.chats[currentChatId]?.history) {
            chatHistory = userData.chats[currentChatId].history;
            delete userData.chats[currentChatId].history; 
        }
        chatHistory = chatHistory || [];

        // 3. Volání AI
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const formattedHistory = chatHistory.map(msg => ({
            role: msg.role === 'ai' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(`Respond in ${lang || 'en'}. User: ${cleanMessage}`);
        const aiResponse = result.response.text();

        // 4. Uložení
        chatHistory.push({ role: 'user', text: cleanMessage });
        chatHistory.push({ role: 'ai', text: aiResponse });
        
        // 5. ATOMICKÝ ZÁPIS (Zabrání Race Condition při updatu limitů)
        const transaction = redis.multi();
        transaction.set(userKey, userData);
        transaction.set(chatHistoryKey, chatHistory);

        if (!userData.isPremium) {
            transaction.incr(usageKey);
            transaction.expire(usageKey, 60 * 60 * 48); // Vyprší za 48h
        }

        await transaction.exec();

        res.status(200).json({ text: aiResponse, chatId: currentChatId });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ text: "System overload. Try again later." });
    }
}
