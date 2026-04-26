document.addEventListener('DOMContentLoaded', () => {
    // Initialize Theme
    const savedTheme = localStorage.getItem('skufia_theme') || 'telegram';
    changeTheme(savedTheme);
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        themeSelector.value = savedTheme;
    }

    // --- State Management ---
    window.marketState = {
        page: 1,
        layout: 'grid',
        filters: { q: '', cat: 'Все', loc: 'Везде', sort: 'newest', min: null, max: null }
    };
    window.updatePriceFilter = debounce(function(e, type) { 
        window.marketState.filters[type] = e.target.value; 
        window.marketState.page = 1; 
        loadMarket(); 
    }, 500);
    window.updateMarketSort = function(e) { window.marketState.filters.sort = e.target.value; window.marketState.page = 1; loadMarket(); };
    window.setMarketLayout = function(layout) { window.marketState.layout = layout; loadMarket(); };

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
        /** @type {{ url: string, name: string } | null} */
        pendingFile: null
    };

    // Use relative port for WebSocket (proxied via Nginx)
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = isLocalDev ? 'localhost:8007' : window.location.host; 
    const WS_URL = protocol + host;

    // --- DOM Elements ---
    const views = document.querySelectorAll('.view');
    const navBtns = document.querySelectorAll('.nav-btn');
    const logContainer = document.getElementById('system-logs');
    const mobileMenuBtn = document.getElementById('mobile-menu-toggle');
    const sidePanel = document.querySelector('.side-panel');
    if (mobileMenuBtn && sidePanel) {
        // Redundant listeners removed. The actual logic is handled at the bottom of the file (lines 3018+)
    }

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
            addLog(`Switching to sector: ${viewId.toUpperCase().replace('_', ' ')}`);

            // Trigger data loads based on view
            if (viewId === 'forum') loadForum();
            if (viewId === 'wiki') loadWiki();
            if (viewId === 'trade') loadMarket();
            if (viewId === 'registry') loadRegistry();
            if (viewId === 'messages') { if(window.loadChatRooms) window.loadChatRooms(); }
            if (viewId === 'events') loadEvents();
            if (viewId === 'dashboard') loadDashboard();
        }
    }


    // Chat logic extracted to chat_core.js
    window.WS_URL = WS_URL;
    window.switchView = switchView;
    if (window.initChatCore) {
        window.initChatCore();
    }
    // --- SYSTEM BOOT & ALERTS ---
    async function bootSystem() {
        if (!state.user.token) {
            document.getElementById('auth-overlay').style.display = 'flex';
            // Wait for user to log in
            return;
        } else {
            document.getElementById('auth-overlay').style.display = 'none';
        }

        // Initialize Phase 2 Engines
        new VoiceRecorderService();
        new EmojiPickerEngine();

        addLog('Initializing Skufia Enterprise OS...', 'info');
        try {
            await window.ensureKeys();
        } catch (e) {
            if (e.message === 'NO_KEYS') {
                // Password needed for decryption
                document.getElementById('auth-overlay').style.display = 'flex';
                const loginForm = document.getElementById('login-form');
                if (loginForm) loginForm.style.display = 'none';
                const registerForm = document.getElementById('register-form');
                if (registerForm) registerForm.style.display = 'none';
                const unlockForm = document.getElementById('unlock-form');
                if (unlockForm) unlockForm.style.display = 'block';
                addLog('Vault Locked. Please enter password to decrypt keys.', 'warning');
                return; // Pause boot process
            } else {
                console.error('E2EE key init failed (non-fatal):', e);
                addLog('⚠️ Крипто-модуль недоступен — E2EE отключён', 'warning');
            }
        }

        addLog('Loading Cyber-Industrial HUD...', 'system');
        addLog('System Online. Welcome, Operator.', 'success');
        
        // --- Initialization ---
        if (new URLSearchParams(window.location.search).get('app') !== 'skufenger') {
            switchView('home');
        } else {
            switchView('messages');
        }
        loadDashboard();
        connectWebSocket(); // Establish real-time link

        // Phase 5: PWA Service Worker Registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('chat-sw.js').then(reg => {
                addLog('Service Worker Connected (PWA Active)', 'system');
                
                // Explicitly check for updates on load
                reg.update();

                // Check for updates when app comes back to foreground
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        reg.update();
                    }
                });

                // Request push permissions if granted/prompt
                if (Notification.permission === 'granted') {
                    window.subscribeToPushNotifications(reg);
                }
            }).catch(err => {
                console.error('SW registration failed:', err);
            });

            // Auto-reload when a new SW activates with a fresh cache
            // This prevents the PWA from running stale broken JS after an update
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'SW_UPDATED') {
                    console.log('[PWA] New SW activated (' + event.data.version + '), update available.');
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
    }

    // Push Notifications Logic
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    window.subscribeToPushNotifications = async function(reg = null) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            if (!reg) reg = await navigator.serviceWorker.ready;
            
            // Get public key from server
            const keyRes = await apiRequest('/notifications/vapidPublicKey');
            if (!keyRes || !keyRes.publicKey) return;
            
            const applicationServerKey = urlBase64ToUint8Array(keyRes.publicKey);
            
            const subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });

            // Send subscription to server
            await apiRequest('/notifications/subscribe', 'POST', subscription.toJSON());
            addLog('Push-уведомления успешно активированы', 'success');
        } catch (err) {
            console.error('Failed to subscribe to push notifications', err);
            addLog('Ошибка активации уведомлений', 'warning');
        }
    };
    
    window.unsubscribeFromPushNotifications = async function() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const subscription = await reg.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                await apiRequest(`/notifications/unsubscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, 'DELETE');
                addLog('Push-уведомления отключены', 'info');
            }
        } catch (err) {
            console.error('Failed to unsubscribe', err);
        }
    };

    window.togglePushNotifications = async function(checkbox) {
        if (checkbox.checked) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                await window.subscribeToPushNotifications();
            } else {
                checkbox.checked = false;
                if (window.showToast) window.showToast('⚠️ Разрешение на уведомления отклонено в браузере');
            }
        } else {
            await window.unsubscribeFromPushNotifications();
        }
    };

    // Phase 5: Install Prompt Logic
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('install-pwa-btn');
        if (installBtn) {
            installBtn.style.display = 'flex';
            installBtn.addEventListener('click', async (clickEvent) => {
                clickEvent.preventDefault();
                installBtn.style.display = 'none';
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    addLog('PWA Installation Accepted', 'success');
                }
                deferredPrompt = null;
            });
        }
    });

    async function syncGlobalAlerts() {
        if (!state.user.token) return; // Prevent 401 polling
        const banner = document.getElementById('global-alert-banner');
        if (!banner) return;
        try {
            const data = await apiRequest('/notifications/all');
            if (data && data.length > 0) {
                const alert = data[0]; // Show most recent
                banner.textContent = `⚠️ SYSTEM ALERT: ${alert.message}`;
                banner.className = alert.level;
                banner.classList.remove('hidden');
            } else { banner.classList.add('hidden'); }
        } catch (e) { banner.classList.add('hidden'); }
    }

    // --- EASTER EGGS ---
    let keyBuffer = '';
    window.addEventListener('keydown', (e) => {
        if (!e.key) return; // Prevent crash if key is undefined
        keyBuffer += e.key.toLowerCase();
        if (keyBuffer.length > 10) keyBuffer = keyBuffer.slice(-10);
        if (keyBuffer.includes('skuf')) {
            document.body.classList.add('super-user');
            addLog('[SECRET] Super-User Mode Activated.', 'success');
            playSound('alert');
            keyBuffer = '';
        }
    });

    // --- INITIALIZATION ---
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => { sidePanel.classList.toggle('open'); });
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
            switchView(btn.getAttribute('data-view'));
            if (window.innerWidth <= 768) sidePanel.classList.remove('open');
        });
    });

    // --- AUTHENTICATION LISTENERS ---
    const authOverlay = document.getElementById('auth-overlay');

    document.getElementById('toggle-to-register').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
        document.getElementById('auth-title').textContent = 'РЕГИСТРАЦИЯ';
    });

    document.getElementById('toggle-to-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('auth-title').textContent = 'АВТОРИЗАЦИЯ';
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        if (btn) btn.textContent = 'ОЖИДАНИЕ...';
        try {
            const res = await fetch(`${API_BASE_URL}/auth/login`, {
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
            sessionStorage.setItem('skuf_session_pw', document.getElementById('login-password').value);
            state.user.token = data.access_token;
            state.user.password = document.getElementById('login-password').value; // Temporary store for E2EE key sync
            document.documentElement.classList.add('is-logged-in'); // FIX: Ensure UI state updates
            authOverlay.style.display = 'none';
            addLog('Аутентификация успешна', 'system');
            
            // Re-bind auth logic on boot system
            bootSystem();
        } catch (err) {
            document.getElementById('login-error').textContent = err.message;
        } finally {
            if (btn) btn.textContent = 'ВОЙТИ В СЕТЬ';
        }
    });

    const unlockForm = document.getElementById('unlock-form');
    if (unlockForm) {
        unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            if (btn) btn.textContent = 'ОЖИДАНИЕ...';
            try {
                const pwd = document.getElementById('unlock-password').value;
                if (!pwd) throw new Error('Password is required');
                sessionStorage.setItem('skuf_session_pw', pwd);
                state.user.password = pwd;
                
                // Retry key loading
                await window.ensureKeys();
                
                document.documentElement.classList.add('is-logged-in');
                authOverlay.style.display = 'none';
                addLog('Хранилище разблокировано', 'success');
                
                // Resume boot process
                bootSystem();
            } catch (err) {
                document.getElementById('unlock-error').textContent = err.message || 'Ошибка расшифровки';
            } finally {
                if (btn) btn.textContent = 'РАЗБЛОКИРОВАТЬ ВАЛТ';
            }
        });
    }

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('reg-submit-btn') || e.target.querySelector('button[type="submit"]');
        if (btn) btn.textContent = 'ОЖИДАНИЕ...';
        try {
            const pdConsent = document.getElementById('reg-pd-consent');
            const res = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('reg-username').value,
                    email: document.getElementById('reg-email').value,
                    password: document.getElementById('reg-password').value,
                    accepted_pd: pdConsent ? pdConsent.checked : false  // [ФЗ-152]
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Registration failed');

            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('auth-title').textContent = 'АВТОРИЗАЦИЯ';
            document.getElementById('login-username').value = document.getElementById('reg-username').value;
            document.getElementById('login-password').value = document.getElementById('reg-password').value;
            document.getElementById('login-error').textContent = 'Регистрация успешна. Выполните вход.';
            document.getElementById('login-error').style.color = '#00f2ff';
        } catch (err) {
            document.getElementById('reg-error').textContent = err.message;
        } finally {
            if (btn) btn.textContent = 'АКТИВИРОВАТЬ АККАУНТ';
        }
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('skuf_token');
            state.user.token = null;
            location.reload();
        });
    }

    bootSystem();
    syncGlobalAlerts();
    setInterval(syncGlobalAlerts, 30000);

    // --- PHASE 6 & 7: SETTINGS AND CONTACT SYNC UX ---
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            settingsModal.style.display = 'flex';

            // Fetch profile data
            try {
                const profile = await apiRequest('/me');
                if (profile && profile.handle) {
                    const handleInput = document.getElementById('settings-handle');
                    if (handleInput) handleInput.value = profile.handle.replace('@', '');
                }
            } catch (err) {
                console.error('Failed to load profile details', err);
            }
            
            // Set push notifications toggle state
            const pushToggle = document.getElementById('push-notifications-toggle');
            if (pushToggle) {
                pushToggle.checked = ('Notification' in window && Notification.permission === 'granted');
            }
        });
    }

const handleInput = document.getElementById('settings-handle');
    if (handleInput) {
        handleInput.addEventListener('blur', async (e) => {
            let newVal = e.target.value.trim();
            if (newVal && !newVal.startsWith('@')) {
                newVal = '@' + newVal;
            }
            try {
                await apiRequest('/me/update', 'POST', { handle: newVal });
                addLog('Короткое имя обновлено', 'success');
            } catch (err) {
                addLog('Ошибка при сохранении имени', 'error');
            }
        });
    }

    window.saveProfileHandle = async function() {
        const input = document.getElementById('settings-handle');
        if (!input) return;
        
        let newVal = input.value.trim();
        if (newVal && !newVal.startsWith('@')) {
            newVal = '@' + newVal;
            input.value = newVal;
        }
        
        const btn = document.getElementById('btn-save-profile');
        if (btn) btn.innerHTML = 'СОХРАНЕНИЕ...';
        
        try {
            const result = await apiRequest('/me/update', 'POST', { handle: newVal });
            
            if (result.handle_status === 'already_set') {
                if (window.showToast) window.showToast('ℹ️ У вас уже сохранён данный handle');
                addLog('У вас уже сохранен данный handle', 'info');
                if (btn) {
                    btn.innerHTML = 'УЖЕ СОХРАНЁН ✓';
                    btn.style.background = 'rgba(0, 255, 65, 0.2)';
                    btn.style.color = '#00ff41';
                    btn.style.borderColor = '#00ff41';
                }
            } else {
                addLog('Профиль успешно сохранен', 'success');
                if (window.showToast) window.showToast('✅ Handle успешно сохранен');
                if (btn) {
                    btn.innerHTML = 'СОХРАНЕНО ✓';
                    btn.style.background = 'rgba(0, 255, 65, 0.2)';
                    btn.style.color = '#00ff41';
                    btn.style.borderColor = '#00ff41';
                }
            }
            
            if (btn) {
                setTimeout(() => { 
                    btn.innerHTML = 'СОХРАНИТЬ ПРОФИЛЬ'; 
                    btn.style = 'width: 100%; border-radius: 8px; font-size: 13px; padding: 10px;';
                }, 2800);
            }
        } catch (err) {
            const isTaken = err.status === 409 || err.code === 'HANDLE_TAKEN' || (err.message && err.message.includes('занят'));
            
            if (isTaken) {
                if (window.showToast) window.showToast('⚠️ Данный handle уже занят');
                addLog('Данный handle уже занят', 'error');
                if (btn) btn.innerHTML = 'ЗАНЯТ ✕';
            } else {
                addLog('Ошибка при сохранении', 'error');
                if (btn) btn.innerHTML = 'ОШИБКА';
            }
            
            if (btn) {
                btn.style.background = 'rgba(255, 51, 51, 0.2)';
                btn.style.color = '#ff3333';
                btn.style.borderColor = '#ff3333';
                setTimeout(() => { 
                    btn.innerHTML = 'СОХРАНИТЬ ПРОФИЛЬ'; 
                    btn.style = 'width: 100%; border-radius: 8px; font-size: 13px; padding: 10px;';
                }, 2800);
            }
        }
    };

    const themeSelect = document.getElementById('settings-theme-select');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            document.body.setAttribute('data-theme', e.target.value);
            localStorage.setItem('skufia_theme', e.target.value);
        });
        // Restore theme on boot
        const savedTheme = localStorage.getItem('skufia_theme');
        if (savedTheme) {
            document.body.setAttribute('data-theme', savedTheme);
            themeSelect.value = savedTheme;
        }
    }

    const syncContactsBtn = document.getElementById('sync-contacts-btn');
    if (syncContactsBtn) {
        syncContactsBtn.addEventListener('click', async () => {
            syncContactsBtn.textContent = 'ИДЕТ ПОИСК...';
            try {
                if ('contacts' in navigator && 'ContactsManager' in window) {
                    const props = ['name', 'tel'];
                    const opts = { multiple: true };
                    const contacts = await navigator.contacts.select(props, opts);

                    if (contacts && contacts.length > 0) {
                        const payload = contacts.map(c => ({ name: c.name[0], phone: c.tel ? c.tel[0] : '' }));
                        const resp = await fetch(`${API_BASE_URL}/contacts/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.user.token}` },
                            body: JSON.stringify({ contacts: payload })
                        });
                        if (resp.ok) {
                            addLog(`Успешно подтянуто абонентов: ${contacts.length}`, 'success');
                            if(window.loadChatRooms) window.loadChatRooms(); // refresh sidebar 
                        } else throw new Error();
                    } else {
                        addLog('Контакты не выбраны', 'info');
                    }
                } else {
                    addLog('Contact Picker API не поддерживается на вашем устройстве. Backend Sync Mode активирован.', 'info');
                    // Fallback to manual sync trigger on backend
                    const resp = await fetch(`${API_BASE_URL}/contacts/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.user.token}` },
                        body: JSON.stringify({ contacts: [] })
                    });
                    if (resp.ok) addLog('Backend Sync завершен', 'success');
                }
            } catch (err) {
                addLog('Ошибка синхронизации контактов', 'error');
            } finally {
                syncContactsBtn.textContent = 'ПОДТЯНУТЬ КОНТАКТЫ';
                settingsModal.style.display = 'none';
            }
        });
    }


    // --- GLOBAL EXPOSURE ---
    window.loadForum = loadForum;
    window.loadWiki = loadWiki;
    window.loadMarket = loadMarket;
    window.loadRegistry = loadRegistry;
    // Extracted to chat_core.js
    window.loadTopicPosts = loadTopicPosts;
    window.likePost = likePost;
    window.likeWiki = likeWiki;
    window.switchView = switchView;
    // Extracted to chat_core.js
    // [FIX-06] Alias: selectChatRoom renders new #chat-input with inline onclick="window.sendChatMessage()"
    // window.sendChatMessage = sendChatMsg;
    window.openSkufenger = function() {
        window.open(window.location.pathname + '?app=skufenger', '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
    };

    // --- CONTACT SEARCH FILTER ---
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

    const contactSearchInput = document.getElementById('contact-search');
    if (contactSearchInput) {
        contactSearchInput.addEventListener('input', function() {
            const query = this.value.toLowerCase().trim();
            const items = document.querySelectorAll('#chat-rooms-list .sidebar-item');
            items.forEach(item => {
                const nameEl = item.querySelector('.sidebar-item-name');
                const name = nameEl ? nameEl.textContent.toLowerCase() : '';
                item.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    // --- CALL GATEWAY (audio/video) ---
    window.skufengerCall = function(isVideo) {
        if (!state.chat.currentRoomId) {
            if (typeof showToast === 'function') showToast('Сначала выберите контакт для звонка');
            return;
        }
        // FIX: was currentReceiverId (typo), correct field is receiverId
        const targetId = state.chat.receiverId || state.chat.currentRoomId;
        if (!window.RTCManagerInstance) {
            if (typeof showToast === 'function') showToast('⚠️ RTC модуль не инициализирован');
            return;
        }
        if (typeof showToast === 'function') showToast(`📞 Инициация ${isVideo ? 'видео' : 'аудио'} звонка...`);
        window.RTCManagerInstance.startCall(targetId, isVideo);
    };

    // --- CHAT OPTIONS DROPDOWN ---
    // FIX: accept event and call stopPropagation so the same click doesn't
    // bubble up to document and immediately close the dropdown we just opened
    window.toggleChatOptions = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const dd = document.getElementById('chat-options-dropdown');
        if (!dd) return;
        const isOpen = dd.style.display !== 'none';
        dd.style.display = isOpen ? 'none' : 'block';
    };

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        const dd = document.getElementById('chat-options-dropdown');
        const wrapper = e.target.closest('.chat-options-wrapper');
        if (dd && !wrapper) {
            dd.style.display = 'none';
        }
    });

    // --- CONTACT PROFILE ---
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

    // --- CHAT OPTION ACTIONS ---
    window.chatOptionAction = function(action) {
        const dd = document.getElementById('chat-options-dropdown');
        if (dd) dd.style.display = 'none';

        switch(action) {
            case 'mute': {
                const roomId = state.chat.currentRoomId;
                if (!roomId) { addLog('Сначала выберите чат', 'error'); return; }
                const mutedRooms = JSON.parse(localStorage.getItem('skuf_muted_rooms') || '[]');
                const idx = mutedRooms.indexOf(roomId);
                if (idx === -1) {
                    mutedRooms.push(roomId);
                    addLog('🔕 Уведомления чата отключены', 'info');
                } else {
                    mutedRooms.splice(idx, 1);
                    addLog('🔔 Уведомления чата включены', 'info');
                }
                localStorage.setItem('skuf_muted_rooms', JSON.stringify(mutedRooms));
                break;
            }
            case 'search': {
                const chatHistory = document.getElementById('chat-history');
                if (!chatHistory) return;
                const term = prompt('Поиск по сообщениям:');
                if (!term || !term.trim()) return;
                const messages = chatHistory.querySelectorAll('.chat-msg');
                let found = 0;
                messages.forEach(msg => {
                    const bodyEl = msg.querySelector('.msg-body');
                    if (!bodyEl) return;
                    const text = bodyEl.textContent || '';
                    if (text.toLowerCase().includes(term.toLowerCase())) {
                        msg.style.outline = '2px solid var(--accent-cyan)';
                        msg.style.outlineOffset = '2px';
                        if (!found) msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        found++;
                    } else {
                        msg.style.outline = 'none';
                    }
                });
                addLog(`🔍 Найдено совпадений: ${found}`, found ? 'info' : 'error');
                break;
            }
            case 'wallpaper': {
                const chatHistory = document.getElementById('chat-history');
                if (!chatHistory) return;
                const wallpapers = [
                    'linear-gradient(135deg, rgba(10,14,20,0.95), rgba(20,30,50,0.95))',
                    'linear-gradient(135deg, rgba(30,10,30,0.95), rgba(15,15,35,0.95))',
                    'linear-gradient(135deg, rgba(10,25,20,0.95), rgba(15,20,35,0.95))',
                    'linear-gradient(135deg, rgba(25,20,10,0.95), rgba(20,15,25,0.95))',
                    'none'
                ];
                const current = localStorage.getItem('skuf_wallpaper_idx') || '0';
                const next = (parseInt(current) + 1) % wallpapers.length;
                chatHistory.style.background = wallpapers[next];
                localStorage.setItem('skuf_wallpaper_idx', String(next));
                addLog('🎨 Фон чата обновлён', 'info');
                break;
            }
            case 'clear': {
                if (!state.chat.currentRoomId) { addLog('Сначала выберите чат', 'error'); return; }
                if (!confirm('Очистить историю сообщений? Это действие необратимо.')) return;
                const chatHistory = document.getElementById('chat-history');
                if (chatHistory) {
                    chatHistory.innerHTML = '<div class="chat-placeholder">История очищена</div>';
                }
                addLog('🗑️ История чата очищена', 'info');
                break;
            }
            case 'encryption': {
                const badge = document.getElementById('chat-encryption-status');
                const isE2EE = badge && badge.textContent.includes('E2EE');
                alert(isE2EE

? '🔒 Этот чат защищён сквозным шифрованием (E2EE).\nКлючи сессии генерируются локально и не передаются на сервер.'
                    : '⚠️ Шифрование не активно.\nВыберите приватный чат для активации E2EE.');
                break;
            }
        }
    };
});

// Telegram-like Sidebar Search Toggle
function toggleSidebarSearch(show) {
    const defaultHeader = document.getElementById("sidebar-default-header");
    const searchHeader = document.getElementById("sidebar-active-search");
    const searchInput = document.getElementById("contact-search");

    if (show) {
        defaultHeader.style.display = "none";
        searchHeader.style.display = "flex";
        if (searchInput) {
            searchInput.focus();
        }
    } else {
        defaultHeader.style.display = "flex";
        searchHeader.style.display = "none";
        if (searchInput) {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));
        }
    }
}


// Settings Avatar Preview + Upload (Cropper)
window.cropperInstance = null;

window.previewAvatar = function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    
    // Show modal immediately to provide fast UI feedback
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.style.display !== 'none') {
        window._wasSettingsOpen = true;
        settingsModal.style.display = 'none';
    } else {
        window._wasSettingsOpen = false;
    }
    document.getElementById('avatar-crop-modal').style.display = 'flex';
    
    // Destroy previous cropper if exists
    if (window.cropperInstance) {
        window.cropperInstance.destroy();
        window.cropperInstance = null;
    }
    
    // Clear image target while loading
    const image = document.getElementById('crop-image-target');
    if (image) image.src = '';
    
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
            
            if (window.showToast) window.showToast('⏳ Загрузка фото...');
            
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
            
            if (typeof addLog === 'function') addLog('Аватарка успешно обновлена', 'success');
            if (window.showToast) window.showToast('✅ Фото профиля обновлено!');
            
        } catch (e) {
            console.error('Avatar upload error:', e);
            if (typeof addLog === 'function') addLog(`❌ Ошибка загрузки: ${e.message}`, 'error');
            if (window.showToast) window.showToast('❌ Ошибка загрузки: ' + e.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = 'СОХРАНИТЬ';
            }
            window.closeCropModal();
        }
    }, 'image/jpeg', 0.85);
};




// --- MODULE: CHANNEL/GROUP MEMBER MANAGEMENT ---
window.openAddMemberModal = async function() {
    const roomId = state.chat.activeRoomId;
    if (!roomId) return;

    document.getElementById('add-member-modal').style.display = 'flex';
    document.getElementById('add-member-search').value = '';
    const listContainer = document.getElementById('add-member-list');
    listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Загрузка контактов...</div>';

    try {
        const contacts = await apiRequest('/contacts');
        state.contacts = contacts || [];
        window.filterAddMemberContacts();
    } catch(e) {
        console.error('Error fetching contacts for add member:', e);
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#ff3333;">Ошибка загрузки</div>';
    }
};

window.filterAddMemberContacts = function() {
    const query = document.getElementById('add-member-search').value.toLowerCase();
    const listContainer = document.getElementById('add-member-list');
    listContainer.innerHTML = '';

    const filtered = state.contacts.filter(c => 
        c.username.toLowerCase().includes(query) || 
        (c.display_name && c.display_name.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Ничего не найдено</div>';
        return;
    }

    filtered.forEach(contact => {
        const div = document.createElement('div');

div.className = 'sidebar-item';
        div.style.marginBottom = '5px';
        const initial = (contact.display_name || contact.username).charAt(0).toUpperCase();

        div.innerHTML = `
            <div class="sidebar-item-avatar">${contact.avatar_url ? `<img src="${API_BASE_URL}${contact.avatar_url}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : initial}</div>
            <div class="sidebar-item-info">
                <div class="sidebar-item-name">${contact.display_name || contact.username}</div>
                <div class="sidebar-item-last-msg">@${contact.username}</div>
            </div>
            <input type="checkbox" class="add-member-checkbox" value="${contact.id}" style="width: 20px; height: 20px; cursor: pointer;">
        `;
        listContainer.appendChild(div);
    });
};

