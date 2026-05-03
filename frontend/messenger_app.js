document.addEventListener('DOMContentLoaded', () => {
    // --- Viewport Height Fix for Mobile & Scroll Anchoring ---
    let lastViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
        document.documentElement.style.setProperty('--app-offset', `${offset}px`);
        
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
                if (typeof VideoCircleService !== 'undefined') new VideoCircleService();
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

            // --- CHECK FOR BACKGROUND CALL INTENT ---
            if (window.location.hash.includes('call_action=')) {
                const params = new URLSearchParams(window.location.hash.substring(1));
                const action = params.get('call_action');
                const callerId = params.get('caller_id');
                if (callerId) {
                    window.history.replaceState(null, '', window.location.pathname); // Clean URL
                    if (action === 'accept' || action === 'open') {
                        if (window.RTCManagerInstance) {
                            if (action === 'accept') window.RTCManagerInstance.autoAcceptCallerId = parseInt(callerId, 10);
                            // Wait for WS to be fully ready before requesting offer
                            const attemptSend = () => {
                                if (state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
                                    window.sendSocketEvent('rtc_signal', { target: parseInt(callerId, 10), signal_type: 'request_offer' });
                                } else {
                                    setTimeout(attemptSend, 200);
                                }
                            };
                            attemptSend();
                        }
                    }
                }
            }

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
                    } else if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                        const notifData = event.data.data;
                        const action = event.data.action;
                        if (notifData && notifData.action === 'call') {
                            const callerId = parseInt(notifData.sender_id, 10);
                            if (action === 'accept' || action === '') {
                                if (window.RTCManagerInstance) {
                                    if (action === 'accept') window.RTCManagerInstance.autoAcceptCallerId = callerId;
                                    window.sendSocketEvent('rtc_signal', { target: callerId, signal_type: 'request_offer' });
                                }
                            } else if (action === 'decline') {
                                window.sendSocketEvent('rtc_signal', { target: callerId, signal_type: 'reject' });
                                if (window.RTCManagerInstance) window.RTCManagerInstance.endCall(false);
                            }
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
    const pushToggle = document.getElementById('push-notifications-toggle');
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

    // ── App Installation (PWA) ──────────────────────────────────────────────
    
    // Android Install Prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Optionally, show a custom install button/banner here if needed
        console.log('[PWA] beforeinstallprompt event captured');
    });

    // iOS Install Banner
    function checkAndShowIOSInstallBanner() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const isStandalone = window.navigator.standalone === true;
        const dismissed = localStorage.getItem('skufia_ios_install_dismissed') === 'true';

        if (isIOS && !isStandalone && !dismissed) {
            const banner = document.createElement('div');
            banner.id = 'ios-install-banner';
            banner.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--surface-2);
                border: 1px solid var(--border-color);
                border-radius: 12px;
                padding: 16px;
                width: 90%;
                max-width: 400px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                color: var(--text-primary);
                font-family: var(--font-primary);
                animation: slideUp 0.5s ease-out forwards;
            `;
            banner.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Установите приложение</h3>
                    <button id="close-ios-banner" style="background: none; border: none; color: var(--text-secondary); font-size: 20px; cursor: pointer; padding: 0;">&times;</button>
                </div>
                <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.4;">
                    Для работы <b>push-уведомлений</b> и работы в фоне, установите SKUFenger на домашний экран.
                </p>
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; font-size: 14px;">
                    1. Нажмите иконку <b>Поделиться</b> <span style="font-size: 18px; vertical-align: middle;">&#8681;</span><br>
                    2. Выберите <b>На экран «Домой»</b> <span style="font-size: 18px; vertical-align: middle;">&#8862;</span>
                </div>
            `;

            // Keyframe animation needs to be injected if it doesn't exist
            if (!document.getElementById('ios-banner-keyframes')) {
                const style = document.createElement('style');
                style.id = 'ios-banner-keyframes';
                style.innerHTML = `
                    @keyframes slideUp {
                        from { transform: translate(-50%, 100%); opacity: 0; }
                        to { transform: translate(-50%, 0); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(banner);

            document.getElementById('close-ios-banner').addEventListener('click', () => {
                banner.style.display = 'none';
                localStorage.setItem('skufia_ios_install_dismissed', 'true');
            });
        }
    }
    
    // Check after a short delay so it doesn't interrupt immediate rendering
    setTimeout(checkAndShowIOSInstallBanner, 2000);

    // ── Push Notifications ──────────────────────────────────────────────────
    /**
     * Convert a base64 URL-safe string to a Uint8Array (required for VAPID key).
     */
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    }

    function isIos() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    function isStandalone() {
        return ('standalone' in navigator && navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
    }

    async function registerPushSubscription() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[Push] Browser does not support push notifications.');
            if (window.showToast) window.showToast('⚠️ Ваш браузер не поддерживает Push-уведомления.');
            return;
        }

        if (isIos() && !isStandalone()) {
            if (window.showToast) window.showToast('⚠️ На iPhone/iPad уведомления работают только при установке на экран "Домой" (Share -> На экран "Домой")');
            alert('Для включения уведомлений на iPhone/iPad:\n1. Нажмите иконку "Поделиться" (квадрат со стрелкой)\n2. Выберите "На экран «Домой»" (Add to Home Screen)\n3. Откройте добавленное приложение и включите уведомления там.');
            if (pushToggle) pushToggle.checked = false;
            return;
        }
        try {
            // 1. Ask permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('[Push] Permission denied by user.');
                if (pushToggle) pushToggle.checked = false;
                localStorage.setItem('skufia_push', 'false');
                return;
            }

            // 2. Get VAPID public key from server
            const vapidData = await apiRequest('/notifications/vapidPublicKey').catch(() => null);
            if (!vapidData || !vapidData.publicKey) {
                console.error('[Push] Could not get VAPID public key from server.');
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidData.publicKey);

            // 3. Subscribe via pushManager
            const reg = await navigator.serviceWorker.ready;
            let subscription;
            try {
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });
            } catch (subscribeError) {
                console.warn('[Push] Subscribe failed, possibly due to old VAPID key. Unsubscribing and retrying...', subscribeError);
                try {
                    const existingSub = await reg.pushManager.getSubscription();
                    if (existingSub) {
                        await existingSub.unsubscribe();
                    }
                    subscription = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey
                    });
                } catch (retryError) {
                    throw retryError;
                }
            }

            // 4. Send subscription to backend
            const subJson = subscription.toJSON();
            await apiRequest('/notifications/subscribe', 'POST', {
                endpoint: subJson.endpoint,
                keys: subJson.keys
            });

            localStorage.setItem('skufia_push', 'true');
            if (pushToggle) pushToggle.checked = true;
            console.log('[Push] ✅ Subscribed successfully.');
            if (window.showToast) window.showToast('🔔 Уведомления включены');
        } catch (e) {
            console.error('[Push] Subscription failed:', e);
            if (pushToggle) pushToggle.checked = false;
            localStorage.setItem('skufia_push', 'false');
        }
    }

    async function unregisterPushSubscription() {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await apiRequest('/notifications/unsubscribe?endpoint=' + encodeURIComponent(sub.endpoint), 'DELETE').catch(() => {});
                await sub.unsubscribe();
            }
            localStorage.setItem('skufia_push', 'false');
            if (window.showToast) window.showToast('🔕 Уведомления отключены');
            console.log('[Push] Unsubscribed.');
        } catch (e) {
            console.error('[Push] Unsubscribe error:', e);
        }
    }

    // Auto-subscribe if user previously granted permission and opted in
    (async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const savedPref = localStorage.getItem('skufia_push');
        if (pushToggle) {
            pushToggle.checked = savedPref === 'true';
        }
        // If previously opted in AND browser already has permission, silently re-subscribe
        if (savedPref === 'true' && Notification.permission === 'granted') {
            try {
                const reg = await navigator.serviceWorker.ready;
                const existing = await reg.pushManager.getSubscription();
                if (!existing) {
                    // Subscription expired - re-subscribe silently
                    await registerPushSubscription();
                } else {
                    // Refresh subscription on server in case endpoint changed
                    const subJson = existing.toJSON();
                    await apiRequest('/notifications/subscribe', 'POST', {
                        endpoint: subJson.endpoint,
                        keys: subJson.keys
                    }).catch(() => {});
                }
            } catch(e) { console.warn('[Push] Auto-subscribe check failed:', e); }
        }
    })();

    if (pushToggle) {
        pushToggle.addEventListener('change', async (e) => {
            if (e.target.checked) {
                await registerPushSubscription();
            } else {
                await unregisterPushSubscription();
            }
        });
    }

    // Expose globally for settings page access
    window.registerPushSubscription = registerPushSubscription;
    window.unregisterPushSubscription = unregisterPushSubscription;
    // ── End Push Notifications ───────────────────────────────────────────────

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
                    throw new Error('Введен неверный пароль. Доступ к сообщениям приостановлен.');
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

    t.addEventListener('DOMContentLoaded', () => {
    // Dynamic height calculation for mobile viewport consistency
    function setAppHeight() {
        document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    }
    window.addEventListener('resize', setAppHeight);
    setAppHeight();

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
    function switchView(viewId, pushState = true) {
        views.forEach(v => v.classList.remove('active'));
        navBtns.forEach(b => b.classList.remove('active'));

        const activeView = document.getElementById(`view-${viewId}`);
        if (activeView) {
            activeView.classList.add('active');
            state.currentView = viewId;
            const activeBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
            if (activeBtn) activeBtn.classList.add('active');
            addLog(`Switching to sector: ${viewId.toUpperCase().replace('_', ' ')}`);

            if (pushState) {
                history.pushState({ view: viewId }, '', '#' + viewId);
            }

            // Hide inner modals/views if returning to main section
            if (viewId === 'wiki') {
                const modal = document.getElementById('wiki-modal');
                if (modal) modal.style.display = 'none';
            }
            if (viewId === 'forum') {
                const threadView = document.getElementById('forum-thread-view');
                if (threadView) threadView.style.display = 'none';
                const list = document.getElementById('forum-list');
                if (list) list.style.display = 'flex';
            }

            // Trigger data loads based on view
            if (viewId === 'forum') loadForum();
            if (viewId === 'wiki') loadWiki();
            if (viewId === 'trade') loadMarket();
            if (viewId === 'registry') loadRegistry();
            if (viewId === 'messages') { if(window.loadChatRooms) window.loadChatRooms(); }
            if (viewId === 'events') loadEvents();
            if (viewId === 'dashboard') loadDashboard();
        } else if (viewId === 'messages') {
            window.location.href = 'messenger.html';
        }
    }

    // Handle browser back/forward buttons
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.view) {
            switchView(e.state.view, false);
        } else if (e.state && e.state.topicId) {
            if (window.loadTopicPosts) window.loadTopicPosts(e.state.topicId, e.state.title, false);
        } else if (e.state && e.state.wikiId) {
            if (window.loadWikiArticle) window.loadWikiArticle(e.state.wikiId, false);
        } else if (window.location.hash) {
            const hash = window.location.hash.substring(1);
            if (hash.startsWith('forum-topic-')) {
                const id = hash.replace('forum-topic-', '');
                if (window.loadTopicPosts) window.loadTopicPosts(id, 'Тема форума', false);
            } else if (hash.startsWith('wiki-article-')) {
                const id = hash.replace('wiki-article-', '');
                if (window.loadWikiArticle) window.loadWikiArticle(id, false);
            } else {
                switchView(hash, false);
            }
        } else {
            // Default to home/chat
            switchView('messages', false);
        }
    });


    // Chat logic extracted to chat_core.js
    window.WS_URL = WS_URL;
    window.switchView = switchView;
    if (window.initChatCore) {
        window.initChatCore();
    }
    // --- SYSTEM BOOT & ALERTS ---
    async function bootSystem() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('install') === '1') {
            document.getElementById('auth-overlay').style.display = 'none';
            document.getElementById('install-overlay').style.display = 'flex';
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('chat-sw.js').catch(console.error);
            }
            return;
        }

        if (!state.user.token) {
            document.getElementById('auth-overlay').style.display = 'flex';
            // Wait for user to log in
            return;
        } else {
            document.getElementById('auth-overlay').style.display = 'none';
        }

        // Initialize Phase 2 Engines
        new VoiceRecorderService();
        new VideoCircleService();
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

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });

            function showUpdateBanner(worker) {
                const banner = document.getElementById('pwa-update-banner');
                const btn = document.getElementById('pwa-update-btn');
                if (banner && btn) {
                    banner.style.display = 'flex';
                    btn.onclick = async () => {
                        banner.style.display = 'none';
                        try {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(key => caches.delete(key)));
                            console.log('[SW] Cache wiped for update');
                        } catch (e) {
                            console.error('[SW] Cache wipe error:', e);
                        }
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    };
                }
            }

            navigator.serviceWorker.ready.then(reg => {
                if (reg.waiting) {
                    showUpdateBanner(reg.waiting);
                }
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateBanner(newWorker);
                        }
                    });
                });
            });

            // Listen for SW_UPDATED message — auto-reload page to apply new version
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'SW_UPDATED') {
                    console.log('[app.js] New version detected:', event.data.version);
                    // Auto-reload after 2 seconds to apply the new SW cache
                    setTimeout(() => {
                        if (!window._swReloading) {
                            window._swReloading = true;
                            window.location.reload();
                        }
                    }, 2000);
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

    function isIos() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    function isStandalone() {
        return ('standalone' in navigator && navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
    }

    window.togglePushNotifications = async function(checkbox) {
        if (checkbox.checked) {
            if (isIos() && !isStandalone()) {
                if (window.showToast) window.showToast('⚠️ На iPhone/iPad уведомления работают только при установке на экран "Домой" (Share -> На экран "Домой")');
                alert('Для включения уведомлений на iPhone/iPad:\n1. Нажмите иконку "Поделиться" (квадрат со стрелкой)\n2. Выберите "На экран «Домой»" (Add to Home Screen)\n3. Откройте добавленное приложение и включите уведомления там.');
                checkbox.checked = false;
                return;
            }

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
        
        // Setup direct install button (standalone installer)
        const directBtn = document.getElementById('direct-install-btn');
        const statusText = document.getElementById('install-status-text');
        if (directBtn) {
            directBtn.style.display = 'block';
            if (statusText) statusText.style.display = 'none';
            directBtn.addEventListener('click', async (clickEvent) => {
                clickEvent.preventDefault();
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    addLog('PWA Installation Accepted', 'success');
                    if (statusText) {
                        statusText.textContent = 'Установка начата. Вы можете закрыть эту страницу.';
                        statusText.style.display = 'block';
                    }
                    directBtn.style.display = 'none';
                }
                deferredPrompt = null;
            });
        }

        // Setup in-app header install button
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
                document.getElementById('unlock-error').textContent = err.message || 'Неверный пароль';
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
        const targetId = state.chat.receiverId || state.chat.currentRoomId;
        if (!window.RTCManagerInstance) {
            if (typeof showToast === 'function') showToast('⚠️ RTC модуль не инициализирован');
            return;
        }

        // Resolve caller name and avatar from rooms list
        let targetName = 'User ' + targetId;
        let targetAvatar = '<div class="avatar-placeholder" style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#555;font-size:40px;">?</div>';

        if (state.chat && state.chat.rooms) {
            const room = state.chat.rooms.find(r => r.id == targetId || r.other_user_id == targetId);
            if (room) {
                targetName = room.name || room.id;
                if (room.avatar_url) {
                    targetAvatar = `<img src="${room.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='<div class=\\'avatar-placeholder\\' style=\\'width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#555;font-size:40px;\\'>&quest;</div>'">`;
                } else {
                    targetAvatar = `<div class="avatar-placeholder" style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--accent-cyan);color:#000;font-size:40px;font-weight:bold;">${targetName.charAt(0).toUpperCase()}</div>`;
                }
            }
        }

        if (typeof showToast === 'function') showToast(`📞 Инициация ${isVideo ? 'видео' : 'аудио'} звонка...`);
        window.RTCManagerInstance.startCall(targetId, targetName, targetAvatar, isVideo);
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
    cument.addEventListener('DOMContentLoaded', () => {
    // --- Viewport Height Fix for Mobile & Scroll Anchoring ---
    let lastViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
        document.documentElement.style.setProperty('--app-offset', `${offset}px`);
        
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
                if (typeof VideoCircleService !== 'undefined') new VideoCircleService();
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

            // --- CHECK FOR BACKGROUND CALL INTENT ---
            if (window.location.hash.includes('call_action=')) {
                const params = new URLSearchParams(window.location.hash.substring(1));
                const action = params.get('call_action');
                const callerId = params.get('caller_id');
                if (callerId) {
                    window.history.replaceState(null, '', window.location.pathname); // Clean URL
                    if (action === 'accept' || action === 'open') {
                        if (window.RTCManagerInstance) {
                            if (action === 'accept') window.RTCManagerInstance.autoAcceptCallerId = parseInt(callerId, 10);
                            // Wait for WS to be fully ready before requesting offer
                            const attemptSend = () => {
                                if (state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
                                    window.sendSocketEvent('rtc_signal', { target: parseInt(callerId, 10), signal_type: 'request_offer' });
                                } else {
                                    setTimeout(attemptSend, 200);
                                }
                            };
                            attemptSend();
                        }
                    }
                }
            }

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
                    } else if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                        const notifData = event.data.data;
                        const action = event.data.action;
                        if (notifData && notifData.action === 'call') {
                            const callerId = parseInt(notifData.sender_id, 10);
                            if (action === 'accept' || action === '') {
                                if (window.RTCManagerInstance) {
                                    if (action === 'accept') window.RTCManagerInstance.autoAcceptCallerId = callerId;
                                    window.sendSocketEvent('rtc_signal', { target: callerId, signal_type: 'request_offer' });
                                }
                            } else if (action === 'decline') {
                                window.sendSocketEvent('rtc_signal', { target: callerId, signal_type: 'reject' });
                                if (window.RTCManagerInstance) window.RTCManagerInstance.endCall(false);
                            }
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
    const pushToggle = document.getElementById('push-notifications-toggle');
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

    // ── App Installation (PWA) ──────────────────────────────────────────────
    
    // Android Install Prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Optionally, show a custom install button/banner here if needed
        console.log('[PWA] beforeinstallprompt event captured');
    });

    // iOS Install Banner
    function checkAndShowIOSInstallBanner() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const isStandalone = window.navigator.standalone === true;
        const dismissed = localStorage.getItem('skufia_ios_install_dismissed') === 'true';

        if (isIOS && !isStandalone && !dismissed) {
            const banner = document.createElement('div');
            banner.id = 'ios-install-banner';
            banner.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--surface-2);
                border: 1px solid var(--border-color);
                border-radius: 12px;
                padding: 16px;
                width: 90%;
                max-width: 400px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                color: var(--text-primary);
                font-family: var(--font-primary);
                animation: slideUp 0.5s ease-out forwards;
            `;
            banner.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Установите приложение</h3>
                    <button id="close-ios-banner" style="background: none; border: none; color: var(--text-secondary); font-size: 20px; cursor: pointer; padding: 0;">&times;</button>
                </div>
                <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.4;">
                    Для работы <b>push-уведомлений</b> и работы в фоне, установите SKUFenger на домашний экран.
                </p>
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; font-size: 14px;">
                    1. Нажмите иконку <b>Поделиться</b> <span style="font-size: 18px; vertical-align: middle;">&#8681;</span><br>
                    2. Выберите <b>На экран «Домой»</b> <span style="font-size: 18px; vertical-align: middle;">&#8862;</span>
                </div>
            `;

            // Keyframe animation needs to be injected if it doesn't exist
            if (!document.getElementById('ios-banner-keyframes')) {
                const style = document.createElement('style');
                style.id = 'ios-banner-keyframes';
                style.innerHTML = `
                    @keyframes slideUp {
                        from { transform: translate(-50%, 100%); opacity: 0; }
                        to { transform: translate(-50%, 0); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(banner);

            document.getElementById('close-ios-banner').addEventListener('click', () => {
                banner.style.display = 'none';
                localStorage.setItem('skufia_ios_install_dismissed', 'true');
            });
        }
    }
    
    // Check after a short delay so it doesn't interrupt immediate rendering
    setTimeout(checkAndShowIOSInstallBanner, 2000);

    // ── Push Notifications ──────────────────────────────────────────────────
    /**
     * Convert a base64 URL-safe string to a Uint8Array (required for VAPID key).
     */
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    }

    function isIos() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    function isStandalone() {
        return ('standalone' in navigator && navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
    }

    async function registerPushSubscription() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[Push] Browser does not support push notifications.');
            if (window.showToast) window.showToast('⚠️ Ваш браузер не поддерживает Push-уведомления.');
            return;
        }

        if (isIos() && !isStandalone()) {
            if (window.showToast) window.showToast('⚠️ На iPhone/iPad уведомления работают только при установке на экран "Домой" (Share -> На экран "Домой")');
            alert('Для включения уведомлений на iPhone/iPad:\n1. Нажмите иконку "Поделиться" (квадрат со стрелкой)\n2. Выберите "На экран «Домой»" (Add to Home Screen)\n3. Откройте добавленное приложение и включите уведомления там.');
            if (pushToggle) pushToggle.checked = false;
            return;
        }
        try {
            // 1. Ask permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('[Push] Permission denied by user.');
                if (pushToggle) pushToggle.checked = false;
                localStorage.setItem('skufia_push', 'false');
                return;
            }

            // 2. Get VAPID public key from server
            const vapidData = await apiRequest('/notifications/vapidPublicKey').catch(() => null);
            if (!vapidData || !vapidData.publicKey) {
                console.error('[Push] Could not get VAPID public key from server.');
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidData.publicKey);

            // 3. Subscribe via pushManager
            const reg = await navigator.serviceWorker.ready;
            let subscription;
            try {
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });
            } catch (subscribeError) {
                console.warn('[Push] Subscribe failed, possibly due to old VAPID key. Unsubscribing and retrying...', subscribeError);
                try {
                    const existingSub = await reg.pushManager.getSubscription();
                    if (existingSub) {
                        await existingSub.unsubscribe();
                    }
                    subscription = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey
                    });
                } catch (retryError) {
                    throw retryError;
                }
            }

            // 4. Send subscription to backend
            const subJson = subscription.toJSON();
            await apiRequest('/notifications/subscribe', 'POST', {
                endpoint: subJson.endpoint,
                keys: subJson.keys
            });

            localStorage.setItem('skufia_push', 'true');
            if (pushToggle) pushToggle.checked = true;
            console.log('[Push] ✅ Subscribed successfully.');
            if (window.showToast) window.showToast('🔔 Уведомления включены');
        } catch (e) {
            console.error('[Push] Subscription failed:', e);
            if (pushToggle) pushToggle.checked = false;
            localStorage.setItem('skufia_push', 'false');
        }
    }

    async function unregisterPushSubscription() {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await apiRequest('/notifications/unsubscribe?endpoint=' + encodeURIComponent(sub.endpoint), 'DELETE').catch(() => {});
                await sub.unsubscribe();
            }
            localStorage.setItem('skufia_push', 'false');
            if (window.showToast) window.showToast('🔕 Уведомления отключены');
            console.log('[Push] Unsubscribed.');
        } catch (e) {
            console.error('[Push] Unsubscribe error:', e);
        }
    }

    // Auto-subscribe if user previously granted permission and opted in
    (async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const savedPref = localStorage.getItem('skufia_push');
        if (pushToggle) {
            pushToggle.checked = savedPref === 'true';
        }
        // If previously opted in AND browser already has permission, silently re-subscribe
        if (savedPref === 'true' && Notification.permission === 'granted') {
            try {
                const reg = await navigator.serviceWorker.ready;
                const existing = await reg.pushManager.getSubscription();
                if (!existing) {
                    // Subscription expired - re-subscribe silently
                    await registerPushSubscription();
                } else {
                    // Refresh subscription on server in case endpoint changed
                    const subJson = existing.toJSON();
                    await apiRequest('/notifications/subscribe', 'POST', {
                        endpoint: subJson.endpoint,
                        keys: subJson.keys
                    }).catch(() => {});
                }
            } catch(e) { console.warn('[Push] Auto-subscribe check failed:', e); }
        }
    })();

    if (pushToggle) {
        pushToggle.addEventListener('change', async (e) => {
            if (e.target.checked) {
                await registerPushSubscription();
            } else {
                await unregisterPushSubscription();
            }
        });
    }

    // Expose globally for settings page access
    window.registerPushSubscription = registerPushSubscription;
    window.unregisterPushSubscription = unregisterPushSubscription;
    // ── End Push Notifications ───────────────────────────────────────────────

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
                    throw new Error('Введен неверный пароль. Доступ к сообщениям приостановлен.');
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
                const roomId = state.chat.currentRoomId;
                if (!roomId) { addLog('Сначала выберите чат', 'error'); return; }

                const prefs = JSON.parse(localStorage.getItem('skuf_e2ee_prefs') || '{}');
                // By default E2EE is OFF, so if not set, it's false
                const isCurrentlyEnabled = !!prefs[roomId];
                const newState = !isCurrentlyEnabled;
                
                prefs[roomId] = newState;
                localStorage.setItem('skuf_e2ee_prefs', JSON.stringify(prefs));
                
                // Update UI indicator
                const badge = document.getElementById('chat-encryption-status');
                const e2eeIndicator = document.getElementById('e2ee-indicator');
                
                if (newState) {
                    if (badge) badge.textContent = '🔒 E2E';
                    if (e2eeIndicator) {
                        e2eeIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                        e2eeIndicator.style.color = '#00ff41'; // Green for encrypted
                    }
                    addLog('🔐 Шифрование (E2EE) ВКЛЮЧЕНО для этого чата', 'info');
                } else {
                    if (badge) badge.textContent = '🔓 Нет E2E';
                    if (e2eeIndicator) {
                        e2eeIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
                        e2eeIndicator.style.color = '#8a94a2'; // Gray for unencrypted
                    }
                    addLog('🔓 Шифрование (E2EE) ОТКЛЮЧЕНО для этого чата', 'error');
                }
                break;
            }
        }
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
