import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. PŘÍJEM DAT Z RADAR.PY (POST) - ZABEZPEČENO
  // ---------------------------------------------------------
  if (req.method === 'POST') {
    const apiKey = req.headers['x-radar-api-key'];
    if (apiKey !== process.env.RADAR_API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized radar node.' });
    }

    // Příjem Heartbeatu (Python hlásí, že žije)
    if (req.body.type === 'heartbeat') {
        await redis.set('system_status', { status: 'online', timestamp: Date.now() });
        return res.status(200).json({ status: 'Heartbeat registered' });
    }

    const { price, title, url, store, opinion, score, type, ownerEmail } = req.body;
    
    if (!price || !opinion) return res.status(400).json({ error: 'Missing data' });

    const newDeal = {
        price, 
        title: title || "Unknown Product",
        url: url || "#",
        store: store || "WEB", 
        opinion,
        score: score || 50,
        type: type || 'HW',
        ownerEmail: ownerEmail || 'system',
        timestamp: Date.now(),
        id: Date.now().toString() 
    };

    try {
        if (!ownerEmail || ownerEmail === 'system') {
            await redis.set('latest_deal', newDeal);
            await redis.lpush('deal_history', JSON.stringify(newDeal));
            await redis.ltrim('deal_history', 0, 19); // MVP: Stačí historie 20 položek
        } else {
            const userHistoryKey = `user_history:${ownerEmail}`;
            await redis.lpush(userHistoryKey, JSON.stringify(newDeal));
            await redis.ltrim(userHistoryKey, 0, 9); // MVP: Uživateli stačí v live feedu 10 položek
        }
        return res.status(200).json({ status: 'Saved' });
    } catch (error) {
        return res.status(500).json({ error: 'Database save failed' });
    }
  }

  // ---------------------------------------------------------
  // 2. NAČÍTÁNÍ DAT PRO FRONTEND (GET) - OPTIMALIZOVÁNO
  // ---------------------------------------------------------
  try {
    const userEmail = req.query.user;

    // OPTIMALIZACE: Stahujeme jen nezbytné minimum položek (místo 20/50 stahujeme 10)
    const promises = [
        redis.get('latest_deal'),            
        redis.lrange('deal_history', 0, 9),  
        redis.get('system_status')           
    ];

    if (userEmail && userEmail !== 'undefined') {
        promises.push(redis.lrange(`user_history:${userEmail}`, 0, 9)); 
      promises.push(redis.lrange(`saved_scans:${userEmail}`, 0, 49));
        // OPTIMALIZACE: Saved Items pro live feed nestahujeme, šetříme RAM a čas
    }

    const results = await Promise.all(promises);
    
    const parseItems = (items) => (items || []).map(item => {
        try { return (typeof item === 'string') ? JSON.parse(item) : item; } catch (e) { return null; }
    }).filter(item => item !== null);

    const publicHistory = parseItems(results[1]);
    const userHistory = results[3] ? parseItems(results[3]) : [];
    const savedItems = results[4] ? parseItems(results[4]) : [];

    // Sloučení a seřazení historie
    let combinedHistory = [...userHistory, ...publicHistory];
    combinedHistory.sort((a, b) => b.timestamp - a.timestamp);

    // Příprava dat pro graf
    const chartData = combinedHistory.map(item => {
      const numericPrice = parseFloat(item.price.replace(',', '.').replace(/[^0-9.]/g, ''));
      return {
          x: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          y: isNaN(numericPrice) ? 0 : numericPrice,
          title: item.title
      };
    }).reverse();

    return res.status(200).json({ 
        latest: results[0] || { price: "---", opinion: "No data", score: 50 },
        history: combinedHistory.slice(0, 10), // Posíláme jen 10 nejčastějších
        chartData: chartData,
      userHistory: userHistory,
        saved: savedItems,
        systemStatus: results[2]
    });

  } catch (error) {
    return res.status(500).json({ error: 'Error loading data' });
  }
}