window.submitAddMembers = async function() {
    const roomId = state.chat.activeRoomId;
    if (!roomId) return;

    const checkboxes = document.querySelectorAll('.add-member-checkbox:checked');
    const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (userIds.length === 0) {
        addLog('Выберите хотя бы один контакт', 'error');
        return;
    }

    try {
        for (let uid of userIds) {
            await apiRequest(`/chat/rooms/${roomId}/members`, 'POST', { user_id: uid });
        }
        addLog(`Добавлено участников: ${userIds.length}`, 'success');
        document.getElementById('add-member-modal').style.display = 'none';
    } catch(e) {
        console.error('Error adding members:', e);
        addLog('Ошибка при добавлении', 'error');
    }
};

// --- CREATOR PLAQUE AND MATRIX BRANDING ---
window.openCreatorPlaque = function(e) {
    if (e) e.preventDefault();
    document.getElementById('creator-plaque-modal').style.display = 'flex';
};

// Matrix Scramble Text Effect function
class ScrambleText {
    constructor(el, delay = 0) {
        this.el = el;
        // Matrix style: Latin, Cyrillic, Numbers, and classic Katakana
        this.chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЗИКЛМНОПРСТУФХЦЧШЩЮЯ0123456789アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲン';
        this.original = el.getAttribute('data-text') || el.innerText;
        this.delay = delay;
    }
    start() {
        // Immediately obfuscate the text so original isn't visible during the delay
        let initialScrambled = '';
        for (let i = 0; i < this.original.length; i++) {
            initialScrambled += this.chars[Math.floor(Math.random() * this.chars.length)];
        }
        this.el.innerText = initialScrambled;

        setTimeout(() => {
            let iteration = 0;
            const maxIterations = 20;
            const interval = setInterval(() => {
                let scrambled = '';
                for (let i = 0; i < this.original.length; i++) {
                    if (i < iteration / 2) {
                        scrambled += this.original[i];
                    } else {
                        scrambled += this.chars[Math.floor(Math.random() * this.chars.length)];
                    }
                }
                this.el.innerText = scrambled;
                if (iteration >= maxIterations) {
                    clearInterval(interval);
                    this.el.innerText = this.original;
                }
                iteration++;
            }, 30);
        }, this.delay);
    }
}

