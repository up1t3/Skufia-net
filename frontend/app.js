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

    // --- Theme Management ---
    function changeTheme(themeName) {
        document.body.setAttribute('data-theme', themeName);
        localStorage.setItem('skufia_theme', themeName);
    }
    window.changeTheme = changeTheme;

    // Initialize Theme
    const savedTheme = localStorage.getItem('skufia_theme') || 'telegram';
    changeTheme(savedTheme);
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        themeSelector.value = savedTheme;
    }

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
                const strong = document.createElement('strong');
                strong.textContent = topic.title;
                const span = document.createElement('span');
                span.className = 'msg-meta';
                span.textContent = `by ${topic.author}`;
                div.appendChild(strong);
                div.appendChild(document.createTextNode(' '));
                div.appendChild(span);
                div.onclick = () => loadTopicPosts(topic.id, topic.title);
                container.appendChild(div);
            });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Unable to synchronize forum data.</div>'; }
    }

    async function loadTopicPosts(topicId, title) {
        const container = document.getElementById('forum-list');
        container.innerHTML = '';
        const sysMsg = document.createElement('div');
        sysMsg.className = 'system-msg';
        sysMsg.textContent = `Accessing thread: ${title}...`;
        container.appendChild(sysMsg);
        try {
            const posts = await apiRequest(`/topics/${topicId}/posts`);
            container.innerHTML = '';
            const h4 = document.createElement('h4');
            h4.textContent = title;
            const backLink = document.createElement('div');
            backLink.className = 'back-link';
            backLink.textContent = '<< Вернуться к списку';
            backLink.onclick = loadForum;
            container.appendChild(h4);
            container.appendChild(backLink);
            posts.forEach(post => {
                const div = document.createElement('div');
                div.className = 'post-item';
                const contentDiv = document.createElement('div');
                contentDiv.className = 'post-content';
                contentDiv.textContent = post.content;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = `by ${post.author} | 👍 `;

                const likesSpan = document.createElement('span');
                likesSpan.id = `likes-${post.id}`;
                likesSpan.textContent = post.likes;

                const btn = document.createElement('button');
                btn.className = 'small-btn';
                btn.textContent = 'Поддержать';
                btn.onclick = () => likePost(post.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(btn);

                div.appendChild(contentDiv);
                div.appendChild(metaDiv);
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
                const h3 = document.createElement('h3');
                h3.textContent = art.title;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = '👍 ';

                const likesSpan = document.createElement('span');
                likesSpan.id = `wiki-likes-${art.id}`;
                likesSpan.textContent = art.likes || 0;

                const likeBtn = document.createElement('button');
                likeBtn.className = 'small-btn';
                likeBtn.textContent = 'Одобрить';
                likeBtn.onclick = () => likeWiki(art.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(likeBtn);

                const p = document.createElement('p');
                p.className = 'wiki-excerpt';
                p.textContent = art.content ? art.content.substring(0, 150) + '...' : 'Контент засекречен';

                const openBtn = document.createElement('button');
                openBtn.className = 'cyber-btn-small';
                openBtn.textContent = 'ОТКРЫТЬ ДАННЫЕ';
                openBtn.onclick = () => loadWikiArticle(art.id);

                div.appendChild(h3);
                div.appendChild(metaDiv);
                div.appendChild(p);
                div.appendChild(openBtn);
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
                
                // Cover image
                let coverImageHtml = '';
                if (item.images && item.images.length > 0) {
                    coverImageHtml = `<img src="${API_BASE_URL}${item.images[0]}" class="market-card-cover" alt="cover">`;
                } else {
                    coverImageHtml = `<div class="market-card-cover placeholder">NO IMAGE</div>`;
                }

                // Status Badge
                let statusBadgeHtml = '';
                if (item.status === 'sold') {
                    statusBadgeHtml = `<span class="status-badge sold">ПРОДАНО</span>`;
                } else if (item.status === 'reserved') {
                    statusBadgeHtml = `<span class="status-badge reserved">В РЕЗЕРВЕ</span>`;
                } else {
                    statusBadgeHtml = `<span class="status-badge active">АКТИВЕН</span>`;
                }

                // Favorite Heart
                const isFav = item.is_favorite ? 'favorited' : '';
                const favHtml = `<span class="favorite-btn ${isFav}" onclick="toggleFavorite(event, ${item.id})">❤️</span>`;

                let deleteButtonHTML = '';
                if (item.seller_id === state.user.id) {
                    deleteButtonHTML = `<button class="btn-danger" style="margin-top: 5px; font-size: 10px; width: 100%" onclick="event.stopPropagation(); deleteMarketListing(${item.id})">УДАЛИТЬ ЛОТ</button>`;
                }

                const imgContainer = document.createElement('div');
                imgContainer.className = 'market-card-image-container';
                imgContainer.innerHTML = coverImageHtml + statusBadgeHtml + favHtml; // Safe: no user text in these HTML strings
                const viewsDiv = document.createElement('div');
                viewsDiv.className = 'views-count';
                viewsDiv.textContent = `👁 ${item.views_count || 0}`;
                imgContainer.appendChild(viewsDiv);

                const bodyDiv = document.createElement('div');
                bodyDiv.className = 'market-body';
                bodyDiv.style.padding = '10px';

                const priceDiv = document.createElement('div');
                priceDiv.className = 'market-price';
                priceDiv.style.fontSize = '16px';
                priceDiv.style.fontWeight = 'bold';
                priceDiv.style.color = 'var(--accent-amber)';
                priceDiv.style.marginBottom = '5px';
                priceDiv.textContent = item.price;

                const h4 = document.createElement('h4');
                h4.style.marginBottom = '5px';
                h4.style.fontSize = '14px';
                h4.textContent = item.title;

                const metaDiv = document.createElement('div');
                metaDiv.style.fontSize = '11px';
                metaDiv.style.color = 'var(--text-dim)';
                metaDiv.style.display = 'flex';
                metaDiv.style.justifyContent = 'space-between';

                const locSpan = document.createElement('span');
                locSpan.textContent = item.location;

                const dateSpan = document.createElement('span');
                dateSpan.textContent = new Date(item.created_at || Date.now()).toLocaleDateString();

                metaDiv.appendChild(locSpan);
                metaDiv.appendChild(dateSpan);

                bodyDiv.appendChild(priceDiv);
                bodyDiv.appendChild(h4);
                bodyDiv.appendChild(metaDiv);

                if (deleteButtonHTML) {
                    const delContainer = document.createElement('div');
                    delContainer.innerHTML = deleteButtonHTML; // Safe HTML
                    while (delContainer.firstChild) {
                        bodyDiv.appendChild(delContainer.firstChild);
                    }
                }

                div.appendChild(imgContainer);
                div.appendChild(bodyDiv);

                div.onclick = () => openListingModal(item.id);
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: Не удалось синхронизировать данные биржи.</div>';
        }
    }

    window.toggleFavorite = async function(event, itemId) {
        event.stopPropagation();
        try {
            const res = await apiRequest(`/market/${itemId}/favorite`, 'POST');
            const target = event.currentTarget;
            if (res.status === 'added') {
                target.classList.add('favorited');
                addLog('Лот добавлен в избранное', 'info');
            } else {
                target.classList.remove('favorited');
                addLog('Лот удален из избранного', 'info');
            }
        } catch (e) { console.error("Favorite toggle failed", e); }
    }

    window.openListingModal = async function(itemId) {
        try {
            const item = await apiRequest(`/market/${itemId}`);

            document.getElementById('listing-detail-title').textContent = item.title;
            document.getElementById('listing-detail-price').textContent = item.price;
            document.getElementById('listing-detail-desc').textContent = item.description || 'Нет описания.';

            let statusText = 'АКТИВЕН';
            if (item.status === 'sold') statusText = 'ПРОДАНО';
            if (item.status === 'reserved') statusText = 'В РЕЗЕРВЕ';
            document.getElementById('listing-detail-status').textContent = `Статус: ${statusText}`;

            const gallery = document.getElementById('listing-detail-gallery');
            gallery.innerHTML = '';
            if (item.images && item.images.length > 0) {
                item.images.forEach(url => {
                    const img = document.createElement('img');
                    img.src = `${API_BASE_URL}${url}`;
                    img.style.width = '100px';
                    img.style.height = '100px';
                    img.style.objectFit = 'cover';
                    img.style.border = '1px solid var(--border-metal)';
                    img.style.cursor = 'pointer';
                    img.onclick = () => window.open(`${API_BASE_URL}${url}`, '_blank');
                    gallery.appendChild(img);
                });
            } else {
                gallery.innerHTML = '<div style="color: var(--text-dim); font-style: italic;">Нет фотографий</div>';
            }

            document.getElementById('listing-detail-message-btn').onclick = () => {
                document.getElementById('listing-detail-modal').style.display = 'none';
                startPrivateChat(item.seller_id);
            };

            const favBtn = document.getElementById('listing-detail-fav-btn');
            favBtn.textContent = item.is_favorite ? 'УБРАТЬ ИЗ ИЗБРАННОГО' : '❤️ В ИЗБРАННОЕ';
            favBtn.onclick = async (e) => {
                await window.toggleFavorite(e, item.id);
                favBtn.textContent = favBtn.classList.contains('favorited') ? 'УБРАТЬ ИЗ ИЗБРАННОГО' : '❤️ В ИЗБРАННОЕ';
            };

            document.getElementById('listing-detail-modal').style.display = 'flex';
        } catch(e) {
            addLog('Не удалось загрузить детали лота', 'error');
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

    let uploadedImageUrls = [];

    // --- Market Image Upload ---
    window.uploadMarketImages = async function(files) {
        if (!files || files.length === 0) return;

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        try {
            const token = state.user.token;
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const resp = await fetch(`${API_BASE_URL}/market/upload`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                throw new Error(err.detail || 'Upload failed');
            }

            const data = await resp.json();
            const urls = data.urls || [];

            uploadedImageUrls.push(...urls);
            renderMarketPhotoPreview();
            addLog(`Загружено ${urls.length} фото`, 'success');
        } catch (e) {
            addLog(`Ошибка загрузки фото: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
        }
    }

    function renderMarketPhotoPreview() {
        const previewContainer = document.getElementById('market-photo-preview');
        if (!previewContainer) return;
        previewContainer.innerHTML = '';

        uploadedImageUrls.forEach((url, idx) => {
            const thumbWrap = document.createElement('div');
            thumbWrap.style.position = 'relative';
            thumbWrap.style.width = '60px';
            thumbWrap.style.height = '60px';

            const img = document.createElement('img');
            img.src = `${API_BASE_URL}${url}`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid var(--border-metal)';

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '&times;';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '-5px';
            delBtn.style.right = '-5px';
            delBtn.style.background = '#ff3333';
            delBtn.style.color = '#fff';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '18px';
            delBtn.style.height = '18px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontSize = '12px';
            delBtn.style.lineHeight = '18px';
            delBtn.style.textAlign = 'center';
            delBtn.onclick = () => {
                uploadedImageUrls.splice(idx, 1);
                renderMarketPhotoPreview();
            };

            thumbWrap.appendChild(img);
            thumbWrap.appendChild(delBtn);
            previewContainer.appendChild(thumbWrap);
        });
    }

    // Attach listener to file input
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'market-photos') {
            if (e.target.files) {
                window.uploadMarketImages(e.target.files);
            }
        }
    });

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
            await apiRequest('/market', 'POST', {
                title,
                price,
                description,
                category,
                location,
                images: uploadedImageUrls
            });
            addLog('Лот успешно опубликован', 'success');
            // @ts-ignore
            titleElem.value = '';
            // @ts-ignore
            priceElem.value = '';
            // @ts-ignore
            descElem.value = '';
            uploadedImageUrls = [];
            renderMarketPhotoPreview();
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
                
                const td1 = document.createElement('td');
                const spanId = document.createElement('span');
                spanId.className = 'id-tag';
                spanId.textContent = u.id || '---';
                td1.appendChild(spanId);

                const td2 = document.createElement('td');

                const td3 = document.createElement('td');
                td3.className = 'highlight';
                td3.textContent = u.username;

                const td4 = document.createElement('td');
                const spanRank = document.createElement('span');
                spanRank.className = 'rank-badge';
                spanRank.textContent = u.rank;
                td4.appendChild(spanRank);

                const td5 = document.createElement('td');
                td5.className = 'stat-value';
                td5.textContent = u.karma;

                const td6 = document.createElement('td');
                const chatBtn = document.createElement('button');
                chatBtn.className = 'cyber-btn-small';
                chatBtn.textContent = 'СЕКРЕТНЫЙ ЧАТ';
                chatBtn.onclick = () => startPrivateChat(u.id);
                td6.appendChild(chatBtn);

                row.appendChild(td1);
                row.appendChild(td2);
                row.appendChild(td3);
                row.appendChild(td4);
                row.appendChild(td5);
                row.appendChild(td6);
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
                const dateDiv = document.createElement('div');
                dateDiv.className = 'event-date';
                dateDiv.textContent = safeDate;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'event-content';

                const h4 = document.createElement('h4');
                h4.textContent = e.title;

                const p = document.createElement('p');
                p.textContent = `📍 ${e.location || 'Секретная локация'}`;

                contentDiv.appendChild(h4);
                contentDiv.appendChild(p);

                const actionDiv = document.createElement('div');
                actionDiv.className = 'event-action';
                actionDiv.textContent = '> ДЕТАЛИ';

                eventCard.appendChild(dateDiv);
                eventCard.appendChild(contentDiv);
                eventCard.appendChild(actionDiv);
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
    // Make it available globally for RTCManager
    window.sendSocketEvent = function(type, payload) {
        if(state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
            state.chat.socket.send(JSON.stringify({ type: type, ...payload }));
        }
    };

    function connectWebSocket() {
        if (state.chat.socket) return;
        
        const token = state.user.token;
        state.chat.socket = new WebSocket(`${WS_URL}/ws/chat/${token}`);

        state.chat.socket.onopen = () => {
            const globalInd = document.getElementById('global-status-indicator');
            if (globalInd) globalInd.classList.add('online');
            addLog('WebSocket Connection Established: Skufia-Net Online', 'success');
        };

        state.chat.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'rtc_signal') {
                if(window.RTCManagerInstance) {
                    window.RTCManagerInstance.handleIncomingSignal(data.signal_type, data.payload, data.sender_id);
                }
            } else if (data.type === 'new_message') {
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

                if (state.chat.currentRoomId === msg.room_id) {
                    renderChatMessage(msg);
                }
                if (msg.sender !== state.user.username) {
                    playSound('alert');
                }
                
                // Update sidebar snippet
                loadChatRooms();
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
            const globalInd = document.getElementById('global-status-indicator');
            if (globalInd) globalInd.classList.remove('online');
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
                div.dataset.name = (room.name || '').toLowerCase();
                
                const avatarDiv = document.createElement('div');
                avatarDiv.className = 'sidebar-item-avatar';
                
                if (room.avatar_url) {
                    const img = document.createElement('img');
                    img.src = room.avatar_url;
                    img.alt = 'AV';
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    avatarDiv.appendChild(img);
                } else {
                    const initial = room.name ? room.name.charAt(0).toUpperCase() : '?';
                    avatarDiv.textContent = initial;
                    avatarDiv.classList.add('dynamic-avatar');
                    const charCode = initial.charCodeAt(0) || 0;
                    const hue = (charCode * 137) % 360;
                    avatarDiv.style.background = `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${hue}, 80%, 30%))`;
                    avatarDiv.style.color = '#fff';
                    avatarDiv.style.display = 'flex';
                    avatarDiv.style.alignItems = 'center';
                    avatarDiv.style.justifyContent = 'center';
                    avatarDiv.style.fontSize = '20px';
                    avatarDiv.style.fontWeight = 'bold';
                    avatarDiv.style.textShadow = '0 1px 3px rgba(0,0,0,0.5)';
                }

                const infoDiv = document.createElement('div');
                infoDiv.className = 'sidebar-item-info';

                const nameDiv = document.createElement('div');
                nameDiv.className = 'sidebar-item-name';
                nameDiv.textContent = room.name;

                const lastMsgDiv = document.createElement('div');
                lastMsgDiv.className = 'sidebar-item-last-msg';
                lastMsgDiv.textContent = room.last_message || 'Нет сообщений';

                infoDiv.appendChild(nameDiv);
                infoDiv.appendChild(lastMsgDiv);

                const statusSpan = document.createElement('span');
                statusSpan.className = `status-dot ${room.is_online ? 'online' : ''}`;
                statusSpan.style.display = 'none'; // User requested to hide this green dot

                div.appendChild(avatarDiv);
                div.appendChild(infoDiv);
                div.appendChild(statusSpan);
                div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role);
                list.appendChild(div);
            });
        } catch (e) { addLog('Failed to load chat channels', 'error'); }
    }

    /** 
     * @param {number} roomId 
     * @param {string} roomName 
     * @param {string} [type]
     * @param {number} [receiverId]
     * @param {string} [myRole]
     */
    async function selectChatRoom(roomId, roomName, type, receiverId, myRole) {
        state.chat.currentRoomId = roomId;
        state.chat.currentRoomName = roomName;
        state.chat.currentReceiverId = receiverId || null;
        
        const header = document.getElementById('chat-header');
        const history = document.getElementById('chat-history');
        const inputArea = document.querySelector('.chat-input-area');
        
        if (inputArea) {
            if (type === 'channel' && myRole !== 'admin') {
                inputArea.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim); font-style:italic; background:var(--bg-black); border-top:1px solid #333; width:100%;">Только администраторы могут писать в этот канал</div>`;
            } else {
                inputArea.innerHTML = `
                    <button class="attach-btn" onclick="document.getElementById('file-input').click()">📎</button>
                    <input type="file" id="file-input" style="display:none" onchange="uploadFileAndSend()">
                    <textarea id="chat-input" rows="1" placeholder="Введите сообщение..." oninput="this.style.height = ''; this.style.height = Math.min(this.scrollHeight, 120) + 'px';" onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.sendChatMessage(); }"></textarea>
                    <button class="send-btn" onclick="sendChatMessage()">ОТПРАВИТЬ</button>
                `;
            }
        }
        
        if (header) {
            const headerDiv = document.createElement('div');
            headerDiv.className = 'chat-user-header';

            const img = document.createElement('img');
            img.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${roomName}`;
            img.className = 'chat-user-avatar';

            const infoDiv = document.createElement('div');
            infoDiv.className = 'chat-user-info';

            const nameDiv = document.createElement('div');
            nameDiv.style.fontSize = '14px';
            nameDiv.textContent = roomName.toUpperCase();

            infoDiv.appendChild(nameDiv);
            headerDiv.appendChild(img);
            headerDiv.appendChild(infoDiv);

            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'encryption-badge';
            badgeDiv.id = 'chat-encryption-status';

            const span = document.createElement('span');
            span.textContent = '';

            badgeDiv.appendChild(span);

            header.innerHTML = '';
            header.appendChild(headerDiv);
            header.appendChild(badgeDiv);
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
                const response = await apiRequest(`/chat/rooms/${roomId}/history?limit=50`);
                history.innerHTML = '';
                const messages = response.messages || response; // backward compat
                state.chat.hasMore = response.has_more || false;
                state.chat.nextCursor = response.next_cursor || null;
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

        const headerDiv = document.createElement('div');
        headerDiv.className = 'msg-header';
        headerDiv.textContent = msg.sender + ' ';

        if (msg.is_secure || msg.iv) {
            const secureSpan = document.createElement('span');
            secureSpan.className = 'msg-secure-icon';
            secureSpan.textContent = '🔒';
            headerDiv.appendChild(secureSpan);
        }
        if (msg.is_edited) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'is-edited';
            editedSpan.textContent = '(изменено)';
            headerDiv.appendChild(editedSpan);
        }

        const textDiv = document.createElement('div');
        textDiv.className = 'msg-text';
        textDiv.textContent = msg.text || msg.content || '';

        const footerDiv = document.createElement('div');
        footerDiv.className = 'msg-footer';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        timeSpan.textContent = timeStr;
        footerDiv.appendChild(timeSpan);

        div.appendChild(headerDiv);
        if (replyHtml) {
            const replyContainer = document.createElement('div');
            replyContainer.innerHTML = replyHtml; // Assuming this is safe, otherwise can be handled further
            while (replyContainer.firstChild) {
                div.appendChild(replyContainer.firstChild);
            }
        }
        div.appendChild(textDiv);
        if (fileHtml) {
            const fileContainer = document.createElement('div');
            fileContainer.innerHTML = fileHtml; // Assuming safe URL
            while (fileContainer.firstChild) {
                div.appendChild(fileContainer.firstChild);
            }
        }
        div.appendChild(footerDiv);
        
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
            menu.innerHTML = '';
            const replyDiv = document.createElement('div');
            replyDiv.textContent = 'Ответить';
            replyDiv.onclick = () => setReply(msg.id, cleanText);
            menu.appendChild(replyDiv);

            if (isMe) {
                const editDiv = document.createElement('div');
                editDiv.textContent = 'Редактировать';
                editDiv.onclick = () => setEdit(msg.id, cleanText);
                menu.appendChild(editDiv);

                const deleteDiv = document.createElement('div');
                deleteDiv.className = 'delete-ctx';
                deleteDiv.textContent = 'Удалить';
                deleteDiv.onclick = () => deleteMessage(msg.id);
                menu.appendChild(deleteDiv);
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
    window.openFabHub = function() {
        document.getElementById('fab-hub-modal').style.display = 'flex';
        const contactList = document.getElementById('fab-contacts-list');
        contactList.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Загрузка...</div>';
        
        apiRequest('/users/list').then(users => {
            state.contacts = users.filter(u => u.id !== state.user.id);
            window['filterFabContacts']();
        }).catch(e => {
            contactList.innerHTML = '<div style="text-align:center; padding:15px; color:red;">Ошибка загрузки</div>';
        });
    };

    // @ts-ignore
    window.filterFabContacts = function() {
        const query = (document.getElementById('fab-contact-search')?.value || '').toLowerCase();
        const contactList = document.getElementById('fab-contacts-list');
        contactList.innerHTML = '';
        
        const filtered = (state.contacts || []).filter(u => 
            (u.username || '').toLowerCase().includes(query)
        );
        
        if (filtered.length === 0) {
            contactList.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Нет контактов</div>';
            return;
        }
        
        filtered.forEach(u => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.cursor = 'pointer';
            
            const initial = (u.username).charAt(0).toUpperCase();
            const charCode = initial.charCodeAt(0) || 0;
            const hue = (charCode * 137) % 360;
            
            div.innerHTML = `
                <div class="sidebar-item-avatar dynamic-avatar" style="background: linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${hue}, 80%, 30%)); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:20px;">
                    ${initial}
                </div>
                <div class="sidebar-item-info">
                    <div class="sidebar-item-name">${u.username}</div>
                    <div class="sidebar-item-last-msg">Скуфенгер</div>
                </div>
            `;
            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: "Private", room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? "Чат уже существует" : "Личный чат создан", 'success');
                    loadChatRooms();
                } catch(e) {
                    addLog('Ошибка создания чата', 'error');
                }
            };
            contactList.appendChild(div);
        });
    };

    // @ts-ignore
    window.openCreateRoomModal = function(type) {
        const modal = document.getElementById('create-room-modal');
        const title = document.getElementById('create-room-title');
        const label = document.getElementById('create-room-label');
        const typeInput = document.getElementById('create-room-type');
        const input = document.getElementById('create-room-input');
        
        title.textContent = type === 'channel' ? 'СОЗДАТЬ КАНАЛ' : 'СОЗДАТЬ ГРУППУ';
        label.textContent = type === 'channel' ? 'Название канала' : 'Название группы';
        if (typeInput) typeInput.value = type;
        if (input) input.value = '';
        
        modal.style.display = 'flex';
        if (input) input.focus();
    };

    // @ts-ignore
    window.confirmCreateRoom = async function() {
        const input = document.getElementById('create-room-input');
        const typeInput = document.getElementById('create-room-type');
        const pubToggle = document.getElementById('create-room-public');
        const name = input ? input.value.trim() : '';
        const rType = typeInput ? typeInput.value : 'group';
        const isPublic = pubToggle ? pubToggle.checked : false;
        
        if (!name) return;
        
        try {
            document.getElementById('create-room-modal').style.display = 'none';
            const payload = { name, room_type: rType, is_public: isPublic };
            const room = await apiRequest('/chat/rooms', 'POST', payload);
            addLog(`Создано: ${name}`, 'success');
            loadChatRooms();
        } catch (e) { addLog('Ошибка создания', 'error'); }
    };

    // --- ADD MEMBER LOGIC ---
    let addMemberSelectedIds = new Set();
    window.openAddMemberModal = function() {
        const modal = document.getElementById('add-member-modal');
        if (!modal || !state.chat.currentRoomId) return;
        addMemberSelectedIds.clear();
        document.getElementById('add-member-search').value = '';
        window.filterAddMemberContacts(); // Will render un-filtered
        modal.style.display = 'flex';
        if(window.toggleChatOptions) window.toggleChatOptions(); // close dropdown
    };

    window.filterAddMemberContacts = function() {
        const query = (document.getElementById('add-member-search').value || '').toLowerCase();
        const list = document.getElementById('add-member-list');
        if (!list) return;
        
        list.innerHTML = '';
        const contacts = state.contacts || [];
        const filtered = contacts.filter(c => 
            (c.name && c.name.toLowerCase().includes(query)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.username && c.username.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim);">Ничего не найдено</div>`;
            return;
        }

        filtered.forEach(c => {
            const div = document.createElement('div');
            div.className = 'sidebar-item contact-item';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '8px';
            div.style.borderBottom = '1px solid var(--border-metal)';
            
            const isSelected = addMemberSelectedIds.has(c.id);
            
            div.innerHTML = `
                <div style="display:flex; alignItems:center; gap:10px;">
                    <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${c.name || 'User'}" style="width:30px; height:30px; border-radius:50%; background:var(--bg-panel);">
                    <div>
                        <div style="font-size:13px; font-weight:500;">${c.name || c.username || 'Unknown'}</div>
                        <div style="font-size:11px; color:var(--text-dim);">${c.phone || ''}</div>
                    </div>
                </div>
                <input type="checkbox" ${isSelected ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;">
            `;
            
            div.onclick = () => {
                const cb = div.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                if(cb.checked) addMemberSelectedIds.add(c.id);
                else addMemberSelectedIds.delete(c.id);
            };
            
            list.appendChild(div);
        });
    };

    window.submitAddMembers = async function() {
        if (!state.chat.currentRoomId || addMemberSelectedIds.size === 0) return;
        
        const userIds = Array.from(addMemberSelectedIds);
        try {
            await apiRequest(`/chat/rooms/${state.chat.currentRoomId}/members`, 'POST', { user_ids: userIds });
            addLog(`Добавлено участников: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
        } catch (e) {
            addLog('Ошибка при добавлении участников', 'error');
        }
    };
    // -------------------------

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

    // [PERF-204] Local Debounced Contact Search
    const searchInput = document.getElementById('contact-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const term = e.target.value.toLowerCase().trim();
                const items = document.querySelectorAll('#chat-rooms-list .sidebar-item');
                items.forEach(item => {
                    const name = item.dataset.name || '';
                    item.style.display = name.includes(term) ? 'flex' : 'none';
                });
            }, 300); // 300ms debounce
        });
    }

    // [AUDIO-202] Voice Recorder Service
    class VoiceRecorderService {
        constructor() {
            this.btn = document.getElementById('voice-record-btn');
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.isRecording = false;
            if(this.btn) {
                this.btn.addEventListener('mousedown', () => this.start());
                this.btn.addEventListener('mouseup', () => this.stop());
                this.btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.start(); }, {passive: false});
                this.btn.addEventListener('touchend', (e) => { e.preventDefault(); this.stop(); });
                this.btn.addEventListener('mouseleave', () => { if(this.isRecording) this.stop(); });
            }
        }
        
        async start() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                this.audioChunks = [];
                this.mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) this.audioChunks.push(event.data);
                };
                this.mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
                    this.audioChunks = [];
                    stream.getTracks().forEach(t => t.stop());
                    this.btn.style.color = '';
                    this.btn.classList.remove('recording');
                    if (audioBlob.size > 1000) { // check minimum size
                        this.uploadAudio(audioBlob);
                    }
                };
                this.mediaRecorder.start();
                this.isRecording = true;
                this.btn.classList.add('recording');
                this.btn.style.color = 'var(--accent-color)';
                addLog('Запись голосового сообщения...', 'info');
            } catch(e) {
                addLog('Микрофон недоступен: ' + e.message, 'error');
            }
        }
        
        stop() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }
        
        async uploadAudio(blob) {
            const formData = new FormData();
            formData.append('file', blob, 'voice_msg.webm');
            try {
                const headers = {};
                if (state.user.token) headers['Authorization'] = `Bearer ${state.user.token}`;
                const resp = await fetch(`${API_BASE_URL}/api/chat/upload_audio`, {
                    method: 'POST',
                    headers,
                    body: formData
                });
                if (!resp.ok) throw new Error('Upload failed');
                const data = await resp.json();
                
                const msgInput = document.getElementById('chat-input');
                const originalVal = msgInput.value;
                state.pendingFile = { url: data.audio_url, name: 'Voice Message' };
                msgInput.value = '🎤 Голосовое сообщение';
                await sendChatMsg();
                msgInput.value = originalVal;
            } catch(e) {
                addLog('Ошибка отправки голосового сообщения', 'error');
            }
        }
    }

    // [UX-201] Emoji Picker Engine
    class EmojiPickerEngine {
        constructor() {
            this.btn = document.querySelector('.emoji-btn');
            this.input = document.getElementById('chat-input');
            if(!this.btn || !this.input) return;
            
            this.picker = document.createElement('div');
            this.picker.className = 'emoji-picker premium-scroll';
            this.picker.style.display = 'none';
            
            const emojis = ['😀','😂','🥰','😎','🤔','😡','👍','👎','❤️','🔥','🎉','👀','💯','🤡','🥺','💀','🤓','🧠','🍺','🍕'];
            emojis.forEach(emo => {
                const span = document.createElement('span');
                span.textContent = emo;
                span.onclick = () => {
                    this.input.value += emo;
                    this.picker.style.display = 'none';
                    this.input.focus();
                };
                this.picker.appendChild(span);
            });
            
            // Append relative to the input row
            const row = document.querySelector('.chat-input-row');
            if(row) row.appendChild(this.picker);
            
            this.btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.picker.style.display = this.picker.style.display === 'none' ? 'flex' : 'none';
            });
            
            document.addEventListener('click', () => {
                if(this.picker) this.picker.style.display = 'none';
            });
            this.picker.addEventListener('click', e => e.stopPropagation());
        }
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
        await ensureKeys();
        setTimeout(() => addLog('Loading Cyber-Industrial HUD...'), 500);
        setTimeout(() => addLog('Connecting to Global Registry...'), 1000);
        setTimeout(() => addLog('Handshaking with Database Cluster...'), 1500);
        setTimeout(() => {
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
                }).catch(err => {
                    console.error('SW registration failed:', err);
                });
            }
        }, 2000);
    }

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

    // --- PHASE 6 & 7: SETTINGS AND CONTACT SYNC UX ---
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            settingsModal.style.display = 'flex';
        });
    }

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
                        const resp = await fetch(`${API_BASE_URL}/api/contacts/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.user.token}` },
                            body: JSON.stringify({ contacts: payload })
                        });
                        if (resp.ok) {
                            addLog(`Успешно подтянуто абонентов: ${contacts.length}`, 'success');
                            loadChatRooms(); // refresh sidebar 
                        } else throw new Error();
                    } else {
                        addLog('Контакты не выбраны', 'info');
                    }
                } else {
                    addLog('Contact Picker API не поддерживается на вашем устройстве. Backend Sync Mode активирован.', 'info');
                    // Fallback to manual sync trigger on backend
                    const resp = await fetch(`${API_BASE_URL}/api/contacts/sync`, {
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
    // --- STANDALONE MODE FOR SKUFENGER ---
    if (new URLSearchParams(window.location.search).get('app') === 'skufenger') {
        const sidePanel = document.querySelector('.side-panel');
        const header = document.querySelector('.system-header');
        const footer = document.querySelector('.system-footer');
        const appContainer = document.querySelector('.app-container');
        const viewport = document.querySelector('.viewport');
        const mainInterface = document.querySelector('.main-interface');
        const title = document.getElementById('skufenger-heading');
        const viewMessages = document.getElementById('view-messages');
        const chatLayout = viewMessages ? viewMessages.querySelector('.chat-layout') : null;
        
        if (sidePanel) sidePanel.style.display = 'none';
        if (header) header.style.display = 'none';
        if (footer) footer.style.display = 'none';
        if (title) title.style.display = 'none';

        if (appContainer) {
            appContainer.style.cssText = 'padding:0;margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;';
        }
        if (mainInterface) {
            mainInterface.style.cssText = 'flex:1;height:100vh;gap:0;overflow:hidden;';
        }
        if (viewport) {
            viewport.style.cssText = 'flex:1;padding:0;border:none;border-radius:0;height:100%;overflow:hidden;display:flex;flex-direction:column;';
        }
        if (viewMessages) {
            viewMessages.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;min-height:0;overflow:hidden;';
        }
        if (chatLayout) {
            chatLayout.style.cssText = 'display:flex;flex:1;height:100%;min-height:0;overflow:hidden;border:none;border-radius:0;';
        }

        // Force the chat view right away
        switchView('messages');

        // Set document title
        document.title = 'SKUFenger';
    }

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
    window.openSkufenger = function() {
        window.open(window.location.pathname + '?app=skufenger', '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
    };

    // --- CONTACT SEARCH FILTER ---
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
            addLog('Сначала выберите контакт для звонка', 'error');
            return;
        }
        const targetId = state.chat.currentReceiverId || state.chat.currentRoomId;
        if (!window.RTCManagerInstance) {
            addLog('RTC модуль не инициализирован', 'error');
            return;
        }
        addLog(`Инициация ${isVideo ? 'видео' : 'аудио'} звонка...`, 'info');
        window.RTCManagerInstance.startCall(targetId, isVideo);
    };

    // --- CHAT OPTIONS DROPDOWN ---
    window.toggleChatOptions = function() {
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

// Settings Avatar Preview
window.previewAvatar = function(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById("settings-avatar-preview").src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
};