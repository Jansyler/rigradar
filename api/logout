export default function handler(req, res) {
    // Povolíme pouze POST požadavky
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Nastaví expiraci cookie 'rr_auth_token' do roku 1970, čímž ji prohlížeč okamžitě vymaže.
    // Důležité: Musí se shodovat vlastnosti (Path, HttpOnly, Secure), se kterými byla vytvořena.
    res.setHeader(
        'Set-Cookie', 
        'rr_auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    );
    
    return res.status(200).json({ message: 'Logged out successfully' });
}
