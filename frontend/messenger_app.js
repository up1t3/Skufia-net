document.addEventListener('DOMContentLoaded', () => {
    // --- Viewport Height Fix for Mobile ---
    function setAppHeight() {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
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

        console.log('BOOT: Token found. Initializing system...');
        
        // Show loading state on the overlay if it's still visible
        if (authOverlay && authOverlay.style.display !== 'none') {
            if (authTitle) authTitle.textContent = 'СИНХРОНИЗАЦИЯ...';
            const authBtn = authOverlay.querySelector('.auth-main-btn');
            if (authBtn) {
                authBtn.disabled = true;
                authBtn.textContent = 'ПОДКЛЮЧЕНИЕ...';
            }
        }

        try {
            console.log('BOOT: Verifying token with /me...');
            const me = await apiRequest('/me');
            console.log('BOOT: Token verified. User:', me.username);
            state.user.id = me.id;
            state.user.username = me.username;
            state.user.profile = me;

            // We will remove the overlay after subsystems load to prevent flash of empty app
            // if (authOverlay) authOverlay.style.display = 'none';

            console.log('BOOT: Loading subsystems...');
            
            // Standard initialization
            if (window.addLog) window.addLog('Инициализация Skufia Enterprise OS...', 'info');
            
            try {
                if (window.ensureKeys) await window.ensureKeys();
            } catch (e) {
                console.error('E2EE key init failed (non-fatal):', e);
                if (window.addLog) window.addLog('⚠️ Крипто-модуль недоступен — E2EE отключён', 'warning');
            }
            if (window.connectWebSocket) window.connectWebSocket();
            if (window.loadChatRooms) window.loadChatRooms();
            if (window.loadFolders) window.loadFolders();
            
            console.log('--- SYSTEM BOOT COMPLETE ---');
            
            // Forcefully remove auth overlay and set logged-in state to unblock interface
            if (authOverlay) {
                authOverlay.remove();
            }
            document.documentElement.classList.add('is-logged-in');
            
            if (window.addLog) {
                window.addLog('Loading Cyber-Industrial HUD...', 'system');
                window.addLog('System Online. Welcome, Operator.', 'success');
            }
            
            switchView('messages');

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
                        if (window.showToast) {
                            window.showToast('✅ Доступно обновление. Перезагрузите для применения.', 10000);
                        }
                    }
                });
            }
        } catch (err) {
            console.error('BOOT FAILURE:', err);
            if (window.addLog) window.addLog(`System boot failed: ${err.message}`, 'error');
            
            // If boot failed (e.g. 401 or network), show login again
            document.documentElement.classList.remove('is-logged-in'); // CRITICAL: Allow overlay to show
            if (authOverlay) {
                authOverlay.style.display = 'flex';
                if (authTitle) authTitle.textContent = 'АВТОРИЗАЦИЯ';
                const authBtn = authOverlay.querySelector('.auth-main-btn');
                if (authBtn) {
                    authBtn.disabled = false;
                    authBtn.textContent = 'ВОЙТИ В СЕТЬ';
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
                    const handleInput = document.getElementById('settings-handle-input');
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

        let newVal = input.value.trim();
        if (newVal && !newVal.startsWith('@')) {
            newVal = '@' + newVal;
            input.value = newVal;
        }

        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> СОХРАНЕНИЕ...';
        btn.disabled = true;

        try {
            await apiRequest('/me/update', 'POST', { handle: newVal });
            if (typeof addLog === 'function') addLog('Профиль успешно сохранен', 'success');
            if (typeof showToast === 'function') showToast('✅ Настройки сохранены!');
            
            btn.innerHTML = '✓ СОХРАНЕНО';
            btn.classList.add('btn-success');
            btn.disabled = false;
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('btn-success');
            }, 2500);
        } catch (err) {
            if (typeof addLog === 'function') addLog('Ошибка при сохранении', 'error');
            if (typeof showToast === 'function') showToast('❌ Ошибка: ' + (err.message || 'не удалось сохранить'));
            
            btn.innerHTML = '✕ ОШИБКА';
            btn.classList.add('btn-danger');
            btn.disabled = false;
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('btn-danger');
            }, 2500);
        }
    };

    window.previewAvatar = async function(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];

        // Immediate local preview
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('settings-avatar-preview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Upload to server
        try {
            const token = (window.state && window.state.user) ? window.state.user.token : localStorage.getItem('skuf_token');
            if (!token) throw new Error('Токен авторизации не найден');

            const formData = new FormData();
            formData.append('file', file);
            
            if (typeof showToast === 'function') showToast('⏳ Загрузка фото...');
            
            const resp = await fetch(`${window.API_BASE_URL || '/api'}/me/avatar/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Ошибка загрузки');
            }
            
            const data = await resp.json();
            const avatarUrl = data.avatar_url;

            // Update sidebar and dashboard avatars
            const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
            if (sidebarAvatar) applyAvatarDisplay(sidebarAvatar, avatarUrl);
            const dashAvatar = document.getElementById('dash-avatar');
            if (dashAvatar) applyAvatarDisplay(dashAvatar, avatarUrl);
            
            if (typeof addLog === 'function') addLog('Аватарка успешно обновлена', 'success');
            if (typeof showToast === 'function') showToast('✅ Фото профиля обновлено!');
        } catch (e) {
            console.error('Avatar upload error:', e);
            if (typeof addLog === 'function') addLog(`❌ Ошибка загрузки: ${e.message}`, 'error');
            if (typeof showToast === 'function') showToast('❌ Не удалось загрузить фото');
        }
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
        if (typeof showToast === 'function') showToast(`📞 Инициация ${isVideo ? 'видео' : 'аудио'} звонка...`);
        window.RTCManagerInstance.startCall(targetId, isVideo);
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
