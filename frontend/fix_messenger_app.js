
const fs = require('fs');
const path = 'e:/AgentZero/usr/projects/skufia/frontend/messenger_app.js';

try {
    const content = fs.readFileSync(path, 'utf8');
    const lines = content.split('\n');

    const startIdx = lines.findIndex(l => l.includes('// --- PROFILE & SETTINGS LOGIC ---'));
    let newHead = '';
    if (startIdx === -1) {
        console.log("Could not find start index, appending at the end.");
        newHead = lines.join('\n');
    } else {
        newHead = lines.slice(0, startIdx).join('\n');
    }

    const newBody = `
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
            
            const resp = await fetch(\`\${window.API_BASE_URL || '/api'}/me/avatar/upload\`, {
                method: 'POST',
                headers: { 'Authorization': \`Bearer \${token}\` },
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
            if (typeof addLog === 'function') addLog(\`❌ Ошибка загрузки: \${e.message}\`, 'error');
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
                        addLog(\`Успешно подтянуто абонентов: \${contacts.length}\`, 'success');
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
            modal.innerHTML = \`
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
                </div>\`;
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
        if (typeof showToast === 'function') showToast(\`📞 Инициация \${isVideo ? 'видео' : 'аудио'} звонка...\`);
        window.RTCManagerInstance.startCall(targetId, isVideo);
    };

    window.chatOptionAction = function(action) {
        const dd = document.getElementById('chat-options-dropdown');
        if (dd) dd.style.display = 'none';
        showToast(\`Опция \${action} в разработке\`);
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
`;

    fs.writeFileSync(path, newHead + newBody, 'utf8');
    console.log("Successfully fixed messenger_app.js using Node.js");
} catch (err) {
    console.error("Error fixing file:", err);
    process.exit(1);
}
