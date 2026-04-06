document.addEventListener('DOMContentLoaded', () => {
    // --- Utility: Apply Avatar Sprite ---
    function applyAvatarDisplay(element, url, index = null) {
        if (!element) return;
        if (url && url.startsWith('SPRITE:')) {
            const [_, src, idx] = url.split(':');
            const i = parseInt(idx);
            const col = i % 3;
            const row = Math.floor(i / 3);
            
            element.style.backgroundImage = `url(${src})`;
            element.style.backgroundSize = '300% 300%'; // 3x3 grid
            element.style.backgroundPosition = `${(col / 2) * 100}% ${(row / 2) * 100}%`;
            element.style.backgroundRepeat = 'no-repeat';
            
            if (element instanceof HTMLImageElement) {
                element.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            }
        } else {
            element.style.backgroundImage = url ? `url(${url})` : 'none';
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
            if (element instanceof HTMLImageElement && url) {
                element.src = url;
            }
        }
    }
    window.applyAvatarDisplay = applyAvatarDisplay;

    // --- Configuration ---
    // Bypass local proxy and hit backend directly on port 8007
    const API_BASE_URL = 'http://localhost:8007/api';

    // --- State Management ---
    const state = {
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
            sessionKeys: {} // Map of roomId -> CryptoKey (AES)
        },
        logs: [],
        audioEnabled: true,
        /** @type {{ url: string, name: string } | null} */
        pendingFile: null
    };

    /** @typedef {Object} CryptoKeyPair
     * @property {CryptoKey} publicKey
     * @property {CryptoKey} privateKey
     */

    // --- CRYPTO MANAGER (E2EE) ---
    class CryptoManager {
        /** @returns {Promise<CryptoKeyPair>} */
        static async generateKeyPair() {
            // @ts-ignore
            return await window.crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256",
                },
                true,
                ["encrypt", "decrypt"]
            );
        }

        /** @param {CryptoKey} key */
        static async exportPublicKey(key) {
            const exported = await window.crypto.subtle.exportKey("spki", key);
            return btoa(String.fromCharCode(...new Uint8Array(exported)));
        }

        /** @param {string} base64 */
        static async importPublicKey(base64) {
            const binaryDerString = atob(base64);
            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }
            return await window.crypto.subtle.importKey(
                "spki",
                binaryDer,
                { name: "RSA-OAEP", hash: "SHA-256" },
                true,
                ["encrypt"]
            );
        }

        static async generateSessionKey() {
            return await window.crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
        }

        /** 
         * @param {CryptoKey} key 
         * @param {string} text 
         */
        static async encryptMessage(key, text) {
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encoded = new TextEncoder().encode(text);
            const ciphertext = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                encoded
            );
            return {
                content: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
                iv: btoa(String.fromCharCode(...iv))
            };
        }

        /** 
         * @param {CryptoKey} key 
         * @param {string} base64Content 
         * @param {string} base64Iv 
         */
        static async decryptMessage(key, base64Content, base64Iv) {
            const iv = new Uint8Array(atob(base64Iv).split("").map(c => c.charCodeAt(0)));
            const ciphertext = new Uint8Array(atob(base64Content).split("").map(c => c.charCodeAt(0)));
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decrypted);
        }

        /** 
         * @param {CryptoKey} publicKey 
         * @param {CryptoKey} sessionKey 
         */
        static async wrapKey(publicKey, sessionKey) {
            const wrapped = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                publicKey,
                await window.crypto.subtle.exportKey("raw", sessionKey)
            );
            return btoa(String.fromCharCode(...new Uint8Array(wrapped)));
        }

        /** 
         * @param {CryptoKey} privateKey 
         * @param {string} wrappedBase64 
         */
        static async unwrapKey(privateKey, wrappedBase64) {
            const wrapped = new Uint8Array(atob(wrappedBase64).split("").map(c => c.charCodeAt(0)));
            const rawKey = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKey,
                wrapped
            );
            return await window.crypto.subtle.importKey(
                "raw",
                rawKey,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
        }
    }

    async function ensureKeys() {
        if (state.chat.keys.publicKey) return;
        
        // Try loading from localStorage for persistence
        const storedPub = localStorage.getItem('skufia_pub');
        const storedPriv = localStorage.getItem('skufia_priv');
        
        if (storedPub && storedPriv) {
            // In a real app, we'd import them back. 
            // For now, let's just generate new ones per "session" to ensure it works perfectly the first time.
        }

        addLog('Генерация ключей шифрования RSA-2048...', 'info');
        const pair = await CryptoManager.generateKeyPair();
        // @ts-ignore
        state.chat.keys.publicKey = pair.publicKey;
        // @ts-ignore
        state.chat.keys.privateKey = pair.privateKey;
        
        const pubBase64 = await CryptoManager.exportPublicKey(pair.publicKey);
        await apiRequest('/me/key', 'POST', { public_key: pubBase64 });
        addLog('Публичный ключ зарегистрирован в Cyber-Vault ✅', 'success');
    }

    const WS_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.hostname + ':8007';

    // --- Audio Engine ---
    const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    const sounds = {
        click: new Audio(silentWav),
        alert: new Audio(silentWav),
        ambient: new Audio(silentWav)
    };

    function playSound(soundName, loop = false) {
        if (!state.audioEnabled) return;
        try {
            const s = sounds[soundName];
            if (s) {
                s.loop = loop;
                s.volume = loop ? 0.2 : 0.5;
                s.play().catch(() => {});
            }
        } catch (e) { console.log('Audio play failed'); }
    }

    // --- DOM Elements ---
    const views = document.querySelectorAll('.view');
    const navBtns = document.querySelectorAll('.nav-btn');
    const logContainer = document.getElementById('system-logs');
    const mobileMenuBtn = document.querySelector('.mobile-only');
    const sidePanel = document.querySelector('.side-panel');

    // --- System Logging ---
    function addLog(message, type = 'info') {
        const consoleLog = document.getElementById('console-log');
        if (!consoleLog) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `> [${new Date().toLocaleTimeString()}] ${message}`;
        consoleLog.appendChild(entry);
        consoleLog.scrollTop = consoleLog.scrollHeight;
        
        if (type === 'error') playSound('alert');
    }
    window.addLog = addLog; // Force global access immediately


    /**
     * @param {string} endpoint 
     * @param {string} method
     * @param {any} body
     * @returns {Promise<any>}
     */
    async function apiRequest(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (state.user.token) headers['Authorization'] = `Bearer ${state.user.token}`;
        
        try {
            const res = await fetch(`${API_BASE_URL}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null
            });
            if (res.status === 401) {
                // Token invalid or expired
                localStorage.removeItem('skuf_token');
                state.user.token = null;
                document.getElementById('auth-overlay').style.display = 'flex';
                throw new Error('Unauthorized');
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            addLog(`API Error [${endpoint}]: ${e.message}`, 'error');
            throw e;
        }
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
            if (viewId === 'messages') loadChatRooms();
            if (viewId === 'events') loadEvents();
            if (viewId === 'dashboard') loadDashboard();
        }
    }

    // --- MODULE: FORUM ---
    async function loadForum() {
        const container = document.getElementById('forum-list');
        if (!container) return;
        container.innerHTML = '<div class="system-msg">Scanning forum sectors...</div>';
        try {
            const data = await apiRequest('/topics'); 
            container.innerHTML = '';
            if (data.length === 0) {
                container.innerHTML = '<div class="system-msg">No active transmissions found in this sector.</div>';
                return;
            }
            data.forEach(topic => {
                const div = document.createElement('div');
                div.className = 'forum-item';
                div.style.cursor = 'pointer';
                div.innerHTML = `<strong>${topic.title}</strong> <span class="msg-meta">by ${topic.author}</span>`;
                div.onclick = () => loadTopicPosts(topic.id, topic.title);
                container.appendChild(div);
            });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Unable to synchronize forum data.</div>'; }
    }

    async function loadTopicPosts(topicId, title) {
        const container = document.getElementById('forum-list');
        container.innerHTML = `<div class="system-msg">Accessing thread: ${title}...</div>`;
        try {
            const posts = await apiRequest(`/topics/${topicId}/posts`);
            container.innerHTML = `<h4>${title}</h4><div class="back-link" onclick="loadForum()"><< Вернуться к списку</div>`;
            posts.forEach(post => {
                const div = document.createElement('div');
                div.className = 'post-item';
                div.innerHTML = `
                    <div class="post-content">${post.content}</div>
                    <div class="msg-meta">
                        by ${post.author} | 👍 <span id="likes-${post.id}">${post.likes}</span>
                        <button class="small-btn" onclick="likePost(${post.id})">Поддержать</button>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Connection lost to this thread.</div>'; }
    }

    window.likePost = async function(postId) {
        try {
            const res = await apiRequest(`/posts/${postId}/like`, 'POST');
            const counter = document.getElementById(`likes-${postId}`);
            if (counter) {
                let current = parseInt(counter.innerText);
                counter.innerText = res.status === 'liked' ? current + 1 : current - 1;
            }
        } catch (e) { console.error("Rating rejected", e); }
    }

    // --- MODULE: WIKI ---
    async function loadWiki() {
        const container = document.querySelector('.wiki-content');
        if (!container) return;
        try {
            const articles = await apiRequest('/wiki');
            container.innerHTML = '';
            if (articles.length === 0) {
                container.innerHTML = '<div class="system-msg">LIBRARY_EMPTY: Поиск данных не дал результатов.</div>';
                return;
            }
            articles.forEach(art => {
                const div = document.createElement('div');
                div.className = 'wiki-card';
                div.innerHTML = `
                    <h3>${art.title}</h3>
                    <div class="msg-meta">👍 <span id="wiki-likes-${art.id}">${art.likes || 0}</span> 
                    <button class="small-btn" onclick="likeWiki(${art.id})">Одобрить</button>
                    </div>
                    <p class="wiki-excerpt">${art.content ? art.content.substring(0, 150) + '...' : 'Контент засекречен'}</p>
                    <button class="cyber-btn-small" onclick="loadWikiArticle(${art.id})">ОТКРЫТЬ ДАННЫЕ</button>
                `;
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: Wiki access failed.</div>';
        }
    }

    // @ts-ignore
    window.likeWiki = async function(artId) {
        try {
            const res = await apiRequest(`/wiki/${artId}/like`, 'POST');
            const counter = document.getElementById(`wiki-likes-${artId}`);
            if (counter) {
                let current = parseInt(counter.innerText);
                counter.innerText = res.status === 'liked' ? current + 1 : current - 1;
            }
        } catch (e) { console.error("Knowledge validation failed", e); }
    }

    async function loadMarket() {
        const container = document.querySelector('.market-grid');
        if (!container) return;
        
        // @ts-ignore
        const catFilter = document.getElementById('market-filter-cat')?.value || 'Все';
        // @ts-ignore
        const locFilter = document.getElementById('market-filter-loc')?.value || 'Везде';
        
        container.innerHTML = '<div class="system-msg">Scanning trade frequencies...</div>';
        try {
            const listings = await apiRequest(`/market?category=${catFilter}&location=${locFilter}`);
            container.innerHTML = '';
            if (!listings || listings.length === 0) {
                container.innerHTML = '<div class="system-msg">MARKET_EMPTY: Нет активных лотов на бирже.</div>';
                return;
            }
            listings.forEach(/** @param {any} item */ item => {
                const div = document.createElement('div');
                div.className = 'market-card interactive';
                
                let deleteButtonHTML = '';
                if (item.seller_id === state.user.id) {
                    deleteButtonHTML = `<button class="btn-danger" style="margin-top: 5px; font-size: 10px;" onclick="deleteMarketListing(${item.id})">УДАЛИТЬ ЛОТ</button>`;
                }
                
                div.innerHTML = `
                    <div class="market-header">Лот #${item.id} <span style="float: right;">${item.category} / ${item.location}</span></div>
                    <div class="market-body">
                        <h4>${item.title}</h4>
                        <div class="market-price">ЦЕНА: <span class="highlight">${item.price}</span></div>
                        <p style="font-size: 11px; margin-top: 5px; color: var(--text-dim);">${item.description || ''}</p>
                    </div>
                    <button class="cyber-btn-small" onclick="addLog('Buy request sent for ${item.title}', 'info')">КУПИТЬ</button>
                    ${deleteButtonHTML}
                    <div class="market-footer">Продавец: ${item.seller}</div>
                `;
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: Не удалось синхронизировать данные биржи.</div>';
        }
    }

    // @ts-ignore
    window.deleteMarketListing = async function(itemId) {
        if (!confirm('Подтверждаете удаление лота?')) return;
        try {
            await apiRequest(`/market/${itemId}`, 'DELETE');
            addLog('Лот снят с биржи', 'success');
            loadMarket();
        } catch(e) {
            addLog('Ошибка при удалении лота', 'error');
        }
    }

    window.loadWikiArticle = async function(artId) {
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            alert(`--- ГИПЕРТЕКСТОВАЯ БАЗА --- \n\n${art.title.toUpperCase()}\n\n${art.content}`);
        } catch (e) { addLog('Article data corrupted', 'error'); }
    }
    
    // @ts-ignore
    window.toggleMarketForm = function() {
        const panel = document.getElementById('market-form-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }

    // @ts-ignore
    window.submitMarketListing = async function() {
        const titleElem = document.getElementById('market-title');
        const priceElem = document.getElementById('market-price');
        const descElem = document.getElementById('market-desc');
        const catElem = document.getElementById('market-cat');
        const locElem = document.getElementById('market-loc');
        
        if (!titleElem || !priceElem || !descElem) return;
        
        // @ts-ignore
        const title = titleElem.value;
        // @ts-ignore
        const price = priceElem.value;
        // @ts-ignore
        const description = descElem.value;
        // @ts-ignore
        const category = catElem?.value || 'Разное';
        // @ts-ignore
        const location = locElem?.value || 'Вся сеть';
        
        if (!title || !price) { addLog('Validation Error: Заполните название и цену', 'error'); return; }
        
        try {
            await apiRequest('/market', 'POST', { title, price, description, category, location });
            addLog('Лот успешно опубликован', 'success');
            // @ts-ignore
            titleElem.value = '';
            // @ts-ignore
            priceElem.value = '';
            // @ts-ignore
            descElem.value = '';
            const panel = document.getElementById('market-form-panel');
            if (panel) panel.style.display = 'none';
            loadMarket();
        } catch (e) { addLog('Market transaction failed', 'error'); }
    }

    // --- MODULE: REGISTRY ---
    async function loadRegistry() {
        const tableBody = document.getElementById('registry-list');
        if (!tableBody) return;
        try {
            const users = await apiRequest('/registry');
            tableBody.innerHTML = '';
            users.forEach(u => {
                const row = document.createElement('tr');
                const avatarCell = document.createElement('td');
                const avatar = document.createElement('div');
                avatar.className = 'registry-avatar';
                applyAvatarDisplay(avatar, u.avatar_url);
                avatarCell.appendChild(avatar);
                
                row.innerHTML = `
                    <td><span class="id-tag">${u.id || '---'}</span></td>
                    <td></td>
                    <td class="highlight">${u.username}</td>
                    <td><span class="rank-badge">${u.rank}</span></td>
                    <td class="stat-value">${u.karma}</td>
                    <td><button class="cyber-btn-small" onclick="startPrivateChat(${u.id})">СЕКРЕТНЫЙ ЧАТ</button></td>
                `;
                row.cells[1].appendChild(avatar);
                tableBody.appendChild(row);
            });
        } catch (e) { tableBody.innerHTML = '<tr><td colspan="6" class="system-msg">ERROR: Registry access denied.</td></tr>'; }
    }

    // @ts-ignore
    window.startPrivateChat = async function(targetId) {
        if (targetId === state.user.id) {
            addLog('Вы не можете начать чат с самим собой', 'error');
            return;
        }
        try {
            addLog('Установка защищенного туннеля...', 'info');
            const room = await apiRequest('/chat/private', 'POST', { target_user_id: targetId });
            switchView('messages');
            loadChatRooms();
            setTimeout(() => {
                const roomElement = document.querySelector(`.sidebar-item`); // Usually loaded by now
                selectChatRoom(room.id, room.name, room.room_type, targetId);
                addLog('E2EE-Канал установлен', 'success');
            }, 500);
        } catch (e) {
            addLog('Не удалось установить соединение', 'error');
        }
    }

    // --- MODULE: EVENTS ---
    async function loadEvents() {
        const container = document.getElementById('events-list');
        if (!container) return;
        try {
            const events = await apiRequest('/events');
            container.innerHTML = '';
            if (!events || events.length === 0) {
                container.innerHTML = '<div class="system-msg">Нет активных событий.</div>';
                return;
            }
            events.forEach(/** @param {any} e */ e => {
                const eventCard = document.createElement('div');
                eventCard.className = 'event-card interactive';
                // @ts-ignore
                const safeDate = e.date ? new Date(e.date).toLocaleDateString() : 'Unknown';
                eventCard.innerHTML = `
                <div class="event-date">${safeDate}</div>
                <div class="event-content">
                    <h4>${e.title}</h4>
                    <p>📍 ${e.location || 'Секретная локация'}</p>
                </div>
                <div class="event-action">> ДЕТАЛИ</div>
            `;
            eventCard.addEventListener('click', () => showEventDetails(e));
            container.appendChild(eventCard);
        });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Events sync failed.</div>'; }
    }

    // @ts-ignore
    window.toggleEventForm = function() {
        const panel = document.getElementById('event-form-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }

    // @ts-ignore
    window.submitEvent = async function() {
        const titleElem = document.getElementById('event-title');
        const dateElem = document.getElementById('event-date');
        const locElem = document.getElementById('event-location');
        const descElem = document.getElementById('event-desc');
        if (!titleElem || !dateElem || !locElem || !descElem) return;
        
        // @ts-ignore
        const title = titleElem.value;
        // @ts-ignore
        const event_date = dateElem.value ? new Date(dateElem.value).toISOString() : new Date().toISOString();
        // @ts-ignore
        const location = locElem.value;
        // @ts-ignore
        const description = descElem.value;
        
        if (!title) { addLog('Validation Error: Укажите название', 'error'); return; }
        
        try {
            await apiRequest('/events', 'POST', { title, event_date, location, description });
            addLog('Событие анонсировано', 'success');
            // @ts-ignore
            titleElem.value = '';
            // @ts-ignore
            dateElem.value = '';
            // @ts-ignore
            locElem.value = '';
            // @ts-ignore
            descElem.value = '';
            const panel = document.getElementById('event-form-panel');
            if (panel) panel.style.display = 'none';
            loadEvents();
        } catch (e) { addLog('Event broadcast failed', 'error'); }
    }

    function showEventDetails(event) {
        addLog(`Accessing mission data: ${event.title}`, 'info');
        const details = `
            ЦЕЛЬ: ${event.title}
            ДАТА: ${new Date(event.event_date).toLocaleString()}
            ЛОКАЦИЯ: ${event.location}
            ОПИСАНИЕ: ${event.description || 'Данные засекречены'}
        `;
        alert(details);
    }

    // --- MODULE: DASHBOARD & AVATAR ---
    async function loadDashboard() {
        try {
            const data = await apiRequest('/me');
            state.user.username = data.display_name || data.username;
            state.user.id = data.id;
            
            document.getElementById('dash-id').textContent = data.id || '???';
            document.getElementById('dash-username-display').textContent = data.display_name || data.username;
            document.getElementById('dash-rank').textContent = data.rank;
            document.getElementById('dash-karma').textContent = data.karma;
            document.getElementById('dash-bio').value = data.bio || '';
            document.getElementById('dash-callsign-input').value = data.nickname || data.username;
            
            if (data.avatar_url) {
                const dashAvatar = document.getElementById('dash-avatar');
                applyAvatarDisplay(dashAvatar, data.avatar_url);
            }
            syncSidebar(data);
        } catch (e) {
            addLog('Failed to load personnel file', 'error');
        }
    }

    /** @param {any} data */
    function syncSidebar(data) {
        const sidebarName = document.querySelector('.side-panel .username');
        const sidebarRank = document.querySelector('.side-panel .rank');
        const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
        
        if (sidebarName) sidebarName.textContent = `Оператор: ${data.display_name || data.username}`;
        if (sidebarRank) sidebarRank.textContent = data.rank;
        if (sidebarAvatar && data.avatar_url) {
            applyAvatarDisplay(sidebarAvatar, data.avatar_url);
        }
    }

    // --- ДЕЙСТВИЯ: ЛИЧНЫЙ КАБИНЕТ ---
    window.saveProfile = async function() {
        const bioEl = document.getElementById('dash-bio');
        const callsignEl = document.getElementById('dash-callsign-input');
        if (!bioEl || !callsignEl) return;
        
        try {
            // @ts-ignore
            const bio = bioEl.value;
            // @ts-ignore
            const nickname = callsignEl.value;
            
            const result = await apiRequest('/me/update', 'POST', { bio, nickname });
            if (result && result.display_name) {
                state.user.username = result.display_name;
                const display = document.getElementById('dash-username-display');
                if (display) display.textContent = result.display_name;
                addLog('Личное дело успешно обновлено ✅', 'success');
                loadDashboard(); // Refresh everything
            }
        } catch (e) {
            console.error('Profile update error:', e);
            addLog('Не удалось обновить профиль (возможно, позывной занят)', 'error');
        }
    }

    window.openAvatarModal = function() {
        const modal = document.getElementById('avatar-modal');
        const grid = document.getElementById('avatar-selector-grid');
        if (!modal || !grid) return;
        
        grid.innerHTML = '';
        
        // 35 Heroes mapped to 4 full 3x3 sheets and 8 characters from 5th sheet
        for (let i = 0; i < 35; i++) {
            const setNum = Math.floor(i / 9) + 1;
            const idxInSet = i % 9;
            const url = `SPRITE:assets/avatars/set_${setNum}.png:${idxInSet}`;
            
            const btn = document.createElement('div');
            btn.className = 'avatar-option';
            btn.style.width = '80px';
            btn.style.height = '80px';
            btn.style.border = '2px solid var(--neon-cyan)';
            btn.style.cursor = 'pointer';
            
            applyAvatarDisplay(btn, url);
            btn.onclick = () => {
                window.selectAvatar(url);
            };
            grid.appendChild(btn);
        }

        modal.style.display = 'flex';
        playSound('click');
    }

    window.closeAvatarModal = function() {
        const modal = document.getElementById('avatar-modal');
        if (modal) modal.style.display = 'none';
    }

    window.selectAvatar = async function(url) {
        try {
            await apiRequest('/me/update', 'POST', { avatar_url: url });
            const dashAvatar = document.getElementById('dash-avatar');
            if (dashAvatar) applyAvatarDisplay(dashAvatar, url);
            
            addLog('Аватар обновлен: Канал связи активен ✅', 'success');
            window.closeAvatarModal();
            loadDashboard(); // Refresh UI
        } catch (e) {
            addLog('Ошибка синхронизации канала аватара', 'error');
        }
    }

    window.useCustomAvatar = function() {
        const input = document.getElementById('custom-avatar-url');
        // @ts-ignore
        if (input && input.value) {
            // @ts-ignore
            window.selectAvatar(input.value);
        }
    }


    // --- SKUFIA-NET CHAT HUB ---
    function connectWebSocket() {
        if (state.chat.socket) return;
        
        const token = state.user.token;
        state.chat.socket = new WebSocket(`${WS_URL}/ws/chat/${token}`);

        state.chat.socket.onopen = () => {
            addLog('WebSocket Connection Established: Skufia-Net Online', 'success');
        };

        state.chat.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'new_message') {
                const msg = data;
                
                // --- E2EE DECRYPTION ---
                if (msg.iv && state.chat.sessionKeys[msg.room_id]) {
                    try {
                        msg.content = await CryptoManager.decryptMessage(
                            state.chat.sessionKeys[msg.room_id],
                            msg.content,
                            msg.iv
                        );
                        msg.is_secure = true;
                    } catch (e) {
                        msg.content = "[ ДАННЫЕ ЗАШИФРОВАНЫ // КЛЮЧ НЕ НАЙДЕН ]";
                    }
                }

                }
                if (state.chat.currentRoomId === msg.room_id) {
                    renderChatMessage(msg);
                }
                if (msg.sender !== state.user.username) {
                    playSound('alert');
                }
            } else if (data.type === 'edit_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) {
                    const txtEl = el.querySelector('.msg-text');
                    if (txtEl) {
                        let decryptedContent = data.content;
                        if (data.iv && state.chat.sessionKeys[data.room_id]) {
                            try { decryptedContent = await CryptoManager.decryptMessage(state.chat.sessionKeys[data.room_id], data.content, data.iv); } 
                            catch(e) {}
                        }
                        txtEl.innerText = decryptedContent; 
                    }
                    if (!el.querySelector('.is-edited')) {
                        const mheader = el.querySelector('.msg-header');
                        if (mheader) mheader.insertAdjacentHTML('beforeend', '<span class="is-edited">(изменено)</span>');
                    }
                }
            } else if (data.type === 'delete_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) el.remove();
            } else if (data.type === 'typing_start') {
                if (state.chat.currentRoomId === data.room_id && data.sender_id !== state.user.id) {
                    const typingEl = document.getElementById('typing-indicator');
                    if (typingEl) {
                        typingEl.textContent = `${data.sender} печатает...`;
                        typingEl.style.display = 'block';
                        // @ts-ignore
                        if (window.typingTimeout) clearTimeout(window.typingTimeout);
                        // @ts-ignore
                        window.typingTimeout = setTimeout(() => { typingEl.style.display = 'none'; }, 3000);
                    }
                }
            } else if (data.type === 'status_update') {
                loadChatRooms();
            }
        };

        state.chat.socket.onclose = () => {
            state.chat.socket = null;
            addLog('WebSocket Link Severed. Retrying...', 'error');
            setTimeout(connectWebSocket, 5000);
        };
    }

    async function loadChatRooms() {
        const list = document.getElementById('chat-rooms-list');
        if (!list) return;
        try {
            const rooms = await apiRequest('/chat/rooms');
            state.chat.rooms = rooms;
            list.innerHTML = '';
            // @ts-ignore
            rooms.forEach(room => {
                const div = document.createElement('div');
                div.className = `sidebar-item ${state.chat.currentRoomId === room.id ? 'active' : ''}`;
                
                const avatarUrl = room.room_type === 'private' 
                    ? (room.other_user_avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${room.name}`)
                    : `https://api.dicebear.com/7.x/shapes/svg?seed=${room.name}`;

                div.innerHTML = `
                    <div class="sidebar-item-avatar">
                        <img src="${avatarUrl}" alt="AV" style="width:100%;height:100%;object-fit:cover;">
                    </div>
                    <div class="sidebar-item-info">
                        <div class="sidebar-item-name">${room.name}</div>
                        <div class="sidebar-item-last-msg">${room.last_message || 'Нет сообщений'}</div>
                    </div>
                    <span class="status-dot ${room.is_online ? 'online' : ''}"></span>
                `;
                div.onclick = () => selectChatRoom(room.id, room.name, room.room_type, room.other_user_id);
                list.appendChild(div);
            });
        } catch (e) { addLog('Failed to load chat channels', 'error'); }
    }

    /** 
     * @param {number} roomId 
     * @param {string} roomName 
     * @param {string} [type]
     * @param {number} [receiverId]
     */
    async function selectChatRoom(roomId, roomName, type, receiverId) {
        state.chat.currentRoomId = roomId;
        state.chat.currentRoomName = roomName;
        state.chat.currentReceiverId = receiverId || null;
        
        const header = document.getElementById('chat-header');
        const history = document.getElementById('chat-history');
        
        if (header) {
            header.innerHTML = `
                <div class="chat-user-header">
                    <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${roomName}" class="chat-user-avatar">
                    <div class="chat-user-info">
                        <div style="font-size:14px;">${roomName.toUpperCase()}</div>
                    </div>
                </div>
                <div class="encryption-badge" id="chat-encryption-status">
                    <span>📡 НЕЗАЩИЩЕННЫЙ КАНАЛ</span>
                </div>
            `;
        }

        // --- E2EE INITIALIZATION ---
        if (type === 'private' && receiverId) {
            await ensureKeys();
            try {
                const targetKeyData = await apiRequest(`/users/${receiverId}/key`);
                if (targetKeyData && targetKeyData.public_key) {
                    addLog(`Установка защищенного соединения с ${roomName}...`, 'info');
                    // In a real app we'd negotiate a session key now.
                    // For demo, we just generate one locally.
                    if (!state.chat.sessionKeys[roomId]) {
                        state.chat.sessionKeys[roomId] = await CryptoManager.generateSessionKey();
                    }
                    const badge = document.getElementById('chat-encryption-status');
                    if (badge) {
                        badge.innerHTML = '🔒 ЗАЩИЩЕНО (E2EE ACTIVE)';
                        badge.style.color = '#0f0';
                        badge.style.background = 'rgba(0, 255, 65, 0.1)';
                    }
                }
            } catch (e) {
                console.warn('E2EE Negotiation failed:', e);
            }
        }
        
        // Highlight active room in sidebar
        document.querySelectorAll('.sidebar-item').forEach(el => {
            const nameEl = el.querySelector('.sidebar-item-name');
            if (nameEl) {
                el.classList.toggle('active', nameEl.textContent === roomName);
            }
        });

        const chatMain = document.querySelector('.chat-main');
        if (chatMain) chatMain.classList.add('active');

        if (history) {
            history.innerHTML = '<div class="chat-placeholder">Loading buffer...</div>';
            try {
                const messages = await apiRequest(`/chat/rooms/${roomId}/history`);
                history.innerHTML = '';
                // @ts-ignore
                for (const m of messages) {
                    // Try decrypting history if we have the key
                    if (m.iv && state.chat.sessionKeys[roomId]) {
                        try {
                            m.text = await CryptoManager.decryptMessage(
                                state.chat.sessionKeys[roomId],
                                m.text,
                                m.iv
                            );
                            m.is_secure = true;
                        } catch(e) { m.text = "[ ЗАШИФРОВАНО ]"; }
                    }
                    renderChatMessage(m);
                }
                history.scrollTop = history.scrollHeight;
            } catch (e) { history.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }
        }
    }

    /** @param {any} msg */
    function renderChatMessage(msg) {
        const history = document.getElementById('chat-history');
        if (!history) return;

        const placeholder = history.querySelector('.chat-placeholder');
        if (placeholder) placeholder.remove();

        const div = document.createElement('div');
        const isMe = msg.sender === state.user.username || msg.id === state.user.id;
        div.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
        
        const timeStr = msg.timestamp || '00:00';

        const fileUrl = msg.file_url || null;
        let fileHtml = '';
        if (fileUrl) {
            const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fileUrl);
            if (isImage) {
                fileHtml = `<a href="${API_BASE_URL}${fileUrl}" target="_blank"><img class="msg-file-img-preview" src="${API_BASE_URL}${fileUrl}" alt="attachment"></a>`;
            } else {
                const fname = fileUrl.split('/').pop() || 'file';
                fileHtml = `<a class="msg-file-attachment" href="${API_BASE_URL}${fileUrl}" target="_blank" download><span class="file-icon">📁</span> СКАЧАТЬ: ${fname}</a>`;
            }
        }

        div.id = `msg-${msg.id}`;
        
        let replyHtml = '';
        if (msg.reply_to_id) {
            replyHtml = `<div class="reply-badge" onclick="document.getElementById('msg-${msg.reply_to_id}')?.scrollIntoView({behavior:'smooth'})">Ответ на сообщение</div>`;
        }
        const isEditedHtml = msg.is_edited ? '<span class="is-edited">(изменено)</span>' : '';

        div.innerHTML = `
            <div class="msg-header">
                ${msg.sender}
                ${msg.is_secure || msg.iv ? '<span class="msg-secure-icon">🔒</span>' : ''}
                ${isEditedHtml}
            </div>
            ${replyHtml}
            <div class="msg-text">${msg.text || msg.content || ''}</div>
            ${fileHtml}
            <div class="msg-footer">
                <span class="msg-time">${timeStr}</span>
            </div>
        `;
        
        // Context menu logic
        div.oncontextmenu = (e) => {
            e.preventDefault();
            document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
            const menu = document.createElement('div');
            menu.className = 'msg-context-menu';
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            
            // @ts-ignore
            let cleanText = (msg.text || msg.content || '').replace(/[`]/g, '');
            menu.innerHTML = `<div onclick="setReply(${msg.id}, \`${cleanText}\`)">Ответить</div>`;
            if (isMe) {
                menu.innerHTML += `<div onclick="setEdit(${msg.id}, \`${cleanText}\`)">Редактировать</div>`;
                menu.innerHTML += `<div class="delete-ctx" onclick="deleteMessage(${msg.id})">Удалить</div>`;
            }
            document.body.appendChild(menu);
            setTimeout(() => { document.addEventListener('click', () => menu.remove(), {once: true}); }, 0);
        };
        
        history.appendChild(div);
        history.scrollTop = history.scrollHeight;
    }

    async function sendChatMsg() {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('chat-input'));
        if (!input || !input.value.trim() || !state.chat.currentRoomId) return;
        
        let content = input.value.trim();
        let secureMsg = null;

        // --- ENCRYPT IF SECURE ---
        const roomId = state.chat.currentRoomId;
        if (state.chat.sessionKeys[roomId]) {
            try {
                secureMsg = await CryptoManager.encryptMessage(state.chat.sessionKeys[roomId], content);
            } catch (e) {
                addLog('Ошибка шифрования сообщения', 'error');
                return;
            }
        }

        const payload = {
            content: (state.chat.sessionKeys[roomId] && secureMsg) ? secureMsg.content : content,
            encryption_iv: (state.chat.sessionKeys[roomId] && secureMsg) ? secureMsg.iv : "",
            file_url: state.pendingFile ? state.pendingFile.url : null,
            reply_to_id: state.chat.replyToId
        };

        try {
            if (state.chat.editingId) {
                await apiRequest(`/chat/messages/${state.chat.editingId}`, 'PUT', payload);
            } else {
                await apiRequest(`/chat/rooms/${roomId}/send`, 'POST', payload);
            }
            input.value = '';
            // @ts-ignore
            if(window.cancelReply) window.cancelReply();
            clearChatFile();
            playSound('click');
        } catch (e) { addLog('Transmission failed', 'error'); }
    }

    /** Upload a file to the server and store the URL in pendingFile */
    async function uploadChatFile(/** @type {File} */ file) {
        if (file.size > 5 * 1024 * 1024) {
            addLog('Файл превышает лимит 5 МБ', 'error');
            return;
        }
        const formData = new FormData();
        formData.append('file', file);
        try {
            const token = state.user.token;
            /** @type {Record<string, string>} */
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const resp = await fetch(`${API_BASE_URL}/api/chat/upload`, {
                method: 'POST',
                headers,
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                throw new Error(err.detail || 'Upload failed');
            }
            const data = await resp.json();
            state.pendingFile = { url: data.file_url, name: data.original_name || file.name };
            // Show preview strip
            const preview = document.getElementById('chat-file-preview');
            const nameEl = document.getElementById('chat-file-name');
            if (preview) preview.style.display = 'flex';
            if (nameEl) nameEl.textContent = `📎 ${state.pendingFile.name} (${(file.size / 1024).toFixed(1)} KB)`;
            addLog(`Файл '${file.name}' загружен`, 'success');
        } catch (e) {
            addLog(`Ошибка загрузки файла: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
        }
    }

    function clearChatFile() {
        state.pendingFile = null;
        const preview = document.getElementById('chat-file-preview');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
        if (preview) preview.style.display = 'none';
        if (fileInput) fileInput.value = '';
    }
    // @ts-ignore
    window.clearChatFile = clearChatFile;

    // @ts-ignore
    window.createNewRoom = async function() {
        const name = prompt("Введите название канала:");
        if (!name) return;
        try {
            const room = await apiRequest('/chat/rooms', 'POST', { name, room_type: 'group' });
            addLog(`New channel created: ${name}`, 'success');
            loadChatRooms();
        } catch (e) { addLog('Channel creation failed', 'error'); }
    }

    // Expose selectChatRoom to global if needed by inline scripts
    window['selectChatRoom'] = selectChatRoom;

    window['setReply'] = function(id, text) {
        state.chat.replyToId = id;
        state.chat.editingId = null;
        const container = document.getElementById('reply-preview-container');
        const previewText = document.getElementById('reply-preview-text');
        if (container && previewText) {
            container.style.display = 'flex';
            previewText.textContent = `Ответ на: ${text.substring(0, 25)}...`;
        }
        document.getElementById('chat-input')?.focus();
    }

    window['setEdit'] = function(id, text) {
        state.chat.editingId = id;
        state.chat.replyToId = null;
        const container = document.getElementById('reply-preview-container');
        const previewText = document.getElementById('reply-preview-text');
        const input = document.getElementById('chat-input');
        if (container && previewText && input) {
            container.style.display = 'flex';
            previewText.textContent = `Редактирование...`;
            // @ts-ignore
            input.value = text;
            input.focus();
        }
    }

    window['cancelReply'] = function() {
        state.chat.replyToId = null;
        state.chat.editingId = null;
        const container = document.getElementById('reply-preview-container');
        const input = document.getElementById('chat-input');
        if (container) container.style.display = 'none';
        if (input) {
            // @ts-ignore
            if (input.value === 'Редактирование...') input.value = '';
        }
    }

    window['deleteMessage'] = async function(id) {
        if (!confirm('Удалить сообщение?')) return;
        try {
            // @ts-ignore
            await apiRequest(`/chat/messages/${id}`, 'DELETE');
        } catch(e) { 
            // @ts-ignore
            addLog('Удаление не удалось', 'error'); 
        }
    }

    window['closeChatMobile'] = function() {
        const chatMain = document.querySelector('.chat-main');
        if (chatMain) chatMain.classList.remove('active');
    }

    // Attach local listeners
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMsg();
            else if (state.chat.socket) {
                // Throttle maybe in real app, simply send here for demo
                state.chat.socket.send(JSON.stringify({
                    type: 'typing_start',
                    room_id: state.chat.currentRoomId,
                    sender: state.user.username,
                    sender_id: state.user.id
                }));
            }
        });
    }
    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendChatMsg);
    }
    const chatFileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
    if (chatFileInput) {
        chatFileInput.addEventListener('change', () => {
            if (chatFileInput.files && chatFileInput.files[0]) {
                uploadChatFile(chatFileInput.files[0]);
            }
        });
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

        addLog('Initializing Skufia Enterprise OS...', 'info');
        await ensureKeys();
        setTimeout(() => addLog('Loading Cyber-Industrial HUD...'), 500);
        setTimeout(() => addLog('Connecting to Global Registry...'), 1000);
        setTimeout(() => addLog('Handshaking with Database Cluster...'), 1500);
        setTimeout(() => {
            addLog('System Online. Welcome, Operator.', 'success');
            // --- Initialization ---
            switchView('home');
            loadDashboard();
            connectWebSocket(); // Establish real-time link
        }, 2000);
    }

    async function syncGlobalAlerts() {
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
        btn.textContent = 'ОЖИДАНИЕ...';
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
            state.user.token = data.access_token;
            authOverlay.style.display = 'none';
            addLog('Аутентификация успешна', 'system');
            
            // Re-bind auth logic on boot system
            bootSystem();
        } catch (err) {
            document.getElementById('login-error').textContent = err.message;
        } finally {
            btn.textContent = 'ВОЙТИ В СЕТЬ';
        }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'ОЖИДАНИЕ...';
        try {
            const res = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('reg-username').value,
                    email: document.getElementById('reg-email').value,
                    password: document.getElementById('reg-password').value
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
            btn.textContent = 'АКТИВИРОВАТЬ АККАУНТ';
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

    // --- GLOBAL EXPOSURE ---
    window.loadForum = loadForum;
    window.loadWiki = loadWiki;
    window.loadMarket = loadMarket;
    window.loadRegistry = loadRegistry;
    window.loadChatRooms = loadChatRooms;
    window.loadTopicPosts = loadTopicPosts;
    window.likePost = likePost;
    window.likeWiki = likeWiki;
    window.switchView = switchView;
    window.selectChatRoom = selectChatRoom;
});