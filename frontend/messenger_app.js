document.addEventListener('DOMContentLoaded', () => {
    // --- Viewport Height Fix for Mobile & Scroll Anchoring ---
    let lastViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
        
        // Scroll adjustment for chat history so messages stick to the bottom when keyboard appears
        const historyEl = document.getElementById('chat-history');
        if (historyEl) {
            // Check if user is currently at the bottom (within 50px tolerance)
            const isAtBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight < 50;
            const delta = lastViewportHeight - vh;
            
            // Wait for next animation frame so the DOM updates clientHeight
            requestAnimationFrame(() => {
                if (isAtBottom) {
                    historyEl.scrollTop = historyEl.scrollHeight;
                } else if (delta !== 0) {
                    historyEl.scrollTop += delta;
                }
            });
        }
        lastViewportHeight = vh;
    }
    
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setAppHeight);
        window.visualViewport.addEventListener('scroll', setAppHeight);
    }
    window.addEventListener('resize', setAppHeight);
    setAppHeight(); // Initial call

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
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.host; 
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
        console.log('--- SYSTEM BOOT START ---');
        const authOverlay = document.getElementById('auth-overlay');
        const authTitle = document.getElementById('auth-title');
        
        if (!state.user.token) {
            console.log('BOOT: No token found. Showing auth overlay.');
            if (authOverlay) authOverlay.style.display = 'flex';
            return;
        }

        // Client-side JWT expiration check
        try {
            const payloadStr = atob(state.user.token.split('.')[1]);
            const payload = JSON.parse(payloadStr);
            if (payload.exp && (payload.exp * 1000 < Date.now())) {
                console.warn('BOOT: Token expired locally. Forcing re-auth.');
                state.user.token = null;
                localStorage.removeItem('skuf_token');
                if (authOverlay) authOverlay.style.display = 'flex';
                return;
            }
        } catch(e) {
            console.warn('BOOT: Invalid token format. Forcing re-auth.');
            state.user.token = null;
            localStorage.removeItem('skuf_token');
            if (authOverlay) authOverlay.style.display = 'flex';
            return;
        }

        if (!state.user.password) {
            const sessionPw = sessionStorage.getItem('skuf_session_pw');
            if (sessionPw) {
                state.user.password = sessionPw;
            }
        }

        console.log('BOOT: Token found. Initializing system in background...');
        
        // PHASE 1 (Fast): Hide overlay immediately to show UI skeleton
        if (authOverlay) {
            authOverlay.style.display = 'none';
        }
        document.documentElement.classList.add('is-logged-in');
        switchView('messages');

        try {
            // Force clear any old API caches to prevent stale profiles on boot
            if ('caches' in window) {
                try {
                    const cacheKeys = await caches.keys();
                    for (const key of cacheKeys) {
                        if (key.startsWith('skufia-chat-')) {
                            const cache = await caches.open(key);
                            const requests = await cache.keys();
                            for (const req of requests) {
                                if (req.url.includes('/api/')) {
                                    await cache.delete(req);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to clear API caches:', e);
                }
            }

            console.log('BOOT: Verifying token with /me...');
            const me = await apiRequest('/me');
            console.log('BOOT: Token verified. User:', me.username);
            state.user.id = me.id;
            state.user.username = me.username;
            state.user.profile = me;
            
            // Re-hydrate my avatars across the app
            const baseUrl = window.BASE_URL || '';
            let aUrl = null;
            if (me.avatar_url) {
                aUrl = me.avatar_url.startsWith('http') || me.avatar_url.startsWith('SPRITE:') ? me.avatar_url : `${baseUrl}${me.avatar_url}`;
                // Cache bust
                if (!aUrl.startsWith('SPRITE:')) aUrl += `?v=${Date.now()}`;
            }

            const dashAvatar = document.getElementById('dash-avatar');
            if (dashAvatar) {
                if (aUrl) {
                    if (typeof applyAvatarDisplay === 'function') applyAvatarDisplay(dashAvatar, aUrl);
                    dashAvatar.textContent = '';
                } else {
                    dashAvatar.textContent = me.username ? me.username.charAt(0).toUpperCase() : '?';
                    dashAvatar.style.backgroundImage = 'none';
                }
            }

            const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
            if (sidebarAvatar) {
                if (aUrl && typeof applyAvatarDisplay === 'function') applyAvatarDisplay(sidebarAvatar, aUrl);
            }

            const settingsPreview = document.getElementById('settings-avatar-preview');
            if (settingsPreview && aUrl) {
                if (typeof applyAvatarDisplay === 'function') applyAvatarDisplay(settingsPreview, aUrl);
            }            // We will remove the overlay after subsystems load to prevent flash of empty app
            // if (authOverlay) authOverlay.style.display = 'none';

            console.log('BOOT: Loading subsystems...');
            
            // Standard initialization
            if (window.addLog) window.addLog('Инициализация Skufia Enterprise OS...', 'info');
            
            try {
                if (typeof VoiceRecorderService !== 'undefined') new VoiceRecorderService();
                if (typeof EmojiPickerEngine !== 'undefined') new EmojiPickerEngine();
            } catch (e) {
                console.error('Subsystem init failed:', e);
            }

            try {
                if (window.ensureKeys) {
                    await window.ensureKeys();
                    if (!state.chat.keys.publicKey || !state.chat.keys.privateKey) {
                        throw new Error('NO_KEYS');
                    }
                }
            } catch (e) {
                console.error('E2EE key init failed:', e);
                if (e.message === 'NO_KEYS' || (e.message && e.message.includes('NO_KEYS'))) {
                    const authOverlay = document.getElementById('auth-overlay');
                    if (authOverlay) {
                        authOverlay.style.display = 'flex';
                        const authTitle = document.getElementById('auth-title');
                        if (authTitle) authTitle.textContent = 'ХРАНИЛИЩЕ ЗАБЛОКИРОВАНО';
                        const loginForm = document.getElementById('login-form');
                        if (loginForm) loginForm.style.display = 'none';
                        const registerForm = document.getElementById('register-form');
                        if (registerForm) registerForm.style.display = 'none';
                        if (unlockForm) unlockForm.style.display = 'block';
                    }
                    document.documentElement.classList.remove('is-logged-in');
                    return; // Stop boot process until unlocked
                }
                if (window.addLog) window.addLog('⚠️ Крипто-модуль недоступен — E2EE отключён', 'warning');
            }
            if (window.connectWebSocket) {
                if (state.user.token) {
                    window.connectWebSocket();
                } else {
                    console.warn('Skipping connectWebSocket: missing token.');
                }
            }
            if (window.loadChatRooms) await window.loadChatRooms(); // make it await if it's async, or wait
            if (window.loadFolders) await window.loadFolders();
            
            console.log('--- SYSTEM BOOT COMPLETE ---');

            // Integrity check before showing the app
            const roomsList = document.getElementById('chat-rooms-list');
            if (roomsList && roomsList.children.length === 0) {
                console.warn('BOOT INTEGRITY: #chat-rooms-list is empty. It might be hydrating.');
            }
            
            if (window.addLog) {
                window.addLog('Loading Cyber-Industrial HUD...', 'system');
                window.addLog('System Online. Welcome, Operator.', 'success');
            }

            // PWA Service Worker - Silent registration
            if ('serviceWorker' in navigator) {
                console.log('Registering Service Worker...');
                navigator.serviceWorker.register('chat-sw.js').then(reg => {
                    console.log('SW registered successfully');
                }).catch(err => console.error('SW registration failed:', err));

                // Listen for updates from SW
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data && event.data.type === 'SW_UPDATED') {
                        console.log('New version detected:', event.data.version);
                        if (!document.getElementById('pwa-update-banner')) {
                            const updateBanner = document.createElement('div');
                            updateBanner.id = 'pwa-update-banner';
                            updateBanner.innerHTML = `
                                <div style="background: rgba(10, 15, 25, 0.95); border: 1px solid var(--accent-cyan); box-shadow: 0 0 20px rgba(0, 242, 255, 0.2); border-radius: 12px; padding: 15px 20px; display: flex; align-items: center; gap: 15px; color: #fff; backdrop-filter: blur(10px);">
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                                            <span style="color: var(--accent-cyan);">🚀</span> Доступно обновление!
                                        </div>
                                        <div style="font-size: 13px; color: var(--text-dim);">Установлена новая версия Skufia.</div>
                                    </div>
                                    <button onclick="window.location.reload(true)" class="cyber-btn primary-btn" style="padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                                        ПЕРЕЗАГРУЗИТЬ
                                    </button>
                                    <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 5px; margin-left: -5px;" title="Закрыть">
                                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                </div>
                            `;
                            updateBanner.style.cssText = 'position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); z-index: 999999; transition: bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); width: max-content; max-width: 95vw;';
                            document.body.appendChild(updateBanner);
                            setTimeout(() => { updateBanner.style.bottom = '30px'; }, 100);
                        }
                    }
                });
            }
        } catch (err) {
            console.error('BOOT FAILURE:', err);
            if (window.addLog) window.addLog(`System boot failed: ${err.message}`, 'error');
            
            // Only redirect to login if it's an explicit auth failure or we lost the token.
            // Network timeouts or 500s should NOT dump the user back to the login screen.
            if (err.message === 'Unauthorized' || !state.user.token) {
                document.documentElement.classList.remove('is-logged-in'); 
                if (authOverlay) {
                    authOverlay.style.display = 'flex';
                    if (authTitle) authTitle.textContent = 'АВТОРИЗАЦИЯ';
                    const authBtn = authOverlay.querySelector('.auth-main-btn');
                    if (authBtn) {
                        authBtn.disabled = false;
                        authBtn.textContent = 'ВОЙТИ В СЕТЬ';
                    }
                }
            } else {
                if (window.showToast) {
                    window.showToast('Ошибка подключения к серверу. Работа в автономном режиме.', 5000);
                }
            }
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

    // --- AUTHENTICATION LISTENERS ---
    const authOverlay = document.getElementById('auth-overlay');

    const toggleToRegister = document.getElementById('toggle-to-register');
    if (toggleToRegister) {
        toggleToRegister.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
            document.getElementById('auth-title').textContent = 'РЕГИСТРАЦИЯ';
        });
    }

    const toggleToLogin = document.getElementById('toggle-to-login');
    if (toggleToLogin) {
        toggleToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('auth-title').textContent = 'АВТОРИЗАЦИЯ';
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            if (btn) btn.textContent = 'ОЖИДАНИЕ...';
            try {
                const res = await fetch(`${window.API_BASE_URL || '/api'}/auth/login`, {
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
                state.user.password = document.getElementById('login-password').value; // Temporary store for E2EE key sync
                sessionStorage.setItem('skuf_session_pw', state.user.password);
                if (authOverlay) authOverlay.style.display = 'none';
                if (window.addLog) window.addLog('Аутентификация успешна', 'system');
                
                // Re-bind auth logic on boot system
                bootSystem();
            } catch (err) {
                const errEl = document.getElementById('login-error');
                if (errEl) errEl.textContent = err.message;
            } finally {
                if (btn) btn.textContent = 'ВОЙТИ В СЕТЬ';
            }
        });
    }

    const unlockForm = document.getElementById('unlock-form');
    if (unlockForm) {
        unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            if (btn) btn.textContent = 'ОЖИДАНИЕ...';
            try {
                state.user.password = document.getElementById('unlock-password').value;
                sessionStorage.setItem('skuf_session_pw', state.user.password);
                
                await window.ensureKeys();
                if (!state.chat.keys.publicKey || !state.chat.keys.privateKey) {
                    throw new Error('Неверный пароль. Хранилище не расшифровано.');
                }
                
                document.getElementById('auth-overlay').style.display = 'none';
                bootSystem(); // Resume boot
            } catch (err) {
                const errEl = document.getElementById('unlock-error');
                if (errEl) errEl.textContent = err.message;
            } finally {
                if (btn) btn.textContent = 'РАЗБЛОКИРОВАТЬ ВАЛТ';
            }
        });
    }

    const toggleToLoginAlt = document.getElementById('toggle-to-login');
    if (toggleToLoginAlt) {
        toggleToLoginAlt.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('skuf_token');
            sessionStorage.removeItem('skuf_session_pw');
            state.user.token = null;
            state.user.password = null;
            window.location.reload();
        });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('reg-submit-btn') || e.target.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'ОЖИДАНИЕ...';
            try {
                const pdConsent = document.getElementById('reg-pd-consent');
                const res = await fetch(`${window.API_BASE_URL || '/api'}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('reg-username').value,
                        email: document.getElementById('reg-email').value,
                        password: document.getElementById('reg-password').value,
                        accepted_pd: pdConsent ? pdConsent.checked : false
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Registration failed');

                document.getElementById('register-form').style.display = 'none';
                document.getElementById('login-form').style.display = 'block';
                document.getElementById('auth-title').textContent = 'АВТОРИЗАЦИЯ';
                document.getElementById('login-username').value = document.getElementById('reg-username').value;
                document.getElementById('login-password').value = document.getElementById('reg-password').value;
                const errEl = document.getElementById('login-error');
                if (errEl) {
                    errEl.textContent = 'Регистрация успешна. Выполните вход.';
                    errEl.style.color = '#00f2ff';
                }
            } catch (err) {
                const regErr = document.getElementById('reg-error');
                if (regErr) regErr.textContent = err.message;
            } finally {
                if (btn) btn.textContent = 'АКТИВИРОВАТЬ АККАУНТ';
            }
        });
    }

    bootSystem();
    syncGlobalAlerts();
    setInterval(syncGlobalAlerts, 30000);

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
                    const handleInput = document.getElementById('settings-handle');
                    if (handleInput) handleInput.value = (profile.handle || '').replace('@', '');
                    
                    const avatarPreview = document.getElementById('settings-avatar-preview');
                    if (avatarPreview && profile.avatar_url) {
                        const baseUrl = window.BASE_URL || '';
                        const aUrl = profile.avatar_url.startsWith('http') ? profile.avatar_url : `${baseUrl}${profile.avatar_url}`;
                        avatarPreview.src = aUrl + `?v=${Date.now()}`;
                    }
                }
            } catch (err) { console.error('Settings load error:', err); }
        });
    }

    // --- PROFILE & SETTINGS LOGIC ---
    window.saveProfileHandle = async function() {
        const input = document.getElementById('settings-handle');
        const btn = document.getElementById('btn-save-profile');
        if (!input || !btn) return;

        let rawVal = input.value.trim();
        // Remove @ if user typed it, since we have a visual @ prefix in UI
        if (rawVal.startsWith('@')) {
            rawVal = rawVal.substring(1);
            input.value = rawVal;
        }

        const sendVal = rawVal ? '@' + rawVal : '';

        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> СОХРАНЕНИЕ...';
        btn.disabled = true;

        try {
            const result = await apiRequest('/me/update', 'POST', { handle: sendVal });

            if (result.handle_status === 'already_set') {
                // Handle already saved under this account — inform, not error
                if (typeof showToast === 'function') showToast('ℹ️ У вас уже сохранён этот handle');
                btn.innerHTML = '✓ УЖЕ СОХРАНЁН';
                btn.classList.add('btn-success');
            } else {
                // Successfully saved new handle
                if (state.user) state.user.handle = result.handle;
                if (typeof addLog === 'function') addLog('Handle успешно сохранён', 'success');
                if (typeof showToast === 'function') showToast('✅ Handle сохранён: ' + (result.handle || '(очищен)'));
                btn.innerHTML = '✓ СОХРАНЕНО';
                btn.classList.add('btn-success');
            }

            btn.disabled = false;
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('btn-success');
            }, 2800);

        } catch (err) {
            const isTaken = err.status === 409 || err.code === 'HANDLE_TAKEN';

            if (isTaken) {
                if (typeof showToast === 'function') showToast('⚠️ ' + (err.message || 'Этот handle уже занят другим пользователем'));
                btn.innerHTML = '✕ ЗАНЯТ';
            } else {
                if (typeof addLog === 'function') addLog('Ошибка при сохранении handle', 'error');
                if (typeof showToast === 'function') showToast('❌ Ошибка: ' + (err.message || 'не удалось сохранить'));
                btn.innerHTML = '✕ ОШИБКА';
            }

            btn.classList.add('btn-danger');
            btn.disabled = false;
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('btn-danger');
            }, 2800);
        }
    };

window.cropperInstance = null;

window.previewAvatar = function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    
    // Destroy previous cropper if exists
    if (window.cropperInstance) {
        window.cropperInstance.destroy();
        window.cropperInstance = null;
    }
    
    const image = document.getElementById('crop-image-target');
    if (image) image.src = '';
    
    // Do NOT show the modal immediately to avoid the lag/flash.
    // Instead, wait for Cropper to be fully ready.
    
    const reader = new FileReader();
    reader.onload = function(e) {
        if (!image) return;
        image.src = e.target.result;
        
        // Initialize Cropper.js after image src is set
        window.cropperInstance = new Cropper(image, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            ready: function() {
                // Show modal ONLY when Cropper is ready and image is loaded
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal && settingsModal.style.display !== 'none') {
                    window._wasSettingsOpen = true;
                    settingsModal.style.display = 'none';
                } else {
                    window._wasSettingsOpen = false;
                }
                const cropModal = document.getElementById('avatar-crop-modal');
                if (cropModal) {
                    cropModal.style.display = 'flex';
                }
            }
        });
    };
    reader.readAsDataURL(file);
    input.value = ''; // Reset input
};

window.closeCropModal = function() {
    document.getElementById('avatar-crop-modal').style.display = 'none';
    if (window._wasSettingsOpen) {
        document.getElementById('settings-modal').style.display = 'flex';
        window._wasSettingsOpen = false;
    }
    if (window.cropperInstance) {
        window.cropperInstance.destroy();
        window.cropperInstance = null;
    }
};

window.uploadCroppedAvatar = async function() {
    if (!window.cropperInstance) return;
    
    const saveBtn = document.querySelector('#avatar-crop-modal .primary-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = 'ЗАГРУЗКА...';
    }
    
    const canvas = window.cropperInstance.getCroppedCanvas({
        width: 800,
        height: 800,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });
    
    canvas.toBlob(async (blob) => {
        const compressedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        
        try {
            const formData = new FormData();
            formData.append('file', compressedFile);
            
            if (typeof showToast === 'function') showToast('⏳ Загрузка фото...');
            
            const token = (window.state && window.state.user) ? window.state.user.token : localStorage.getItem('skuf_token');
            if (!token) throw new Error('Токен авторизации не найден');

            const resp = await fetch(`${window.API_BASE_URL || '/api'}/me/avatar/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                let errMsg = err.detail || 'Ошибка загрузки';
                if (Array.isArray(errMsg)) errMsg = errMsg.map(e => e.msg || JSON.stringify(e)).join(', ');
                else if (typeof errMsg === 'object') errMsg = JSON.stringify(errMsg);
                throw new Error(errMsg);
            }
            
            const data = await resp.json();
            const avatarUrl = data.avatar_url;

            const preview = document.getElementById('settings-avatar-preview');
            if (preview) preview.src = avatarUrl + "?v=" + Date.now();
            
            const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
            if (sidebarAvatar && typeof applyAvatarDisplay === 'function') applyAvatarDisplay(sidebarAvatar, avatarUrl);
            
            const dashAvatar = document.getElementById('dash-avatar');
            if (dashAvatar && typeof applyAvatarDisplay === 'function') applyAvatarDisplay(dashAvatar, avatarUrl);
            
            const headerAvatar = document.getElementById('header-avatar');
            if (headerAvatar) {
                if (typeof applyAvatarDisplay === 'function') {
                    applyAvatarDisplay(headerAvatar, avatarUrl);
                } else {
                    headerAvatar.innerHTML = `<img src="${avatarUrl}?v=${Date.now()}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                }
            }
            
            if (typeof addLog === 'function') addLog('Аватарка успешно обновлена', 'success');
            if (typeof showToast === 'function') showToast('✅ Фото профиля обновлено!');
            
        } catch (e) {
            console.error('Avatar upload error:', e);
            if (typeof addLog === 'function') addLog(`❌ Ошибка загрузки: ${e.message}`, 'error');
            if (typeof showToast === 'function') showToast('❌ Ошибка загрузки: ' + e.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = 'СОХРАНИТЬ';
            }
            window.closeCropModal();
        }
    }, 'image/jpeg', 0.85);
};



    const themeSelect = document.getElementById('settings-theme-select');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            document.body.setAttribute('data-theme', e.target.value);
            localStorage.setItem('skufia_theme', e.target.value);
        });
        const savedTheme = localStorage.getItem('skufia_theme');
        if (savedTheme) themeSelect.value = savedTheme;
    }

    const syncContactsBtn = document.getElementById('sync-contacts-btn');
    if (syncContactsBtn) {
        syncContactsBtn.addEventListener('click', async () => {
            syncContactsBtn.textContent = 'ИДЕТ ПОИСК...';
            try {
                if ('contacts' in navigator && 'ContactsManager' in window) {
                    const props = ['name', 'tel'];
                    const contacts = await navigator.contacts.select(props, { multiple: true });
                    if (contacts && contacts.length > 0) {
                        const payload = contacts.map(c => ({ name: c.name[0], phone: c.tel ? c.tel[0] : '' }));
                        await apiRequest('/contacts/sync', 'POST', { contacts: payload });
                        addLog(`Успешно подтянуто абонентов: ${contacts.length}`, 'success');
                        if (window.loadChatRooms) window.loadChatRooms();
                    }
                } else {
                    addLog('Backend Sync Mode активирован.', 'info');
                    await apiRequest('/contacts/sync', 'POST', { contacts: [] });
                    addLog('Backend Sync завершен', 'success');
                }
            } catch (err) {
                addLog('Ошибка синхронизации контактов', 'error');
            } finally {
                syncContactsBtn.textContent = 'ПОДТЯНУТЬ КОНТАКТЫ';
            }
        });
    }

    // --- SKUFENGER BRANDING ---
    document.title = 'SKUFenger';
    const authTitle = document.getElementById('auth-title');
    if (authTitle && !state.user.token) authTitle.textContent = 'ВХОД В SKUFENGER';

    // --- GLOBAL EXPOSURE ---
    window.loadForum = loadForum;
    window.loadWiki = loadWiki;
    window.loadMarket = loadMarket;
    window.loadRegistry = loadRegistry;
    window.loadTopicPosts = loadTopicPosts;
    window.likePost = likePost;
    window.likeWiki = likeWiki;
    window.switchView = switchView;

    // --- CHAT UTILS ---
    window.closeChatMobile = function(fromHistory = false) {
        const chatLayout = document.querySelector('.chat-layout');
        if (!chatLayout) return;

        const isFullscreen = document.body.classList.contains('skufenger-fullscreen');
        const isMobile = window.innerWidth <= 768;

        // Remove chat-open in all cases — this triggers CSS transition
        if (chatLayout.classList.contains('chat-open')) {
            chatLayout.classList.remove('chat-open');
        }

        // Push history back for mobile or fullscreen PWA so swipe-back works
        if (fromHistory !== true && (isMobile || isFullscreen)) {
            try { history.back(); } catch(e) {}
        }
    };

    window.openContactProfile = function() {
        const roomId = state.chat.currentRoomId;
        if (!roomId) return;
        const room = (state.chat.rooms || []).find(r => r.id === roomId);
        const name = document.getElementById('chat-header-title')?.textContent || 'Неизвестно';
        const avatarEl = document.getElementById('header-avatar');
        const avatarHtml = avatarEl ? avatarEl.innerHTML : '';

        // Build/reuse modal
        let modal = document.getElementById('contact-profile-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'contact-profile-modal';
            modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,0.7); align-items:flex-end; justify-content:center;';
            modal.innerHTML = `
                <div style="background:var(--bg-panel); width:100%; max-width:600px; border-radius:16px 16px 0 0; padding:24px; border:1px solid var(--border-metal);">
                    <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px;">
                        <div id="cp-avatar" style="width:56px;height:56px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg-dark);display:flex;align-items:center;justify-content:center;"></div>
                        <div>
                            <div id="cp-name" style="font-size:1.1rem;font-weight:700;color:var(--text-main);"></div>
                            <div id="cp-status" style="font-size:0.85rem;color:var(--text-dim);"></div>
                        </div>
                    </div>
                    <div style="display:flex; gap:12px; margin-bottom:16px;">
                        <button class="cyber-btn" style="flex:1;" onclick="window.skufengerCall(false); document.getElementById('contact-profile-modal').style.display='none';">📞 Позвонить</button>
                        <button class="cyber-btn" style="flex:1;" onclick="window.skufengerCall(true); document.getElementById('contact-profile-modal').style.display='none';">🎥 Видео</button>
                    </div>
                    <button class="cyber-btn" style="width:100%;background:rgba(255,50,50,0.15);border-color:rgba(255,100,100,0.3);" onclick="document.getElementById('contact-profile-modal').style.display='none'">✕ Закрыть</button>
                </div>`;
            modal.addEventListener('click', function(e) {
                if (e.target === modal) modal.style.display = 'none';
            });
            document.body.appendChild(modal);
        }

        // Populate
        const cpAvatar = document.getElementById('cp-avatar');
        const cpName = document.getElementById('cp-name');
        const cpStatus = document.getElementById('cp-status');
        if (cpAvatar) cpAvatar.innerHTML = avatarHtml;
        if (cpName) cpName.textContent = name;
        if (cpStatus) cpStatus.textContent = room ? (room.is_online ? '🟢 В сети' : '⚫ Не в сети') : '';
        modal.style.display = 'flex';
    };

    // --- CHAT OPTIONS ---
    window.toggleChatOptions = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const dd = document.getElementById('chat-options-dropdown');
        if (!dd) return;
        const isOpen = dd.style.display !== 'none';
        dd.style.display = isOpen ? 'none' : 'block';
    };

    window.skufengerCall = function(isVideo) {
        if (!state.chat.currentRoomId) {
            if (typeof showToast === 'function') showToast('Сначала выберите контакт для звонка');
            return;
        }
        const targetId = state.chat.receiverId || state.chat.currentRoomId;
        if (!window.RTCManagerInstance) {
            if (typeof showToast === 'function') showToast('⚠️ RTC модуль не инициализирован');
            return;
        }
        
        // Find avatar and name from rooms
        let targetName = 'User ' + targetId;
        let targetAvatar = '<div class="avatar-placeholder" style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#555;font-size:40px;">?</div>';
        
        if (state.chat && state.chat.rooms) {
            const room = state.chat.rooms.find(r => r.id == targetId || r.other_user_id == targetId);
            if (room) {
                targetName = room.name || room.id;
                if (room.avatar_url) {
                    targetAvatar = `<img src="${room.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='<div class=\\'avatar-placeholder\\' style=\\'width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#555;font-size:40px;\\'>?</div>'">`;
                } else {
                    targetAvatar = `<div class="avatar-placeholder" style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--accent-cyan);color:#000;font-size:40px;font-weight:bold;">${targetName.charAt(0).toUpperCase()}</div>`;
                }
            }
        }
        
        if (typeof showToast === 'function') showToast(`📞 Инициация ${isVideo ? 'видео' : 'аудио'} звонка...`);
        window.RTCManagerInstance.startCall(targetId, targetName, targetAvatar, isVideo);
    };

    window.chatOptionAction = function(action) {
        const dd = document.getElementById('chat-options-dropdown');
        if (dd) dd.style.display = 'none';
        showToast(`Опция ${action} в разработке`);
    };

    const contactSearchInput = document.getElementById('contact-search');
    if (contactSearchInput) {
        contactSearchInput.addEventListener('input', function() {
            const query = this.value.toLowerCase().trim();
            document.querySelectorAll('#chat-rooms-list .sidebar-item').forEach(item => {
                const name = item.querySelector('.sidebar-item-name')?.textContent.toLowerCase() || '';
                item.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    // --- TELEGRAM-LIKE SEARCH ---
    window.toggleSidebarSearch = function(show) {
        const defaultHeader = document.getElementById("sidebar-default-header");
        const searchHeader = document.getElementById("sidebar-active-search");
        const searchInput = document.getElementById("contact-search");
        if (show) {
            if (defaultHeader) defaultHeader.style.display = "none";
            if (searchHeader) searchHeader.style.display = "flex";
            searchInput?.focus();
        } else {
            if (defaultHeader) defaultHeader.style.display = "flex";
            if (searchHeader) searchHeader.style.display = "none";
            if (searchInput) { searchInput.value = ""; searchInput.dispatchEvent(new Event("input")); }
        }
    };

    window.closeSettingsModal = function() {
        const m = document.getElementById('settings-modal');
        if (m) m.style.display = 'none';
        if (window.location.hash.includes('settings')) {
            history.back();
        }
    };

    window.addEventListener('popstate', (e) => {
        if (!window.location.hash.includes('settings')) {
            const sm = document.getElementById('settings-modal');
            if (sm && sm.style.display === 'flex') {
                sm.style.display = 'none';
            }
        }
        const s = e.state;
        if (!s || !s.chat) {
            const chatLayout = document.querySelector('.chat-layout');
            if (chatLayout && chatLayout.classList.contains('chat-open')) {
                chatLayout.classList.remove('chat-open');
            }
        } else {
            const chatLayout = document.querySelector('.chat-layout');
            if (chatLayout && !chatLayout.classList.contains('chat-open')) {
                chatLayout.classList.add('chat-open');
            }
        }
    });

});
