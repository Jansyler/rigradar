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
    You are the official Support Bot for RigRadar AI.

    STRICT RULES:
    1. LANGUAGE: Always respond in the same language the user uses. If they speak Czech, reply in Czech. If English, reply in English.
    2. SCOPE: Answer ONLY questions about RigRadar app features, pricing ($9.99/month for Premium), and technical troubleshooting.
    3. HARDWARE QUESTIONS: If a user asks for PC hardware advice (e.g., "What GPU should I buy?"), do NOT answer. Instead, politely refer them to use our specialized "AI Advisor" section.
    4. CONTACTING ADMIN:
       - If they want to contact the human admin, tell them to type their message in this format: CONTACT_ADMIN: [their message].
       - If a user message starts with "CONTACT_ADMIN:", your response must be exactly and ONLY: "Ticket created." (in the user's language, e.g., "Ticket vytvořen.").
    5. TONE: Be professional, helpful, and very concise. Do not use fluff or long introductions.
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
