import { Redis } from '@upstash/redis'
import { GoogleGenerativeAI } from "@google/generative-ai";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    // --- 1. ANTI-SPAM OCHRANA (Rate Limiting) ---
    const ip = req.headers['x-forwarded-for'] || 'unknown_ip';
    const rateLimitKey = `support_limit:${ip}`;
    
    // Zvýšíme počítadlo
    const requests = await redis.incr(rateLimitKey);
    
    // Pokud je to první request, nastavíme expiraci na 10 minut (600s)
    if (requests === 1) {
        await redis.expire(rateLimitKey, 600);
    }

    // Limit: 5 zpráv za 10 minut
    if (requests > 5) {
        return res.status(429).json({ 
            text: "⚠️ You're too fast. Support Bot needs to rest. Try again in a moment." 
        });
    }
    // -------------------------------------------

    const { message, history } = req.body;

    const systemPrompt = `
    Jsi Support Bot pro aplikaci RigRadar AI.
    Tvé úkoly:
    1. Answer ONLY questions about the app's features, pricing ($9.99 for Premium), and troubleshooting.
    2. If a user asks about hardware, refer them to the "AI Advisor" section.
    3. If they want to contact the admin, tell them to write a message here.
    4. If a user writes "CONTACT_ADMIN: [message]", reply: "Ticket created."
    5. Be concise.
    `;

    try {
        if (message.toLowerCase().includes("kontakt") || message.toLowerCase().includes("problem")) {
            await redis.lpush('support_tickets', JSON.stringify({
                text: message,
                date: new Date().toISOString(),
                ip: ip // Uložíme i IP pro kontrolu
            }));
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Ok." }] },
                ...(history || []).map(h => ({ role: h.role === 'ai' ? 'model' : 'user', parts: [{ text: h.text }] }))
            ],
        });

        const result = await chat.sendMessage(message);
        const response = result.response.text();

        res.status(200).json({ text: response });

    } catch (error) {
        console.error("Bot Error:", error);
        res.status(500).json({ text: "I apologize, I am experiencing connection issues." });
    }
}
