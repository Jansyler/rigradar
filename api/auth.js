import { Redis } from '@upstash/redis'
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const authClient = new OAuth2Client();

const generateSession = async (email) => {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await redis.set(`session:${sessionToken}`, email, { ex: 60 * 60 * 24 * 7 });
    return sessionToken;
};

export default async function handler(req, res) {
    const { action } = req.query;

    try {
if (req.method === 'GET' && action === 'github_callback') {
            const { code } = req.query;
            if (!code) return res.status(400).send("No code provided by GitHub.");

            // A) Výměna kódu za GitHub Access Token
            const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: process.env.GITHUB_CLIENT_ID,
                    client_secret: process.env.GITHUB_CLIENT_SECRET,
                    code: code
                })
            });
            
            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;
            if (!accessToken) return res.status(400).send("GitHub authentication failed.");

            // --- TADY JE TA ZMĚNA: Získání dat o uživateli (včetně fotky) ---
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'RigRadar-App'
                }
            });
            const userData = await userResponse.json();
            const githubPic = userData.avatar_url; // Získání URL profilovky

            // B) Získání e-mailu uživatele z GitHubu
            const emailResponse = await fetch('https://api.github.com/user/emails', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'RigRadar-App'
                }
            });
            
            const emails = await emailResponse.json();
            const primaryEmailObj = emails.find(e => e.primary && e.verified) || emails[0];
            if (!primaryEmailObj || !primaryEmailObj.email) {
                return res.status(400).send("No valid email found on your GitHub account.");
            }

            const email = primaryEmailObj.email;

            // C) Vytvoření naší RigRadar Session v Redisu
            const sessionToken = await generateSession(email);

            // D) Přesměrování zpět s tokenem, emailem A NOVĚ I S FOTKOU v URL
            return res.redirect(`/chat.html?token=${sessionToken}&email=${encodeURIComponent(email)}&pic=${encodeURIComponent(githubPic)}`);
        }

        // --- VŠECHNY OSTATNÍ AKCE MUSÍ BÝT POST ---
        if (req.method !== 'POST') return res.status(405).end();

        // --- 2. GOOGLE LOGIN ---
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
        
        // --- 3. VLASTNÍ REGISTRACE ---
        if (action === 'register') {
            const { email, password } = req.body;
            if (!email || !password || password.length < 6) {
                return res.status(400).json({ error: "Invalid email or password too short (min 6 chars)" });
            }

            const existing = await redis.get(`user_auth:${email}`);
            if (existing) return res.status(400).json({ error: "User already exists. Please log in." });
            
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync(password, salt, 64).toString('hex');
            
            await redis.set(`user_auth:${email}`, `${salt}:${hash}`);
            
            const sessionToken = await generateSession(email);
            return res.status(200).json({ token: sessionToken, email });
        }

        // --- 4. VLASTNÍ PŘIHLÁŠENÍ ---
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
        res.status(500).json({ error: "Authentication failed." });
    }
}