// Initialize scramble text effects globally across the board
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        document.querySelectorAll('.scramble-text').forEach((el, index) => {
            const delay = index * 250;
            new ScrambleText(el, 100 + delay).start();
        });
    }, 500); // Give rendering a brief moment before scrambling
});

// --- MOBILE MENU LOGIC (SANDWICH) ---
const mobileToggle = document.getElementById('mobile-menu-toggle');
const sidePanel = document.getElementById('side-panel');
if (mobileToggle && sidePanel) {
    // Create backdrop for mobile sidebar
    const backdrop = document.createElement('div');
    backdrop.id = 'mobile-backdrop';

backdrop.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(4px); z-index:998; opacity:0; transition:opacity 0.3s ease;';

    // Append to app-container to share stacking context with side-panel 
    const container = document.querySelector('.app-container') || document.body;
    container.appendChild(backdrop);

    mobileToggle.addEventListener('click', () => {
        const isOpen = sidePanel.classList.toggle('open-mobile');
        if (isOpen) {
            backdrop.style.display = 'block';
            setTimeout(() => backdrop.style.opacity = '1', 10);
        } else {
            backdrop.style.opacity = '0';
            setTimeout(() => backdrop.style.display = 'none', 300);
        }
    });

    backdrop.addEventListener('click', () => {
        sidePanel.classList.remove('open-mobile');
        backdrop.style.opacity = '0';
        setTimeout(() => backdrop.style.display = 'none', 300);
    });

    // Close menu when navigating on mobile
    document.querySelectorAll('.side-panel .nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if(window.innerWidth <= 768) {
                sidePanel.classList.remove('open-mobile');
                backdrop.style.opacity = '0';
                setTimeout(() => backdrop.style.display = 'none', 300);
            }
        });
    });
}

