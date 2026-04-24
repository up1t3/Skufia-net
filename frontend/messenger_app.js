document.addEventListener('DOMContentLoaded', () => {
    // Initialize Theme
    const savedTheme = localStorage.getItem('skufia_theme') || 'telegram';
    if (typeof window.changeTheme === 'function') {
        window.changeTheme(savedTheme);
    }

    // --- State Management ---
    window.marketState = {
        page: 1,
        layout: 'grid',
        filters: { q: '', cat: 'Все', loc: 'Везде', sort: 'newest', min: null, max: null }
    };
    window.updatePriceFilter = window.debounce ? window.debounce(function(e, type) { 
        window.marketState.filters[type] = e.target.value; 
        window.marketState.page = 1; 
        if (typeof loadMarket === 'function') loadMarket(); 
    }, 500) : null;
    
    window.updateMarketSort = function(e) { window.marketState.filters.sort = e.target.value; window.marketState.page = 1; if (typeof loadMarket === 'function') loadMarket(); };
    window.setMarketLayout = function(layout) { window.marketState.layout = layout; if (typeof loadMarket === 'function') loadMarket(); };

    const state = window.state = {
        currentView: 'home',
        user: { 
            id: null, 
            username: 'Guest',
            rank: 'Newborn',
            token: localStorage.getItem('skuf_token') || null
        },
        chat: {
            socket: null,
            currentRoomId: null,
            currentRoomName: null,
            currentReceiverId: null,
            rooms: [],
            isSecure: false,
            keys: {
                publicKey: null,
                privateKey: null
            },
            /** @type {Object.<number, CryptoKey>} */
            sessionKeys: {}, // Map of roomId -> CryptoKey (AES)
            currentFolderId: 'all',
            folders: []
        },
        logs: [],
        audioEnabled: true,
        pendingFile: null
    };

    // Use relative port for WebSocket (proxied via Nginx)
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = isLocalDev ? 'localhost:8007' : window.location.host; 
    const WS_URL = protocol + host;

    // --- DOM Elements ---
    const views = document.querySelectorAll('.view');
    const navBtns = document.querySelectorAll('.nav-btn');
    const mobileMenuBtn = document.getElementById('mobile-menu-toggle');
    const sidePanel = document.querySelector('.side-panel');

    // --- Navigation Logic ---
    function switchView(viewId) {
        views.forEach(v => v.classList.remove('active'));
        navBtns.forEach(b => b.classList.remove('active'));

        const activeView = document.getElementById(`view-${viewId}`);
        if (activeView) {
            activeView.classList.add('active');
            state.currentView = viewId;
            const activeBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
            if (activeBtn) activeBtn.classList.add('active');
            if (window.addLog) window.addLog(`Переход в сектор: ${viewId.toUpperCase().replace('_', ' ')}`);

            // Trigger data loads based on view
            if (viewId === 'forum' && typeof loadForum === 'function') loadForum();
            if (viewId === 'wiki' && typeof loadWiki === 'function') loadWiki();
            if (viewId === 'trade' && typeof loadMarket === 'function') loadMarket();
            if (viewId === 'registry' && typeof loadRegistry === 'function') loadRegistry();
            if (viewId === 'messages') { 
                if (window.loadChatRooms) window.loadChatRooms(); 
                if (window.loadFolders) window.loadFolders(); 
            }
            if (viewId === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
        }
    }

    window.WS_URL = WS_URL;
    window.switchView = switchView;
    if (window.initChatCore) {
        window.initChatCore();
    }

    // --- SYSTEM BOOT & ALERTS ---
    async function bootSystem() {
        if (!state.user.token) {
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) authOverlay.style.display = 'flex';
            return;
        } else {
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) authOverlay.style.display = 'none';
        }

        if (window.addLog) window.addLog('Инициализация Skufia Enterprise OS...', 'info');

        // Load user profile
        try {
            const me = await apiRequest('/me');
            if (me) {
                state.user.id = me.id;
                state.user.username = me.username;
                state.user.display_name = me.display_name || me.username;
                state.user.avatar = me.avatar_url;
                
                const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
                if (sidebarAvatar && me.avatar_url) {
                    if (window.applyAvatarDisplay) window.applyAvatarDisplay(sidebarAvatar, me.avatar_url);
                }
            }
        } catch (e) {
            console.warn('Profile pre-load failed:', e);
        }

        try {
            if (window.ensureKeys) await window.ensureKeys();
        } catch (e) {
            console.error('E2EE key init failed:', e);
        }

        if (window.addLog) {
            window.addLog('Loading Cyber-Industrial HUD...', 'system');
            window.addLog('System Online. Welcome, Operator.', 'success');
        }
        
        switchView('messages');
        if (typeof loadDashboard === 'function') loadDashboard();
        if (window.connectWebSocket) window.connectWebSocket(); 

        // PWA Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('chat-sw.js').then(reg => {
                reg.update();
            }).catch(err => console.error('SW registration failed:', err));
        }
    }

    async function syncGlobalAlerts() {
        if (!state.user.token) return;
        const banner = document.getElementById('global-alert-banner');
        if (!banner) return;
        try {
            const data = await apiRequest('/notifications/all');
            if (data && data.length > 0) {
                const alert = data[0];
                banner.textContent = `⚠️ SYSTEM ALERT: ${alert.message}`;
                banner.className = alert.level;
                banner.classList.remove('hidden');
            } else { banner.classList.add('hidden'); }
        } catch (e) { banner.classList.add('hidden'); }
    }

    // --- LISTENERS ---
    const soundToggle = document.getElementById('settings-sound-toggle');
    const pushToggle = document.getElementById('settings-push-toggle');
    const enterToggle = document.getElementById('settings-enter-toggle');
    const syncBtn = document.getElementById('sync-contacts-btn');

    if (soundToggle) {
        soundToggle.checked = localStorage.getItem('skufia_sound') !== 'false';
        soundToggle.addEventListener('change', (e) => {
            state.audioEnabled = e.target.checked;
            localStorage.setItem('skufia_sound', e.target.checked);
        });
    }

    if (enterToggle) {
        enterToggle.checked = localStorage.getItem('skufia_enter_send') === 'true';
        enterToggle.addEventListener('change', (e) => {
            localStorage.setItem('skufia_enter_send', e.target.checked);
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (window.showToast) window.showToast('⏳ Синхронизация...');
            try {
                if (window.loadChatRooms) await window.loadChatRooms();
                if (window.showToast) window.showToast('✅ Контакты обновлены!');
            } catch (e) {
                if (window.showToast) window.showToast('❌ Ошибка синхронизации');
            }
        });
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => { if (sidePanel) sidePanel.classList.toggle('open'); });
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.playSound) window.playSound('click');
            switchView(btn.getAttribute('data-view'));
            if (window.innerWidth <= 768 && sidePanel) sidePanel.classList.remove('open');
        });
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('skuf_token');
            state.user.token = null;
            location.reload();
        });
    }

    // --- SETTINGS & PROFILE ---
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    
    window.closeSettingsModal = () => {
        if (settingsModal) settingsModal.style.display = 'none';
    };

    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            settingsModal.style.display = 'flex';
            try {
                const profile = await apiRequest('/me');
                if (profile) {
                    const handleInput = document.getElementById('settings-handle-input');
                    if (handleInput) handleInput.value = (profile.handle || '').replace('@', '');
                    
                    const avatarPreview = document.getElementById('settings-avatar-preview');
                    if (avatarPreview && profile.avatar_url) {
                        const baseUrl = window.BASE_URL || '';
                        avatarPreview.src = profile.avatar_url.startsWith('http') ? profile.avatar_url : `${baseUrl}${profile.avatar_url}`;
                    }
                }
            } catch (err) { console.error('Settings load error:', err); }
        });
    }

    window.saveProfileHandle = async function() {
        const input = document.getElementById('settings-handle-input');
        const btn = document.getElementById('btn-save-profile');
        if (!input || !btn) return;

        let newVal = input.value.trim();
        if (newVal && !newVal.startsWith('@')) {
            newVal = '@' + newVal;
            input.value = newVal;
        }

        const originalHTML = btn.innerHTML;
        btn.innerHTML = 'СОХРАНЕНИЕ...';
        btn.disabled = true;

        try {
            await apiRequest('/me/update', 'POST', { handle: newVal });
            if (window.showToast) window.showToast('✅ Профиль сохранен!');
            btn.innerHTML = '✓ ГОТОВО';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }, 2000);
        } catch (err) {
            if (window.showToast) window.showToast('❌ Ошибка сохранения');
            btn.innerHTML = '✕ ОШИБКА';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }, 2000);
        }
    };

    window.previewAvatar = async function(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('settings-avatar-preview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(file);

        try {
            const formData = new FormData();
            formData.append('file', file);
            if (window.showToast) window.showToast('⏳ Загрузка...');
            const data = await apiRequest('/me/avatar/upload', 'POST', formData);
            if (window.showToast) window.showToast('✅ Фото обновлено!');
            
            if (data.avatar_url) {
                const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
                if (sidebarAvatar && window.applyAvatarDisplay) window.applyAvatarDisplay(sidebarAvatar, data.avatar_url);
            }
        } catch (e) {
            if (window.showToast) window.showToast('❌ Ошибка загрузки');
        }
    };

    // --- AUTH FORMS ---
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            if (btn) btn.textContent = 'ВХОД...';
            try {
                const res = await fetch(`${window.API_BASE_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('login-username').value,
                        password: document.getElementById('login-password').value
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Login failed');
                localStorage.setItem('skuf_token', data.access_token);
                state.user.token = data.access_token;
                location.reload();
            } catch (err) {
                const errEl = document.getElementById('login-error');
                if (errEl) errEl.textContent = err.message;
                if (btn) btn.textContent = 'ВОЙТИ';
            }
        });
    }

    const regForm = document.getElementById('register-form');
    if (regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            if (btn) btn.textContent = 'РЕГИСТРАЦИЯ...';
            try {
                const res = await fetch(`${window.API_BASE_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('reg-username').value,
                        email: document.getElementById('reg-email').value,
                        password: document.getElementById('reg-password').value,
                        accepted_pd: true
                    })
                });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || 'Registration failed');
                }
                if (window.showToast) window.showToast('✅ Регистрация успешна! Войдите.');
                document.getElementById('toggle-to-login').click();
            } catch (err) {
                const errEl = document.getElementById('reg-error');
                if (errEl) errEl.textContent = err.message;
                if (btn) btn.textContent = 'РЕГИСТРАЦИЯ';
            }
        });
    }

    document.getElementById('toggle-to-register')?.addEventListener('click', () => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    document.getElementById('toggle-to-login')?.addEventListener('click', () => {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });

    // --- INIT ---
    bootSystem();
    syncGlobalAlerts();
    setInterval(syncGlobalAlerts, 60000);
});
