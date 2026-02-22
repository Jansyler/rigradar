// --- ZACHYCENÍ GITHUB LOGINU Z URL v auth.js ---
const urlParams = new URLSearchParams(window.location.search);
const urlEmail = urlParams.get('email');
const urlPic = urlParams.get('pic'); 

// 🛡️ Změna: Už nehledáme token v URL, spoléháme na HttpOnly cookie
if (urlEmail) {
    localStorage.setItem('rr_user_email', urlEmail);
    
    if (urlPic) {
        localStorage.setItem('rr_user_pic', urlPic);
    }
    
    window.history.replaceState({}, document.title, window.location.pathname);
}

// 1. Synchronizace Premium statusu se serverem
async function syncPremiumStatus() {
    const email = localStorage.getItem('rr_user_email');
    if (!email) return;

    try {
        // 🛡️ Změna: Prohlížeč automaticky pošle HttpOnly cookie, nepotřebujeme "Authorization" header
        const res = await fetch('/api/check-premium', {
            method: 'GET'
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('rr_premium', data.isPremium ? 'true' : 'false');
            updateAuthUI();
        } else if (res.status === 401) {
            // Cookie vypršela nebo je neplatná -> odhlásit uživatele
            logout(); 
        }
} catch (e) {
        console.error("Failed to sync premium status (Network Error), keeping local state.", e);
        // Hlavně tady NIKDY nevolej logout() při chybě připojení (catch blok)
    }
}

// 2. User Logout
function logout() {
    localStorage.removeItem('rr_user_email');
    localStorage.removeItem('rr_user_pic');
    localStorage.removeItem('rr_premium');
    
    // Poznámka: Aby se HttpOnly cookie smazala i ze serveru, bude potřeba zavolat /api/logout.
    // Prozatím smazání local dat stačí pro odhlášení z UI.
    location.reload();
}

// 3. UI Update - "CHYTRÁ" VERZE S ČEKÁNÍM NA HEADER
function updateAuthUI(retryCount = 0) {
    const email = localStorage.getItem('rr_user_email');
    let pic = localStorage.getItem('rr_user_pic');
    const isPremium = localStorage.getItem('rr_premium') === 'true';
    
    if (!pic || pic === 'undefined' || pic === 'null') {
        pic = `https://api.dicebear.com/7.x/avataaars/svg?seed=${email || 'user'}`;
    }
    
    const desktopAuth = document.getElementById('auth-section');
    const mobileAuth = document.getElementById('auth-section-mobile');

    if ((!desktopAuth || !mobileAuth) && retryCount < 10) {
        setTimeout(() => updateAuthUI(retryCount + 1), 50);
        return;
    }

    const userHtml = email ? `
        <div class="flex items-center gap-2 bg-white/5 p-1 pr-3 rounded-full border ${isPremium ? 'border-yellow-500/50' : 'border-white/10'} hover:bg-white/10 transition-all cursor-pointer group">
            <div onclick="window.location.href='account.html'" class="flex items-center gap-2">
                <img src="${pic}" class="w-8 h-8 rounded-full border ${isPremium ? 'border-yellow-500' : 'border-blue-500/50'}">
                <span class="text-[11px] font-bold uppercase tracking-tight ${isPremium ? 'text-yellow-500' : 'text-gray-300'} hidden sm:inline group-hover:text-white transition-colors">
                    ${isPremium ? 'PREMIUM' : email.split('@')[0]}
                </span>
            </div>
            <div class="w-[1px] h-4 bg-white/10 mx-1"></div>
            <button onclick="logout()" class="text-gray-500 hover:text-red-500 text-[10px] font-black px-1 transition-colors" title="Log Out">✕</button>
        </div>
    ` : `<button onclick="window.location.href='login.html'" class="text-white text-xs font-bold border border-white/20 px-6 py-2 rounded-xl bg-[#111] hover:bg-white/10 transition-all">Log In</button>`;
    
    if (desktopAuth) desktopAuth.innerHTML = userHtml;

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
            mobileAuth.innerHTML = `<button onclick="window.location.href='login.html'" class="text-white text-lg font-bold border border-white/20 px-8 py-3 rounded-xl w-full bg-[#111]">Log In</button>`;
        }
    }
}

// 4. OVLÁDÁNÍ MOBILNÍHO MENU
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

// 5. TOAST NOTIFICATION SYSTEM
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

// 6. Logic for Cookie Banner
function acceptCookies() { localStorage.setItem('rigradar_tos', 'true'); hideBanner(); }
function hideBanner() { const b = document.getElementById('cookie-banner'); if(b) b.style.display = 'none'; }
function declineCookies() { alert("You must accept the Terms of Service."); window.location.href = 'index.html'; }

function loginWithGoogle() { 
    window.location.href = 'login.html';
}

// 7. Initialization
function initGoogleAuth() {
    updateAuthUI();

    const banner = document.getElementById('cookie-banner');
    if (banner && localStorage.getItem('rigradar_tos') !== 'true') {
        banner.style.display = 'flex';
        setTimeout(() => banner.classList.remove('translate-y-20', 'opacity-0'), 100);
    }
}

// 8. CENTRALIZOVANÉ NAČÍTÁNÍ LAYOUTU
async function loadLayout() {
    try {
        const headerRes = await fetch('header.html');
        if (headerRes.ok) {
            document.getElementById('header-placeholder').innerHTML = await headerRes.text();
            updateAuthUI();
        }

        const footerPlaceholder = document.getElementById('footer-placeholder');
        if (footerPlaceholder) {
            const footerRes = await fetch('footer.html');
            if (footerRes.ok) footerPlaceholder.innerHTML = await footerRes.text();
        }

        if (typeof initGoogleAuth === 'function') {
            initGoogleAuth();
            
            // 🛡️ Změna: Už nehledáme token, ptáme se API rovnou
            const email = localStorage.getItem('rr_user_email');
            if (email) {
                await syncPremiumStatus();
            }
        }

    } catch (e) {
        console.error("Layout loading error:", e);
    }
}
