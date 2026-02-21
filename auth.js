// 1. Helper function to decode Google JWT token
function parseJwt(token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(window.atob(base64));
    } catch (e) {
        console.error("Error decoding token:", e);
        return null;
    }
}

// 2. Callback for successful Google Login
async function handleCredentialResponse(response) {
    const payload = parseJwt(response.credential);
    if (payload) {
        localStorage.setItem('rr_user_email', payload.email);
        localStorage.setItem('rr_user_pic', payload.picture);
        localStorage.setItem('rr_auth_token', response.credential);
        
        // IHNED po přihlášení zkontrolujeme Premium status
        await syncPremiumStatus(response.credential);
        
        location.reload(); 
    }
}

// 3. NOVÁ FUNKCE: Synchronizace Premium statusu se serverem
async function syncPremiumStatus(token) {
    if (!token) token = localStorage.getItem('rr_auth_token');
    if (!token) return;

    try {
        const res = await fetch('/api/check-premium', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            // Uložíme aktuální stav do localStorage
            localStorage.setItem('rr_premium', data.isPremium ? 'true' : 'false');
            // Aktualizujeme UI, kdyby se něco změnilo
            updateAuthUI();
        } else if (res.status === 401) {
            // Token vypršel -> odhlásit uživatele
            logout(); 
        }
    } catch (e) {
        console.error("Failed to sync premium status:", e);
    }
}

// 4. User Logout
function logout() {
    localStorage.removeItem('rr_user_email');
    localStorage.removeItem('rr_user_pic');
    localStorage.removeItem('rr_premium');
    localStorage.removeItem('rr_auth_token'); // Smažeme i token
    location.reload();
}

// 5. UI Update - "CHYTRÁ" VERZE S ČEKÁNÍM NA HEADER
function updateAuthUI(retryCount = 0) {
    const email = localStorage.getItem('rr_user_email');
    const pic = localStorage.getItem('rr_user_pic');
    const isPremium = localStorage.getItem('rr_premium') === 'true';
    
    const desktopAuth = document.getElementById('auth-section');
    const mobileAuth = document.getElementById('auth-section-mobile');

    // Pokud header ještě není načtený, zkusíme to znovu za 50ms
    if ((!desktopAuth || !mobileAuth) && retryCount < 10) {
        setTimeout(() => updateAuthUI(retryCount + 1), 50);
        return;
    }

    // HTML šablona pro přihlášeného uživatele (DESKTOP)
    const userHtml = email ? `
        <div class="flex items-center gap-2 bg-white/5 p-1 pr-3 rounded-full border ${isPremium ? 'border-yellow-500/50' : 'border-white/10'} hover:bg-white/10 transition-all cursor-pointer group">
            <div onclick="window.location.href='account.html'" class="flex items-center gap-2">
                <img src="${pic}" class="w-8 h-8 rounded-full border ${isPremium ? 'border-yellow-500' : 'border-blue-500/50'}">
                <span class="text-[10px] font-bold ${isPremium ? 'text-yellow-500' : 'text-gray-400'} hidden sm:inline group-hover:text-white transition-colors">
                    ${isPremium ? 'PREMIUM' : email.split('@')[0]}
                </span>
            </div>
            <div class="w-[1px] h-4 bg-white/10 mx-1"></div>
            <button onclick="logout()" class="text-gray-500 hover:text-red-500 text-[10px] font-black px-1 transition-colors" title="Log Out">✕</button>
        </div>
    ` : null;

    if (desktopAuth && userHtml) desktopAuth.innerHTML = userHtml;

    if (mobileAuth) {
        if (email) { 
            mobileAuth.innerHTML = `
                <div class="flex flex-col items-center gap-4 w-full">
                    <div onclick="window.location.href='account.html'" class="flex flex-col items-center gap-2 cursor-pointer active:scale-95 transition-transform p-4 rounded-2xl hover:bg-white/5 w-full">
                        <img src="${pic}" class="w-16 h-16 rounded-full border-2 ${isPremium ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]'}">
                        <div class="text-center">
                            <span class="text-white font-bold text-xl block">${email.split('@')[0]}</span>
                            <span class="text-xs ${isPremium ? 'text-yellow-500' : 'text-gray-500'} font-mono uppercase tracking-widest">
                                ${isPremium ? 'Premium Plan' : 'Free Plan'} • Settings ⚙
                            </span>
                        </div>
                    </div>
                    <button onclick="logout()" class="text-red-400 text-sm border border-red-500/20 bg-red-500/10 px-6 py-2 rounded-full hover:bg-red-500 hover:text-white transition-all w-full max-w-[200px]">
                        Log Out
                    </button>
                </div>
            `;
        } else {
            mobileAuth.innerHTML = `<button onclick="loginWithGoogle()" class="text-white text-lg font-bold border border-white/20 px-8 py-3 rounded-xl w-full bg-[#111]">Log In</button>`;
        }
    }
}

