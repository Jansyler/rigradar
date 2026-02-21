import { Redis } from '@upstash/redis'
import { GoogleGenerativeAI } from "@google/generative-ai";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    // 1. ZÍSKÁNÍ A OVĚŘENÍ NAŠEHO SESSION TOKENU
    const authHeader = req.headers.authorization;
    let email = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            email = await redis.get(`session:${token}`);
        } catch (e) {
            console.error("Redis session verification failed:", e);
        }
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
                // Pokud frontend žádá o konkrétní chat, pošleme jen jeho zprávy z nového odděleného klíče
                const history = await redis.get(`chat_history:${email}:${chatId}`) || [];
                return res.status(200).json({ history });
            } else {
                // Pokud frontend žádá jen o seznam chatů, pošleme malý JSON pouze s názvy (pro Sidebar)
                const userData = await redis.get(userKey);
                // Pročistíme data pro jistotu
                const safeChats = userData?.chats || {};
                Object.keys(safeChats).forEach(k => delete safeChats[k].history); // Nechceme posílat historii v sidebaru
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
    const currentChatId = chatId || `chat_${Date.now()}`;
    const chatHistoryKey = `chat_history:${email}:${currentChatId}`; // Náš nový, samostatný klíč pro těžká data!

    try {
        // 1. Načtení lehkých uživatelských dat (Metadata)
        let userData = await redis.get(userKey) || { 
            count: 0, 
            isPremium: false, 
            chats: {}, 
            lastReset: Date.now() 
        };
        
        userData.chats = userData.chats || {};
        if (Array.isArray(userData.chats)) userData.chats = {}; 

        // Reset počítadla po 24H
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (userData.lastReset || 0) > ONE_DAY_MS) {
            userData.count = 0;
            userData.lastReset = Date.now();
        }

        // Vytvoříme záznam v Sidebaru pouze s názvem (bez historie)
        if (!userData.chats[currentChatId]) {
            userData.chats[currentChatId] = { title: message.substring(0, 30) + "..." };
        }

        // Kontrola Free limitu
        const DAILY_LIMIT = 5;
        if (!userData.isPremium && userData.count >= DAILY_LIMIT) {
            return res.status(403).json({ 
                text: `Daily limit (${DAILY_LIMIT} messages) reached! Limit resets in 24h or upgrade to Premium.`, 
                limitReached: true 
            });
        }

        // 2. NAČTENÍ HISTORIE (Z nového samostatného klíče)
        let chatHistory = await redis.get(chatHistoryKey);
        
        // 🚨 MIGRAČNÍ POJISTKA: Pokud chat existoval po starém způsobu, přesuneme ho!
        if (!chatHistory && userData.chats[currentChatId]?.history) {
            chatHistory = userData.chats[currentChatId].history;
            delete userData.chats[currentChatId].history; // Smažeme ho ze starého místa, aby odlehčil hlavní JSON
        }
        chatHistory = chatHistory || [];

        // 3. Volání AI s historií
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const formattedHistory = chatHistory.map(msg => ({
            role: msg.role === 'ai' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(`Respond in ${lang || 'en'}. User: ${message}`);
        const aiResponse = result.response.text();

        // 4. Uložení zpráv DO ODDĚLENÉHO POLE
        chatHistory.push({ role: 'user', text: message });
        chatHistory.push({ role: 'ai', text: aiResponse });

        if (!userData.isPremium) userData.count += 1;
        
        // 5. PARALELNÍ ULOŽENÍ DO DATABÁZE (Rychlejší chod)
        await Promise.all([
            redis.set(userKey, userData),             // Uložíme jen malá metadata a seznam panelů
            redis.set(chatHistoryKey, chatHistory)    // Uložíme obří historii zpráv vedle
        ]);

        res.status(200).json({ text: aiResponse, chatId: currentChatId });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ text: "System overload. Try again later." });
    }
}
