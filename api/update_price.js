import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const apiKey = req.headers['x-radar-api-key'];
    if (apiKey !== process.env.RADAR_API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized radar node.' });
    }
    if (req.body.type === 'heartbeat') {
        await redis.set('system_status', { status: 'online', timestamp: Date.now() });
        return res.status(200).json({ status: 'Heartbeat registered' });
    }

    // 🛡️ PŘIDÁNO 'forecast' do destructuringu
    const { price, title, url, store, opinion, score, type, ownerEmail, forecast } = req.body;
    
    if (!price || !opinion) return res.status(400).json({ error: 'Missing data' });
    
    const newDeal = {
        price: String(price),
        title: title || "Unknown Product",
        url: url || "#",
        store: store || "WEB", 
        opinion,
        score: score || 50,
        forecast: forecast || "WAIT", // 🛡️ Uložení předpovědi
        type: type || 'HW',
        ownerEmail: ownerEmail || 'system',
        timestamp: Date.now(),
        id: Date.now().toString() 
    };

    try {
        if (!ownerEmail || ownerEmail === 'system') {
            await redis.set('latest_deal', newDeal);
            // 🛡️ Také ukládáme do globální historie pro Frankensteina
            await redis.lpush('global_history', JSON.stringify(newDeal));
            await redis.ltrim('global_history', 0, 100);

            await redis.lpush('deal_history', JSON.stringify(newDeal));
            await redis.ltrim('deal_history', 0, 19); 
        } else {
            const userHistoryKey = `user_history:${ownerEmail}`;
            await redis.lpush(userHistoryKey, JSON.stringify(newDeal));
            await redis.ltrim(userHistoryKey, 0, 9); 
        }
        return res.status(200).json({ status: 'Saved' });
    } catch (error) {
        console.error("Save Error:", error);
        return res.status(500).json({ error: 'Database save failed' });
    }
  }

  // --- SEKCE GET (Načítání pro frontend) ---
  try {
    const cookieHeader = req.headers.cookie || '';
    const tokenMatch = cookieHeader.match(/rr_auth_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    let userEmail = null;
    if (token) {
        try {
            userEmail = await redis.get(`session:${token}`);
        } catch (e) {
            console.error("Failed to get session from Redis");
        }
    }

    if (!userEmail && req.query.user && req.query.user !== 'undefined') {
        userEmail = req.query.user;
    }

    const promises = [
        redis.get('latest_deal'),            
        redis.lrange('deal_history', 0, 9),  
        redis.get('system_status'),
        redis.get('frankenstein_build') // 🛡️ NAČTENÍ FRANKENSTEINA (Index 3)
    ];
    
    if (userEmail) {
        promises.push(redis.lrange(`user_history:${userEmail}`, 0, 9)); 
        promises.push(redis.lrange(`saved_scans:${userEmail}`, 0, 49));
    }
    
    const results = await Promise.all(promises);
    
    const parseItems = (items) => (items || []).map(item => {
        try { 
            let parsed = (typeof item === 'string') ? JSON.parse(item) : item; 
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            return parsed; 
        } catch (e) { 
            return null; 
        }
    }).filter(item => item !== null && typeof item === 'object');
    
    const publicHistory = parseItems(results[1]);
    const userHistory = results[4] ? parseItems(results[4]) : [];
    const savedItems = results[5] ? parseItems(results[5]) : [];
    
    // 🛡️ ZPRACOVÁNÍ FRANKENSTEINA
    let frankenstein = results[3];
    if (typeof frankenstein === 'string') {
        try { frankenstein = JSON.parse(frankenstein); } catch(e) {}
    }
    
    let combinedHistory = [...userHistory, ...publicHistory];
    combinedHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    const chartData = combinedHistory.map(item => {
      const safePrice = String(item.price || "0"); 
      const numericPrice = parseFloat(safePrice.replace(',', '.').replace(/[^0-9.]/g, ''));
      return {
          x: new Date(item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          y: isNaN(numericPrice) ? 0 : numericPrice,
          title: item.title || "Unknown"
      };
    }).reverse();
    
    let safeLatest = results[0] || { price: "---", opinion: "No data", score: 50 };
    if (typeof safeLatest === 'string') {
        try { safeLatest = JSON.parse(safeLatest); } catch(e) {}
    }
    
    return res.status(200).json({ 
        latest: safeLatest,
        history: combinedHistory.slice(0, 10), 
        chartData: chartData,
        userHistory: userHistory,
        saved: savedItems,
        systemStatus: results[2],
        pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY,
        frankenstein: frankenstein // 🛡️ POSLÁNÍ NA FRONTEND
    });
  } catch (error) {
    console.error("Fetch Error:", error);
    return res.status(500).json({ error: 'Error loading data' });
  }
}