// 6. OVLÁDÁNÍ MOBILNÍHO MENU
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('mobile-menu-btn');
    
    if (!menu || !btn) return;

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        btn.innerHTML = `<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
        document.body.style.overflow = 'hidden';
    } else {
        menu.classList.add('hidden');
        btn.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>`;
        document.body.style.overflow = 'auto';
    }
}

// 7. TOAST NOTIFICATION SYSTEM
function showToast(message, type = 'error') {
    const toast = document.getElementById('toast');
    if(!toast) { alert(message); return; }
    
    const msgEl = document.getElementById('toast-msg');
    const iconEl = document.getElementById('toast-icon');

    msgEl.innerText = message;
    if(type === 'success') iconEl.innerText = '✅';
    else if(type === 'info') iconEl.innerText = 'ℹ️';
    else iconEl.innerText = '⚠️';
    
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

// 8. Logic for Cookie Banner
function acceptCookies() { localStorage.setItem('rigradar_tos', 'true'); hideBanner(); }
function hideBanner() { const b = document.getElementById('cookie-banner'); if(b) b.style.display = 'none'; }
function declineCookies() { alert("You must accept the Terms of Service."); window.location.href = 'index.html'; }
function loginWithGoogle() { 
    if (typeof google === 'undefined') {
        if(typeof showToast === 'function') showToast("Connecting to Google...", "info");
        return; 
    }
    // Necháme Google, ať si okno vyřeší sám přes nový FedCM standard
    google.accounts.id.prompt(); 
}

// 9. Initialization
function initGoogleAuth() {
    updateAuthUI();

    if (typeof google === 'undefined') {
        setTimeout(initGoogleAuth, 100);
        return;
    }

    google.accounts.id.initialize({
        client_id: "636272588894-duknv543nso4j9sj4j2d1qkq6tc690gf.apps.googleusercontent.com",
        callback: handleCredentialResponse,
        use_fedcm_for_prompt: true // <--- TOTO OPRAVÍ TU ČERVENOU HLÁŠKU
    });

    const banner = document.getElementById('cookie-banner');
    if (banner && localStorage.getItem('rigradar_tos') !== 'true') {
        banner.style.display = 'flex';
        setTimeout(() => banner.classList.remove('translate-y-20', 'opacity-0'), 100);
    }
}
// 10. CENTRALIZOVANÉ NAČÍTÁNÍ LAYOUTU (Header & Footer)
async function loadLayout() {
    try {
        // 1. Načíst Header
        const headerRes = await fetch('header.html');
        if (headerRes.ok) {
            document.getElementById('header-placeholder').innerHTML = await headerRes.text();
            updateAuthUI();
        }

        // 2. Načíst Footer
        const footerPlaceholder = document.getElementById('footer-placeholder');
        if (footerPlaceholder) {
            const footerRes = await fetch('footer.html');
            if (footerRes.ok) footerPlaceholder.innerHTML = await footerRes.text();
        }

        // 3. Inicializace Google Auth a synchronizace
        if (typeof initGoogleAuth === 'function') {
            initGoogleAuth();
            
            // TADY JE TA ZMĚNA: Zkontrolujeme premium status při každém načtení stránky
            const token = localStorage.getItem('rr_auth_token');
            if (token) {
                await syncPremiumStatus(token);
            }
        }

    } catch (e) {
        console.error("Layout loading error:", e);
    }
}
