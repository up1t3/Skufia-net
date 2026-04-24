
import sys

path = 'e:/AgentZero/usr/projects/skufia/frontend/messenger_app.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# We want to find where the profile settings logic starts
# and replace everything from that point onwards.
start_idx = -1
for i, line in enumerate(lines):
    if '// --- PROFILE & SETTINGS LOGIC ---' in line:
        start_idx = i
        break

if start_idx == -1:
    print("Could not find start index, appending at the end.")
    new_head = lines
else:
    new_head = lines[:start_idx]

new_body = """
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
        if (chatLayout && chatLayout.classList.contains('chat-open')) {
            chatLayout.classList.remove('chat-open');
            if (fromHistory !== true && window.innerWidth <= 768) {
                try { history.back(); } catch(e) {}
            }
        }
    };

    window.openContactProfile = function() {
        const modal = document.getElementById('contact-profile-modal');
        if (!modal) return;
        const headerTitle = document.getElementById('chat-header-title');
        const name = headerTitle ? headerTitle.textContent : 'Неизвестно';
        const cpName = document.getElementById('cp-name');
        if (cpName) cpName.textContent = name;
        modal.style.display = 'flex';
    };

    // --- CHAT OPTIONS ---
    window.toggleChatOptions = function(e) {
        if (e) e.stopPropagation();
        const dd = document.getElementById('chat-options-dropdown');
        if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
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
    });

});
"""

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_head)
    f.write(new_body)
f.close()
print("Successfully fixed messenger_app.js")