// =============================================================================
// PWA NATIVE FEEL: Dynamic viewport height + Back button navigation
// =============================================================================

/**
 * Fix #1 — Address bar overlap
 * Yandex Browser (and Chrome/Firefox on Android) shrink the visual viewport
 * when the address bar appears. We keep --app-height in sync with the actual
 * visible area so nothing gets hidden behind the browser chrome.
 */
(function setupViewportHeight() {
    function setAppHeight() {
        // visualViewport.height is the visible area excluding browser UI
        const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', h + 'px');
        
        // Ensure chat history scrolls to bottom when layout resizes (e.g. keyboard opens)
        const historyEl = document.getElementById('chat-history');
        if (historyEl) {
            // Minimal delay to ensure DOM layout has updated
            setTimeout(() => {
                historyEl.scrollTop = historyEl.scrollHeight;
            }, 10);
        }
    }

    setAppHeight();

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setAppHeight);
        window.visualViewport.addEventListener('scroll', setAppHeight);
    }
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300));
})();

/**
 * Fix #2 — Back button behavior
 * Without history management, any back press exits the PWA.
 * We push a state entry on each view/chat navigation so the browser
 * back button navigates within the app instead of closing it.
 */
(function setupHistoryBackNav() {
    // Push initial state so there's always a "home" entry
    if (!history.state || !history.state.skufia) {
        history.replaceState({ skufia: true, view: 'home', chat: false }, '');
    }

    // Patch switchView to push history
    const _originalSwitchView = window._switchViewInternal;

    window.addEventListener('popstate', (event) => {
        const s = event.state;
        if (!s || !s.skufia) return;

        if (!s.chat) {
            // Not in chat — ensure chat panel is closed
            const chatLayout = document.querySelector('.chat-layout');
            if (chatLayout && chatLayout.classList.contains('chat-open')) {
                chatLayout.classList.remove('chat-open');
            }
        } else {
            // In chat - ensure chat is open
            const chatLayout = document.querySelector('.chat-layout');
            if (chatLayout && !chatLayout.classList.contains('chat-open')) {
                chatLayout.classList.add('chat-open');
            }
        }

        if (s.view && s.view !== 'home') {
            // Switch to previous view without pushing new state (we're going back)
            const views = document.querySelectorAll('.view');
            const navBtns = document.querySelectorAll('.nav-btn');
            views.forEach(v => v.classList.remove('active'));
            navBtns.forEach(b => b.classList.remove('active'));
            const targetView = document.getElementById(`view-${s.view}`);
            if (targetView) targetView.classList.add('active');
            const targetBtn = document.querySelector(`.nav-btn[data-view="${s.view}"]`);
            if (targetBtn) targetBtn.classList.add('active');
        }

// If view === 'home' or no view: the app stays open (we have replaceState for home)
    });

    // Intercept nav button clicks to push state
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            history.pushState({ skufia: true, view: viewId, chat: false }, '', `#${viewId}`);
        });
    });
})();


window.openSettingsModal = function() {
    const m = document.getElementById('settings-modal');
    if (m) m.style.display = 'flex';
    if (!window.location.hash.includes('settings')) {
        history.pushState({ modal: 'settings' }, '', '#settings');
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
});
