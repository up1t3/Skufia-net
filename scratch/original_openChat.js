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
    
    window.setAndCloseTheme = function(themeName) {
        changeTheme(themeName);
        document.getElementById('theme-switcher-modal').style.display = 'none';
        
        // Add a nice cyber-glitch effect on save
        const heroText = document.querySelector('.glitch');
        if (heroText) {
            heroText.style.animation = 'none';
            setTimeout(() => { heroText.style.animation = ''; }, 10);
        }
    };

    // Initialize Theme
    const savedTheme = localStorage.getItem('skufia_theme') || 'telegram';
    changeTheme(savedTheme);
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        themeSelector.value = savedTheme;
    }

    // --- Configuration ---
    // Use relative path for production, but point directly to backend for local dev server
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const API_BASE_URL = isLocalDev ? 'http://localhost:8007/api' : '/api';

    // --- Utility: Debounce ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- State Management ---
    window.marketState = {
        page: 1,
        layout: 'grid',
        filters: { q: '', cat: '¶“T¡¶¶', loc: '¶“¶¶¶¨¶+¶¶', sort: 'newest', min: null, max: null }
    };
    window.updatePriceFilter = debounce(function(e, type) { 
        window.marketState.filters[type] = e.target.value; 
        window.marketState.page = 1; 
        loadMarket(); 
    }, 500);
    window.updateMarketSort = function(e) { window.marketState.filters.sort = e.target.value; window.marketState.page = 1; loadMarket(); };
    window.setMarketLayout = function(layout) { window.marketState.layout = layout; loadMarket(); };

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
            sessionKeys: {}, // Map of roomId -> CryptoKey (AES)
            currentFolderId: 'all',
            folders: []
        },
        logs: [],
        audioEnabled: true,
        /** @type {{ url: string, name: string } | null} */
        pendingFile: null
    };

    // =========================================================================
    // SECURE CRYPTO ENGINE v2 Ú¿‘ Signal-inspired E2EE
    // =========================================================================
    // Security properties:
    // Ú‹≈ RSA private key: non-extractable, persisted in IndexedDB only
    // Ú‹≈ AES session keys: non-extractable, cached per-room in IndexedDB
    // Ú‹≈ Key fingerprint: SHA-256 of public key bytes, displayed to user
    // Ú‹≈ Per-room AES-256-GCM keys Ú¿‘ no universal key
    // Ú‹≈ Private key NEVER sent to server
    // Ú‹≈ Server stores only: public keys + RSA-wrapped AES bundles
    // =========================================================================

    const IDB_NAME = 'skufia_vault';
    const IDB_VERSION = 2;
    const IDB_STORE_KEYS = 'identity_keys';
    const IDB_STORE_SESSION = 'session_keys';

    /** Open (or upgrade) the crypto vault IndexedDB */
    function openVault() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE_KEYS)) {
                    db.createObjectStore(IDB_STORE_KEYS);
                }
                if (!db.objectStoreNames.contains(IDB_STORE_SESSION)) {
                    db.createObjectStore(IDB_STORE_SESSION);
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    }

    /** Read a value from IndexedDB */
    async function vaultGet(store, key) {
        const db = await openVault();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    /** Write a value to IndexedDB */
    async function vaultPut(store, key, value) {
        const db = await openVault();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /** Delete a value from IndexedDB */
    async function vaultDelete(store, key) {
        const db = await openVault();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    class CryptoManager {

        // Ú‘¿Ú‘¿ RSA Key Pair Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿

        /**
         * Generate RSA-OAEP 4096-bit key pair.
         * Private key is NON-EXTRACTABLE Ú¿‘ cannot be exported by any JS code.
         * @returns {Promise<CryptoKeyPair>}
         */
        static async generateKeyPair() {
            return await window.crypto.subtle.generateKey(
                {
                    name: 'RSA-OAEP',
                    modulusLength: 4096,          // 4096 for long-term identity
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                false,                            // Ú∆– extractable: FALSE (private key protected!)
                ['encrypt', 'decrypt']
            );
        }

        /**
         * Export only the PUBLIC key as base64 SPKI (safe to share).
         * @param {CryptoKey} key
         * @returns {Promise<string>}
         */
        static async exportPublicKey(key) {
            const exported = await window.crypto.subtle.exportKey('spki', key);
            return btoa(String.fromCharCode(...new Uint8Array(exported)));
        }

        /**
         * Import a public key from base64 SPKI.
         * @param {string} base64
         * @returns {Promise<CryptoKey>}
         */
        static async importPublicKey(base64) {
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            return await window.crypto.subtle.importKey(
                'spki', bytes,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                true,               // Public key can be extractable (it's public)
                ['encrypt']
            );
        }

        /**
         * Compute SHA-256 fingerprint of a base64 public key.
         * Displayed to user to detect MITM / key substitution.
         * @param {string} pubBase64
         * @returns {Promise<string>} fingerprint like "A1:B2:C3:..."
         */
        static async keyFingerprint(pubBase64) {
            const bytes = Uint8Array.from(atob(pubBase64), c => c.charCodeAt(0));
            const hash = await window.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(hash))
                .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                .join(':');
        }

        // Ú‘¿Ú‘¿ AES Session Key Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿

        /**
         * Generate a fresh AES-256-GCM key for a chat session.
         * NON-EXTRACTABLE Ú¿‘ key bytes never leave the browser's crypto engine.
         * @returns {Promise<CryptoKey>}
         */
        static async generateSessionKey() {
            return await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                false,              // Ú∆– non-extractable!
                ['encrypt', 'decrypt']
            );
        }

        // Ú‘¿Ú‘¿ Key Wrapping (RSA-OAEP wraps AES) Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿

        /**
         * Wrap (encrypt) an AES session key with an RSA public key.
         * The result is a base64 blob safe to store on the server.
         * @param {CryptoKey} rsaPublicKey
         * @param {CryptoKey} aesKey
         * @returns {Promise<string>} base64-encoded wrapped key
         */
        static async wrapKey(rsaPublicKey, aesKey) {
            // Must exportKey('raw') since aesKey is non-extractable from our side,
            // but we use wrapKey API which doesn't require extractable
            const wrapped = await window.crypto.subtle.wrapKey(
                'raw',
                aesKey,
                rsaPublicKey,
                { name: 'RSA-OAEP' }
            );
            return btoa(String.fromCharCode(...new Uint8Array(wrapped)));
        }

        /**
         * Unwrap (decrypt) a wrapped AES key using our RSA private key.
         * Returns a non-extractable AES CryptoKey.
         * @param {CryptoKey} rsaPrivateKey
         * @param {string} wrappedBase64
         * @returns {Promise<CryptoKey>}
         */
        static async unwrapKey(rsaPrivateKey, wrappedBase64) {
            const wrapped = Uint8Array.from(atob(wrappedBase64), c => c.charCodeAt(0));
            return await window.crypto.subtle.unwrapKey(
                'raw',
                wrapped,
                rsaPrivateKey,
                { name: 'RSA-OAEP' },
                { name: 'AES-GCM', length: 256 },
                false,              // Ú∆– result is also non-extractable
                ['encrypt', 'decrypt']
            );
        }

        // Ú‘¿Ú‘¿ Message Encryption / Decryption Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿

        /**
         * Encrypt plaintext with AES-256-GCM.
         * @param {CryptoKey} key
         * @param {string} text
         * @returns {Promise<{content: string, iv: string}>}
         */
        static async encryptMessage(key, text) {
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encoded = new TextEncoder().encode(text);
            const ciphertext = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                encoded
            );
            return {
                content: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
                iv: btoa(String.fromCharCode(...iv))
            };
        }

        /**
         * Decrypt AES-256-GCM ciphertext.
         * @param {CryptoKey} key
         * @param {string} base64Content
         * @param {string} base64Iv
         * @returns {Promise<string>}
         */
        static async decryptMessage(key, base64Content, base64Iv) {
            const iv = Uint8Array.from(atob(base64Iv), c => c.charCodeAt(0));
            const ciphertext = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decrypted);
        }
    }

    // Ú‘¿Ú‘¿ Key Vault: persist identity + session keys in IndexedDB Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿Ú‘¿

    /**
     * Get or generate the user's RSA identity key pair.
     * Private key is stored as a NON-EXTRACTABLE CryptoKey in IndexedDB.
     * Public key is stored as base64 (it's public).
     * If keys exist: loads them from IndexedDB.
     * If not: generates new pair, saves to IndexedDB, registers pubKey on server.
     */
    async function ensureKeys() {
        if (state.chat.keys.publicKey && state.chat.keys.privateKey) return;

        try {
            // Try loading from IndexedDB vault
            const storedPub = await vaultGet(IDB_STORE_KEYS, 'pub_base64');
            const storedPriv = await vaultGet(IDB_STORE_KEYS, 'priv_cryptokey');

            if (storedPub && storedPriv) {
                // storedPriv is the non-extractable CryptoKey object saved in IDB
                addLog('®ﬂ‘– ¶◊¶-¶¶T¿T√¶¨¶¶¶- ¶¶¶¨TŒT«¶¶¶¶ ¶¨¶¨ ¶¨¶-T…¶¨T…T—¶-¶-¶-¶¶¶- T≈T¿¶-¶-¶¨¶¨¶¨T…¶-...', 'info');
                state.chat.keys.publicKey = await CryptoManager.importPublicKey(storedPub);
                state.chat.keys.privateKey = storedPriv; // already a CryptoKey
                // Always re-register pubKey in case server restarted
                await apiRequest('/me/key', 'POST', { public_key: storedPub }).catch(() => {});
                const fp = await CryptoManager.keyFingerprint(storedPub);
                state.chat.keyFingerprint = fp;
                addLog(`®ﬂ‘— ¶⁄¶¨TŒT«¶¨ ¶-¶-T¡T¡T¬¶-¶-¶-¶-¶¨¶¶¶-TÀ | ¶ﬁT¬¶¨¶¶T«¶-T¬¶-¶¶: ${fp.slice(0, 23)}...`, 'success');
                // Clear old insecure localStorage keys if present
                localStorage.removeItem('skufia_pub_spki');
                localStorage.removeItem('skufia_priv_pkcs8');
                return;
            }
        } catch (e) {
            addLog('Ú⁄‡ˇ¨œ ¶ﬁT»¶¨¶-¶¶¶- T«T¬¶¶¶-¶¨Tœ T≈T¿¶-¶-¶¨¶¨¶¨T…¶-, ¶¶¶¶¶-¶¶T¿¶¨T¿T√¶¶¶- ¶-¶-¶-TÀ¶¶ ¶¶¶¨TŒT«¶¨...', 'info');
            await vaultDelete(IDB_STORE_KEYS, 'pub_base64');
            await vaultDelete(IDB_STORE_KEYS, 'priv_cryptokey');
        }

        // Generate fresh RSA-4096 identity key pair
        addLog('Ú⁄Ÿˇ¨œ ¶”¶¶¶-¶¶T¿¶-T∆¶¨Tœ RSA-4096 ¶¶¶¨TŒT«¶¶¶-¶-¶¶ ¶¨¶-T¿TÀ...', 'info');
        const pair = await CryptoManager.generateKeyPair();
        state.chat.keys.publicKey = pair.publicKey;
        state.chat.keys.privateKey = pair.privateKey;

        // Export ONLY the public key (private stays inside WebCrypto engine)
        const pubBase64 = await CryptoManager.exportPublicKey(pair.publicKey);

        // Save to IndexedDB:
        //   - public key as base64 string (for re-import after page reload)
        //   - private key as CryptoKey object (non-extractable, browser protects it)
        await vaultPut(IDB_STORE_KEYS, 'pub_base64', pubBase64);
        await vaultPut(IDB_STORE_KEYS, 'priv_cryptokey', pair.privateKey);

        // Register public key on server (server NEVER sees private key)
        await apiRequest('/me/key', 'POST', { public_key: pubBase64 });

        const fp = await CryptoManager.keyFingerprint(pubBase64);
        state.chat.keyFingerprint = fp;
        addLog(`Ú‹≈ E2EE ¶¶¶¨TŒT«¶¨ T¡¶-¶¨¶+¶-¶-TÀ ¶¨ ¶¨¶-T…¶¨T…¶¶¶-TÀ | ¶ﬁT¬¶¨¶¶T«¶-T¬¶-¶¶: ${fp.slice(0, 23)}...`, 'success');
    }

    /**
     * Get or establish a session key for a given room.
     * Tries IndexedDB cache first, then server-stored wrapped bundle.
     * @param {number} roomId
     * @param {number|null} receiverId
     * @returns {Promise<CryptoKey|null>}
     */
    async function getOrEstablishSessionKey(roomId, receiverId) {
        // 1. Check in-memory cache
        if (state.chat.sessionKeys[roomId]) {
            return state.chat.sessionKeys[roomId];
        }

        // 2. Check IndexedDB session cache
        try {
            const cached = await vaultGet(IDB_STORE_SESSION, `room_${roomId}`);
            if (cached) {
                state.chat.sessionKeys[roomId] = cached;
                return cached;
            }
        } catch(e) {}

        // 3. Try to fetch wrapped key from server and unwrap locally
        await ensureKeys();
        if (!state.chat.keys.privateKey) return null;

        try {
            const keyBundle = await apiRequest(`/chat/rooms/${roomId}/key`);
            if (keyBundle && keyBundle.wrapped_key) {
                const sessionKey = await CryptoManager.unwrapKey(
                    state.chat.keys.privateKey,
                    keyBundle.wrapped_key
                );
                // Cache in memory and IndexedDB
                state.chat.sessionKeys[roomId] = sessionKey;
                await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});
                addLog(`®ﬂ‘” ¶·¶¶T¡T¡¶¨¶-¶-¶-TÀ¶¶ ¶¶¶¨TŒT« ¶-¶-T¡T¡T¬¶-¶-¶-¶-¶¨¶¶¶- ¶+¶¨Tœ ¶¶¶-¶-¶-¶-T¬TÀ #${roomId}`, 'success');
                return sessionKey;
            }
        } catch (e) {
            // 404 = no key yet Ú¿‘ we are the initiator
        }

        // 4. Generate new session key and distribute to both parties
        if (!receiverId) return null;

        addLog(`®ﬂ‘— ¶„T¡T¬¶-¶-¶-¶-¶¶¶- E2EE T¡¶¶T¡T¡¶¨¶¨ T¡ ¶¨¶-¶¨TÃ¶¨¶-¶-¶-T¬¶¶¶¨¶¶¶- #${receiverId}...`, 'info');

        // Fetch recipient's public key
        const targetKeyData = await apiRequest(`/users/${receiverId}/key`).catch(() => null);
        if (!targetKeyData || !targetKeyData.public_key) {
            addLog('Ú⁄‡ˇ¨œ ¶ﬂ¶-¶¨T√T«¶-T¬¶¶¶¨TÃ ¶¶T…T— ¶-¶¶ ¶¨¶-T¿¶¶¶¶¶¨T¡T¬T¿¶¨T¿¶-¶-¶-¶¨ ¶¶¶¨TŒT«¶¨ E2EE', 'error');
            return null;
        }

        // Show fingerprint of recipient's key for MITM detection
        const recipientFp = await CryptoManager.keyFingerprint(targetKeyData.public_key);
        addLog(`®ﬂ‘Õ ¶ﬁT¬¶¨¶¶T«¶-T¬¶-¶¶ ¶¶¶¨TŒT«¶- ¶¨¶-¶¨T√T«¶-T¬¶¶¶¨Tœ: ${recipientFp.slice(0, 23)}...`, 'info');

        // Generate fresh AES-256-GCM session key
        const sessionKey = await CryptoManager.generateSessionKey();
        state.chat.sessionKeys[roomId] = sessionKey;

        // Wrap session key for RECIPIENT using their RSA public key
        const recipientPubKey = await CryptoManager.importPublicKey(targetKeyData.public_key);
        const wrappedForRecipient = await CryptoManager.wrapKey(recipientPubKey, sessionKey);

        // Wrap session key for OURSELVES (so we can decrypt our own sent messages)
        const myPubBase64 = await vaultGet(IDB_STORE_KEYS, 'pub_base64');
        const myPubKey = await CryptoManager.importPublicKey(myPubBase64);
        const wrappedForSelf = await CryptoManager.wrapKey(myPubKey, sessionKey);

        // Store both bundles on server (server cannot decrypt Ú¿‘ only wrapped blobs)
        const keysPayload = {};
        keysPayload[String(receiverId)] = wrappedForRecipient;
        keysPayload[String(state.user.id)] = wrappedForSelf;
        await apiRequest(`/chat/rooms/${roomId}/key`, 'POST', { keys: keysPayload });

        // Cache in IndexedDB
        await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});

        addLog(`Ú‹≈ E2EE T¡¶¶T¡T¡¶¨Tœ T√T¡T¬¶-¶-¶-¶-¶¨¶¶¶-¶- | ¶ﬁT¬¶¨¶¶T«¶-T¬¶-¶¶: ${recipientFp.slice(0, 11)}...`, 'success');
        return sessionKey;
    }



    // Use relative port for WebSocket (proxied via Nginx)
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = isLocalDev ? 'localhost:8007' : window.location.host; 
    const WS_URL = protocol + host;

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
    const mobileMenuBtn = document.getElementById('mobile-menu-toggle');
    const sidePanel = document.querySelector('.side-panel');
    if (mobileMenuBtn && sidePanel) {
        // Redundant listeners removed. The actual logic is handled at the bottom of the file (lines 3018+)
    }

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
            if (viewId === 'messages') { loadChatRooms(); if (window.loadFolders) window.loadFolders(); }
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
            backLink.textContent = '<< ¶“¶¶T¿¶-T√T¬TÃT¡Tœ ¶¶ T¡¶¨¶¨T¡¶¶T√';
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
                metaDiv.textContent = `by ${post.author} | ®ﬂ—Õ `;

                const likesSpan = document.createElement('span');
                likesSpan.id = `likes-${post.id}`;
                likesSpan.textContent = post.likes;

                const btn = document.createElement('button');
                btn.className = 'small-btn';
                btn.textContent = '¶ﬂ¶-¶+¶+¶¶T¿¶¶¶-T¬TÃ';
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

    // --- MARKET EVENT LISTENERS ---
    const marketSearchInput = document.getElementById('market-search');
    if (marketSearchInput) {
        marketSearchInput.addEventListener('input', debounce((e) => {
            window.marketState.filters.q = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        }, 300));
    }
    const marketFilterCat = document.getElementById('market-filter-cat');
    if (marketFilterCat) {
        marketFilterCat.addEventListener('change', (e) => {
            window.marketState.filters.cat = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        });
    }
    const marketFilterLoc = document.getElementById('market-filter-loc');
    if (marketFilterLoc) {
        marketFilterLoc.addEventListener('change', (e) => {
            window.marketState.filters.loc = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        });
    }


    // --- MODULE: WIKI ---
    async function loadWiki() {
        const container = document.querySelector('.wiki-content');
        if (!container) return;
        try {
            const articles = await apiRequest('/wiki');
            container.innerHTML = '';
            if (articles.length === 0) {
                container.innerHTML = '<div class="system-msg">LIBRARY_EMPTY: ¶ﬂ¶-¶¨T¡¶¶ ¶+¶-¶-¶-TÀT≈ ¶-¶¶ ¶+¶-¶¨ T¿¶¶¶¨T√¶¨TÃT¬¶-T¬¶-¶-.</div>';
                return;
            }
            articles.forEach(art => {
                const div = document.createElement('div');
                div.className = 'wiki-card';
                const h3 = document.createElement('h3');
                h3.textContent = art.title;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = '®ﬂ—Õ ';

                const likesSpan = document.createElement('span');
                likesSpan.id = `wiki-likes-${art.id}`;
                likesSpan.textContent = art.likes || 0;

                const likeBtn = document.createElement('button');
                likeBtn.className = 'small-btn';
                likeBtn.textContent = '¶ﬁ¶+¶-¶-T¿¶¨T¬TÃ';
                likeBtn.onclick = () => likeWiki(art.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(likeBtn);

                const p = document.createElement('p');
                p.className = 'wiki-excerpt';
                p.textContent = art.content ? art.content.substring(0, 150) + '...' : '¶⁄¶-¶-T¬¶¶¶-T¬ ¶¨¶-T¡¶¶¶¶T¿¶¶T«¶¶¶-';

                const openBtn = document.createElement('button');
                openBtn.className = 'cyber-btn-small';
                openBtn.textContent = '¶ﬁ¶‚¶⁄¶‡¶Î¶‚¶Ï ¶‘¶–¶›¶›¶Î¶’';
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
        
        container.className = 'market-grid ' + (window.marketState.layout === 'list' ? 'market-list-view' : '');
        container.innerHTML = '<div class="system-msg">Scanning trade frequencies...</div>';
        try {
            const params = new URLSearchParams();
            if (window.marketState.filters.cat && window.marketState.filters.cat !== '¶“T¡¶¶') {
                params.append('category', window.marketState.filters.cat);
            }
            if (window.marketState.filters.loc && window.marketState.filters.loc !== '¶“¶¶¶¨¶+¶¶') {
                params.append('location', window.marketState.filters.loc);
            }
            if (window.marketState.filters.q) {
                params.append('q', window.marketState.filters.q);
            }
            if (window.marketState.filters.min) {
                params.append('min_price', window.marketState.filters.min);
            }
            if (window.marketState.filters.max) {
                params.append('max_price', window.marketState.filters.max);
            }
            if (window.marketState.filters.sort) {
                params.append('sort', window.marketState.filters.sort);
            }
            params.append('page', window.marketState.page.toString());

            const data = await apiRequest(`/market?${params.toString()}`);
            const listings = data.items || [];

            container.innerHTML = '';
            if (!listings || listings.length === 0) {
                container.innerHTML = '<div class="system-msg">MARKET_EMPTY: ¶›¶¶T¬ ¶-¶¶T¬¶¨¶-¶-TÀT≈ ¶¨¶-T¬¶-¶- ¶-¶- ¶-¶¨T¿¶¶¶¶.</div>';
                if(window.renderMarketPagination) window.renderMarketPagination(1, 1);
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
                    statusBadgeHtml = `<span class="status-badge sold">¶ﬂ¶‡¶ﬁ¶‘¶–¶›¶ﬁ</span>`;
                } else if (item.status === 'reserved') {
                    statusBadgeHtml = `<span class="status-badge reserved">¶“ ¶‡¶’¶◊¶’¶‡¶“¶’</span>`;
                } else {
                    statusBadgeHtml = `<span class="status-badge active">¶–¶⁄¶‚¶ÿ¶“¶’¶›</span>`;
                }

                // Favorite Heart
                const isFav = item.is_favorite ? 'favorited' : '';
                const favHtml = `<span class="favorite-btn ${isFav}" onclick="toggleFavorite(event, ${item.id})">Ú›‰ˇ¨œ</span>`;

                let deleteButtonHTML = '';
                if (item.seller_id === state.user.id) {
                    deleteButtonHTML = `<button class="btn-danger" style="margin-top: 5px; font-size: 10px; width: 100%" onclick="event.stopPropagation(); deleteMarketListing(${item.id})">¶„¶‘¶–¶€¶ÿ¶‚¶Ï ¶€¶ﬁ¶‚</button>`;
                }

                const imgContainer = document.createElement('div');
                imgContainer.className = 'market-card-image-container';
                imgContainer.innerHTML = coverImageHtml + statusBadgeHtml + favHtml; // Safe: no user text in these HTML strings
                const viewsDiv = document.createElement('div');
                viewsDiv.className = 'views-count';
                viewsDiv.textContent = `®ﬂ—¡ ${item.views_count || 0}`;
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

            if(window.renderMarketPagination) {
                window.renderMarketPagination(data.page || 1, data.pages || 1);
            }
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: ¶›¶¶ T√¶+¶-¶¨¶-T¡TÃ T¡¶¨¶-T≈T¿¶-¶-¶¨¶¨¶¨T¿¶-¶-¶-T¬TÃ ¶+¶-¶-¶-TÀ¶¶ ¶-¶¨T¿¶¶¶¨.</div>';
        }
    }

    window.renderMarketPagination = function(currentPage, totalPages) {
        let paginationContainer = document.querySelector('.market-pagination');
        if (!paginationContainer) {
            paginationContainer = document.createElement('div');
            paginationContainer.className = 'market-pagination';
            paginationContainer.style.display = 'flex';
            paginationContainer.style.justifyContent = 'center';
            paginationContainer.style.alignItems = 'center';
            paginationContainer.style.gap = '15px';
            paginationContainer.style.marginTop = '20px';

            const viewTrade = document.getElementById('view-trade');
            if(viewTrade) {
                viewTrade.appendChild(paginationContainer);
            }
        }

        paginationContainer.innerHTML = '';

        if (totalPages <= 1) return; // Hide if only 1 page

        const prevBtn = document.createElement('button');
        prevBtn.className = 'cyber-btn-small';
        prevBtn.textContent = '¶›¶–¶◊¶–¶‘';
        prevBtn.disabled = currentPage <= 1;
        if(currentPage <= 1) prevBtn.style.opacity = '0.5';
        prevBtn.onclick = () => {
            if (window.marketState.page > 1) {
                window.marketState.page--;
                loadMarket();
            }
        };

        const pageText = document.createElement('span');
        pageText.style.color = 'var(--text-main)';
        pageText.style.fontFamily = 'var(--font-mono)';
        pageText.textContent = `¶·¶‚¶‡¶–¶›¶ÿ¶Ê¶– ${currentPage} / ${totalPages}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'cyber-btn-small';
        nextBtn.textContent = '¶“¶ﬂ¶’¶‡¶’¶‘';
        nextBtn.disabled = currentPage >= totalPages;
        if(currentPage >= totalPages) nextBtn.style.opacity = '0.5';
        nextBtn.onclick = () => {
            if (window.marketState.page < totalPages) {
                window.marketState.page++;
                loadMarket();
            }
        };

        paginationContainer.appendChild(prevBtn);
        paginationContainer.appendChild(pageText);
        paginationContainer.appendChild(nextBtn);
    }

    window.toggleFavorite = async function(event, itemId) {
        event.stopPropagation();
        try {
            const res = await apiRequest(`/market/${itemId}/favorite`, 'POST');
            const target = event.currentTarget;
            if (res.status === 'added') {
                target.classList.add('favorited');
                addLog('¶€¶-T¬ ¶+¶-¶-¶-¶-¶¨¶¶¶- ¶- ¶¨¶¨¶-T¿¶-¶-¶-¶-¶¶', 'info');
            } else {
                target.classList.remove('favorited');
                addLog('¶€¶-T¬ T√¶+¶-¶¨¶¶¶- ¶¨¶¨ ¶¨¶¨¶-T¿¶-¶-¶-¶-¶¶¶-', 'info');
            }
        } catch (e) { console.error("Favorite toggle failed", e); }
    }

    window.openListingModal = async function(itemId) {
        try {
            const item = await apiRequest(`/market/${itemId}`);

            document.getElementById('listing-detail-title').textContent = item.title;
            document.getElementById('listing-detail-price').textContent = item.price;
            document.getElementById('listing-detail-desc').textContent = item.description || '¶›¶¶T¬ ¶-¶¨¶¨T¡¶-¶-¶¨Tœ.';

            const statusContainer = document.getElementById('listing-detail-status');
            if (item.seller_id === state.user.id) {
                const select = document.createElement('select');
                select.id = 'modal-status-edit';
                select.className = 'cyber-input';
                select.style.padding = '5px';
                select.style.fontSize = '12px';
                select.style.marginTop = '5px';

                const optActive = document.createElement('option');
                optActive.value = 'active';
                optActive.textContent = '¶–¶⁄¶‚¶ÿ¶“¶’¶›';

                const optReserved = document.createElement('option');
                optReserved.value = 'reserved';
                optReserved.textContent = '¶“ ¶‡¶’¶◊¶’¶‡¶“¶’';

                const optSold = document.createElement('option');
                optSold.value = 'sold';
                optSold.textContent = '¶ﬂ¶‡¶ﬁ¶‘¶–¶›¶ﬁ';

                select.appendChild(optActive);
                select.appendChild(optReserved);
                select.appendChild(optSold);

                select.value = item.status || 'active';

                select.onchange = async (e) => {
                    try {
                        await apiRequest(`/market/${item.id}/status`, 'PATCH', { status: e.target.value });
                        addLog('¶·T¬¶-T¬T√T¡ ¶¨¶-T¬¶- ¶-¶-¶-¶-¶-¶¨¶¶¶-', 'success');
                        loadMarket(); // Refresh list in background
                    } catch (err) {
                        addLog('¶ﬁT»¶¨¶-¶¶¶- ¶¨T¿¶¨ ¶-¶-¶-¶-¶-¶¨¶¶¶-¶¨¶¨ T¡T¬¶-T¬T√T¡¶-', 'error');
                        // Revert selection on error
                        select.value = item.status || 'active';
                    }
                };

                statusContainer.innerHTML = '¶·T¬¶-T¬T√T¡: ';
                statusContainer.appendChild(select);
            } else {
                let statusText = '¶–¶⁄¶‚¶ÿ¶“¶’¶›';
                if (item.status === 'sold') statusText = '¶ﬂ¶‡¶ﬁ¶‘¶–¶›¶ﬁ';
                if (item.status === 'reserved') statusText = '¶“ ¶‡¶’¶◊¶’¶‡¶“¶’';
                statusContainer.textContent = `¶·T¬¶-T¬T√T¡: ${statusText}`;
            }

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
                gallery.innerHTML = '<div style="color: var(--text-dim); font-style: italic;">¶›¶¶T¬ Tƒ¶-T¬¶-¶¶T¿¶-Tƒ¶¨¶¶</div>';
            }

            document.getElementById('listing-detail-message-btn').onclick = () => {
                document.getElementById('listing-detail-modal').style.display = 'none';
                startPrivateChat(item.seller_id);
            };

            const favBtn = document.getElementById('listing-detail-fav-btn');
            favBtn.textContent = item.is_favorite ? '¶„¶—¶‡¶–¶‚¶Ï ¶ÿ¶◊ ¶ÿ¶◊¶—¶‡¶–¶›¶›¶ﬁ¶”¶ﬁ' : 'Ú›‰ˇ¨œ ¶“ ¶ÿ¶◊¶—¶‡¶–¶›¶›¶ﬁ¶’';
            favBtn.onclick = async (e) => {
                await window.toggleFavorite(e, item.id);
                favBtn.textContent = favBtn.classList.contains('favorited') ? '¶„¶—¶‡¶–¶‚¶Ï ¶ÿ¶◊ ¶ÿ¶◊¶—¶‡¶–¶›¶›¶ﬁ¶”¶ﬁ' : 'Ú›‰ˇ¨œ ¶“ ¶ÿ¶◊¶—¶‡¶–¶›¶›¶ﬁ¶’';
            };

            document.getElementById('listing-detail-modal').style.display = 'flex';
        } catch(e) {
            addLog('¶›¶¶ T√¶+¶-¶¨¶-T¡TÃ ¶¨¶-¶¶T¿T√¶¨¶¨T¬TÃ ¶+¶¶T¬¶-¶¨¶¨ ¶¨¶-T¬¶-', 'error');
        }
    }

    // @ts-ignore
    window.deleteMarketListing = async function(itemId) {
        if (!confirm('¶ﬂ¶-¶+T¬¶-¶¶T¿¶¶¶+¶-¶¶T¬¶¶ T√¶+¶-¶¨¶¶¶-¶¨¶¶ ¶¨¶-T¬¶-?')) return;
        try {
            await apiRequest(`/market/${itemId}`, 'DELETE');
            addLog('¶€¶-T¬ T¡¶-TœT¬ T¡ ¶-¶¨T¿¶¶¶¨', 'success');
            loadMarket();
        } catch(e) {
            addLog('¶ﬁT»¶¨¶-¶¶¶- ¶¨T¿¶¨ T√¶+¶-¶¨¶¶¶-¶¨¶¨ ¶¨¶-T¬¶-', 'error');
        }
    }

    window.loadWikiArticle = async function(artId) {
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            alert(`--- ¶”¶ÿ¶ﬂ¶’¶‡¶‚¶’¶⁄¶·¶‚¶ﬁ¶“¶–¶Ô ¶—¶–¶◊¶– --- \n\n${art.title.toUpperCase()}\n\n${art.content}`);
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
            addLog(`¶◊¶-¶¶T¿T√¶¶¶¶¶-¶- ${urls.length} Tƒ¶-T¬¶-`, 'success');
        } catch (e) {
            addLog(`¶ﬁT»¶¨¶-¶¶¶- ¶¨¶-¶¶T¿T√¶¨¶¶¶¨ Tƒ¶-T¬¶-: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
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
            delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
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
        const category = catElem?.value || '¶‡¶-¶¨¶-¶-¶¶';
        // @ts-ignore
        const location = locElem?.value || '¶“T¡Tœ T¡¶¶T¬TÃ';
        
        if (!title || !price) { addLog('Validation Error: ¶◊¶-¶¨¶-¶¨¶-¶¨T¬¶¶ ¶-¶-¶¨¶-¶-¶-¶¨¶¶ ¶¨ T∆¶¶¶-T√', 'error'); return; }
        
        try {
            await apiRequest('/market', 'POST', {
                title,
                price,
                description,
                category,
                location,
                images: uploadedImageUrls
            });
            addLog('¶€¶-T¬ T√T¡¶¨¶¶T»¶-¶- ¶-¶¨T√¶-¶¨¶¨¶¶¶-¶-¶-¶-', 'success');
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
                chatBtn.textContent = '¶·¶’¶⁄¶‡¶’¶‚¶›¶Î¶Ÿ ¶Á¶–¶‚';
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
            addLog('¶›¶¶¶¨TÃ¶¨Tœ ¶-T¬¶¶T¿TÀT¬TÃ T«¶-T¬ T¡ T¡¶-¶-¶¨¶- T¡¶-¶-¶-¶¶', 'error');
            return;
        }
        try {
            addLog('¶ﬁT¬¶¶T¿TÀ¶-¶-TŒ ¶¨¶-T…¶¨T…T—¶-¶-TÀ¶¶ ¶¶¶-¶-¶-¶¨ T¡¶-Tœ¶¨¶¨...', 'info');
            // Use the dedicated /chat/private endpoint (get-or-create, no duplicates)
            const room = await apiRequest('/chat/private', 'POST', {
                target_user_id: targetId
            });
            switchView('messages');
            // Refresh room list and then select the new/existing room
            await loadChatRooms();
            const roomInList = state.chat.rooms.find(r => r.id === room.id);
            const roomName = roomInList ? roomInList.name : '¶ﬂT¿¶¨¶-¶-T¬¶-TÀ¶¶ T«¶-T¬';
            const roomType = roomInList ? roomInList.type : 'private';
            selectChatRoom(room.id, roomName, roomType, targetId);
            addLog('E2EE-¶⁄¶-¶-¶-¶¨ T√T¡T¬¶-¶-¶-¶-¶¨¶¶¶-', 'success');
        } catch (e) {
            addLog('¶›¶¶ T√¶+¶-¶¨¶-T¡TÃ T√T¡T¬¶-¶-¶-¶-¶¨T¬TÃ T¡¶-¶¶¶+¶¨¶-¶¶¶-¶¨¶¶', 'error');
            console.error('startPrivateChat error:', e);
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
                container.innerHTML = '<div class="system-msg">¶›¶¶T¬ ¶-¶¶T¬¶¨¶-¶-TÀT≈ T¡¶-¶-TÀT¬¶¨¶¶.</div>';
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
                p.textContent = `®ﬂ”Õ ${e.location || '¶·¶¶¶¶T¿¶¶T¬¶-¶-Tœ ¶¨¶-¶¶¶-T∆¶¨Tœ'}`;

                contentDiv.appendChild(h4);
                contentDiv.appendChild(p);

                const actionDiv = document.createElement('div');
                actionDiv.className = 'event-action';
                actionDiv.textContent = '> ¶‘¶’¶‚¶–¶€¶ÿ';

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
        
        if (!title) { addLog('Validation Error: ¶„¶¶¶-¶¶¶¨T¬¶¶ ¶-¶-¶¨¶-¶-¶-¶¨¶¶', 'error'); return; }
        
        try {
            await apiRequest('/events', 'POST', { title, event_date, location, description });
            addLog('¶·¶-¶-TÀT¬¶¨¶¶ ¶-¶-¶-¶-T¡¶¨T¿¶-¶-¶-¶-¶-', 'success');
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
            ¶Ê¶’¶€¶Ï: ${event.title}
            ¶‘¶–¶‚¶–: ${new Date(event.event_date).toLocaleString()}
            ¶€¶ﬁ¶⁄¶–¶Ê¶ÿ¶Ô: ${event.location}
            ¶ﬁ¶ﬂ¶ÿ¶·¶–¶›¶ÿ¶’: ${event.description || '¶‘¶-¶-¶-TÀ¶¶ ¶¨¶-T¡¶¶¶¶T¿¶¶T«¶¶¶-TÀ'}
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
        
        if (sidebarName) sidebarName.textContent = `¶ﬁ¶¨¶¶T¿¶-T¬¶-T¿: ${data.display_name || data.username}`;
        if (sidebarRank) sidebarRank.textContent = data.rank;
        if (sidebarAvatar && data.avatar_url) {
            applyAvatarDisplay(sidebarAvatar, data.avatar_url);
        }
    }

    // --- ¶‘¶’¶Ÿ¶·¶‚¶“¶ÿ¶Ô: ¶€¶ÿ¶Á¶›¶Î¶Ÿ ¶⁄¶–¶—¶ÿ¶›¶’¶‚ ---
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
                addLog('¶€¶¨T«¶-¶-¶¶ ¶+¶¶¶¨¶- T√T¡¶¨¶¶T»¶-¶- ¶-¶-¶-¶-¶-¶¨¶¶¶-¶- Ú‹≈', 'success');
                loadDashboard(); // Refresh everything
            }
        } catch (e) {
            console.error('Profile update error:', e);
            addLog('¶›¶¶ T√¶+¶-¶¨¶-T¡TÃ ¶-¶-¶-¶-¶-¶¨T¬TÃ ¶¨T¿¶-Tƒ¶¨¶¨TÃ (¶-¶-¶¨¶-¶-¶¶¶-¶-, ¶¨¶-¶¨TÀ¶-¶-¶-¶¶ ¶¨¶-¶-TœT¬)', 'error');
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
            
            addLog('¶–¶-¶-T¬¶-T¿ ¶-¶-¶-¶-¶-¶¨¶¶¶-: ¶⁄¶-¶-¶-¶¨ T¡¶-Tœ¶¨¶¨ ¶-¶¶T¬¶¨¶-¶¶¶- Ú‹≈', 'success');
            window.closeAvatarModal();
            loadDashboard(); // Refresh UI
        } catch (e) {
            addLog('¶ﬁT»¶¨¶-¶¶¶- T¡¶¨¶-T≈T¿¶-¶-¶¨¶¨¶-T∆¶¨¶¨ ¶¶¶-¶-¶-¶¨¶- ¶-¶-¶-T¬¶-T¿¶-', 'error');
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
                        msg.content = "[ ¶‘¶–¶›¶›¶Î¶’ ¶◊¶–¶Ë¶ÿ¶‰¶‡¶ﬁ¶“¶–¶›¶Î // ¶⁄¶€¶Ó¶Á ¶›¶’ ¶›¶–¶Ÿ¶‘¶’¶› ]";
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
                        if (mheader) mheader.insertAdjacentHTML('beforeend', '<span class="is-edited">(¶¨¶¨¶-¶¶¶-¶¶¶-¶-)</span>');
                    }
                }
            } else if (data.type === 'delete_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) el.remove();
            } else if (data.type === 'typing_status') {
                if (state.chat.currentRoomId === data.room_id && data.sender_id !== state.user.id) {
                    const typingEl = document.getElementById('typing-indicator');
                    if (typingEl) {
                        typingEl.textContent = `${data.sender} ¶¨¶¶T«¶-T¬¶-¶¶T¬...`;
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
            renderChatRooms();
        } catch (e) { addLog('Failed to load chat channels', 'error'); }
    }

    function renderChatRooms() {
        const list = document.getElementById('chat-rooms-list');
        if (!list) return;
        list.innerHTML = '';
        
        let roomsToRender = state.chat.rooms || [];
        if (state.chat.currentFolderId !== 'all') {
            const folder = state.chat.folders.find(f => f.id == state.chat.currentFolderId);
            if (folder && folder.rooms) {
                roomsToRender = roomsToRender.filter(r => folder.rooms.includes(r.id));
            }
        }

        // @ts-ignore
        roomsToRender.forEach(room => {
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
            lastMsgDiv.textContent = room.last_message || '¶›¶¶T¬ T¡¶-¶-¶-T…¶¶¶-¶¨¶¶';

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(lastMsgDiv);

            const statusSpan = document.createElement('span');
            statusSpan.className = `status-dot ${room.is_online ? 'online' : ''}`;
            statusSpan.style.display = 'none';

            // Delete/Leave button (visible on hover)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'room-delete-btn';
            deleteBtn.innerHTML = 'Ú‹’';
            deleteBtn.title = room.type === 'private' ? '¶„¶+¶-¶¨¶¨T¬TÃ T«¶-T¬' : '¶ﬂ¶-¶¶¶¨¶-T√T¬TÃ / T√¶+¶-¶¨¶¨T¬TÃ';
            deleteBtn.style.cssText = `
                display: none; position: absolute; right: 6px; top: 50%;
                transform: translateY(-50%);
                background: rgba(255,50,50,0.15); border: 1px solid rgba(255,50,50,0.4);
                color: #ff5555; border-radius: 50%; width: 22px; height: 22px;
                font-size: 11px; cursor: pointer; line-height: 1;
                transition: background 0.2s;
            `;
            deleteBtn.onmouseenter = () => deleteBtn.style.background = 'rgba(255,50,50,0.4)';
            deleteBtn.onmouseleave = () => deleteBtn.style.background = 'rgba(255,50,50,0.15)';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const label = room.type === 'private' ? 'T√¶+¶-¶¨¶¨T¬TÃ TÕT¬¶-T¬ ¶¨T¿¶¨¶-¶-T¬¶-TÀ¶¶ T«¶-T¬' : '¶¨¶-¶¶¶¨¶-T√T¬TÃ/T√¶+¶-¶¨¶¨T¬TÃ TÕT¬T√ ¶¶¶-¶-¶-¶-T¬T√';
                if (!confirm(`¶“TÀ T√¶-¶¶T¿¶¶¶-TÀ, T«T¬¶- T≈¶-T¬¶¨T¬¶¶ ${label}? ¶ÌT¬¶- ¶+¶¶¶¶T¡T¬¶-¶¨¶¶ ¶-¶¶¶-¶-T¿¶-T¬¶¨¶-¶-.`)) return;
                try {
                    await apiRequest(`/chat/rooms/${room.id}`, 'DELETE');
                    // Remove from state and re-render
                    state.chat.rooms = state.chat.rooms.filter(r => r.id !== room.id);
                    if (state.chat.currentRoomId === room.id) {
                        state.chat.currentRoomId = null;
                        const chatMain = document.querySelector('.chat-main');
                        if (chatMain) chatMain.classList.remove('active');
                    }
                    renderChatRooms();
                    addLog(`Ú‹≈ ¶Á¶-T¬ T√¶+¶-¶¨T—¶-`, 'success');
                } catch (err) {
                    addLog(`Ú›Ã ¶ﬁT»¶¨¶-¶¶¶-: ${err.message}`, 'error');
                }
            };
            div.style.position = 'relative';
            div.onmouseenter = () => { deleteBtn.style.display = 'block'; };
            div.onmouseleave = () => { deleteBtn.style.display = 'none'; };

            div.appendChild(avatarDiv);
            div.appendChild(infoDiv);
            div.appendChild(statusSpan);
            div.appendChild(deleteBtn);
            div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role);
            list.appendChild(div);
        });

    }

    // --- FOLDERS LOGIC ---
    window.openFolderModal = function() {
        const input = document.getElementById('folder-name-input');
        if(input) input.value = '';
        const container = document.getElementById('folder-rooms-selection');
        if (container) {
            container.innerHTML = '';
            if (!state.chat.rooms || state.chat.rooms.length === 0) {
               container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-dim)">¶›¶¶T¬ ¶+¶-T¡T¬T√¶¨¶-TÀT≈ T«¶-T¬¶-¶-</div>';
            } else {
                state.chat.rooms.forEach(room => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.alignItems = 'center';
                    div.style.gap = '10px';
                    div.style.padding = '8px';
                    div.style.borderBottom = '1px solid var(--border-metal)';
                    
                    div.innerHTML = `<input type="checkbox" id="folder-room-${room.id}" value="${room.id}" style="width:16px; height:16px; cursor:pointer;">
                        <label for="folder-room-${room.id}" style="color:var(--text-main); cursor:pointer;">${room.name}</label>`;
                    container.appendChild(div);
                });
            }
        }
        document.getElementById('folder-modal').style.display = 'flex';
    };

    window.submitFolderCreate = async function() {
        const name = document.getElementById('folder-name-input').value.trim();
        if (!name) return addLog('¶“¶-¶¶¶+¶¨T¬¶¶ ¶¨¶-Tœ ¶¨¶-¶¨¶¶¶¨', 'error');
        
        const checkboxes = document.querySelectorAll('#folder-rooms-selection input[type="checkbox"]:checked');
        const roomIds = Array.from(checkboxes).map(c => parseInt(c.value));
        
        try {
            const resp = await apiRequest('/chat/folders', 'POST', { name: name, rooms: roomIds });
            addLog('¶ﬂ¶-¶¨¶¶¶- ' + name + ' T¡¶-¶¨¶+¶-¶-¶-', 'success');
            document.getElementById('folder-modal').style.display = 'none';
            await loadFolders();
        } catch(e) {
            addLog('¶ﬁT»¶¨¶-¶¶¶- T¡¶-¶¨¶+¶-¶-¶¨Tœ ¶¨¶-¶¨¶¶¶¨', 'error');
        }
    };

    window.loadFolders = async function() {
        try {
            state.chat.folders = await apiRequest('/chat/folders');
            renderFoldersTabs();
        } catch(e) {
            console.error('Failed to load folders:', e);
        }
    }

    function renderFoldersTabs() {
        const tabsContainer = document.getElementById('chat-folders-tabs');
        if (!tabsContainer) return;
        
        tabsContainer.innerHTML = '';
        
        const allTab = document.createElement('div');
        allTab.className = 'folder-tab' + (state.chat.currentFolderId === 'all' ? ' active' : '');
        allTab.setAttribute('onclick', "window.selectFolder('all', this)");
        allTab.innerText = '¶“T¡¶¶ T«¶-T¬TÀ';
        tabsContainer.appendChild(allTab);
        
        (state.chat.folders || []).forEach(folder => {
             const fTab = document.createElement('div');
             fTab.className = 'folder-tab' + (state.chat.currentFolderId == folder.id ? ' active' : '');
             fTab.setAttribute('onclick', "window.selectFolder(" + folder.id + ", this)");
             fTab.innerText = folder.name;
             tabsContainer.appendChild(fTab);
        });
        
        const addBtn = document.createElement('button');
        addBtn.className = 'add-folder-btn';
        addBtn.setAttribute('onclick', "window.openFolderModal()");
        addBtn.title = "¶·¶-¶¨¶+¶-T¬TÃ ¶¨¶-¶¨¶¶T√";
        addBtn.innerText = "+";
        tabsContainer.appendChild(addBtn);
        
        renderChatRooms();
    }

    window.selectFolder = function(folderId, element) {
        state.chat.currentFolderId = folderId;
        const tabs = document.querySelectorAll('#chat-folders-tabs .folder-tab');
        tabs.forEach(t => t.classList.remove('active'));
        if (element) element.classList.add('active');
        renderChatRooms();
    };

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
        state.chat.currentMyRole = myRole || 'member';
        state.chat.currentRoomType = type || 'private';

        // Push a history entry so the Back button closes the chat panel
        // instead of exiting the PWA / navigating away
        history.pushState({ skufia: true, view: 'messages', chat: true, roomId }, '', `#chat-${roomId}`);

        const header = document.getElementById('chat-header');
        const chatHistoryEl = document.getElementById('chat-history');
        const inputArea = document.querySelector('.chat-input-area');

        
        if (inputArea) {
            if (type === 'channel' && myRole !== 'admin') {
                inputArea.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim); font-style:italic; background:var(--bg-black); border-top:1px solid #333; width:100%;">¶‚¶-¶¨TÃ¶¶¶- ¶-¶+¶-¶¨¶-¶¨T¡T¬T¿¶-T¬¶-T¿TÀ ¶-¶-¶¶T√T¬ ¶¨¶¨T¡¶-T¬TÃ ¶- TÕT¬¶-T¬ ¶¶¶-¶-¶-¶¨</div>`;
            } else {
                inputArea.innerHTML = `
                    <div class="chat-capsule" style="width: 100%; box-sizing: border-box;">
                        <button class="capsule-btn" title="¶ﬂT¿¶¨¶¶T¿¶¶¶¨¶¨T¬TÃ" onclick="document.getElementById('file-input').click()">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </button>
                        <input type="file" id="file-input" style="display:none" onchange="uploadFileAndSend()">
                        <textarea id="chat-input" rows="1" placeholder="¶·¶-¶-¶-T…¶¶¶-¶¨¶¶..." oninput="this.style.height = ''; this.style.height = Math.min(this.scrollHeight, 120) + 'px';" onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.sendChatMessage(); }"></textarea>
                        
                        <div class="action-buttons" style="display: flex; align-items: flex-end; gap: 4px;">
                            <button class="capsule-btn" title="¶·¶-¶-¶¶¶¨TÀ">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                            </button>
                            <button class="capsule-btn" title="¶”¶-¶¨¶-T¡¶-¶-¶-¶¶">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                            </button>
                            <button class="send-circle-btn" onclick="window.sendChatMessage()">
                                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                            </button>
                        </div>
                    </div>
                `;
                const draft = localStorage.getItem(`skuf_draft_${roomId}`);
                const cInput = document.getElementById('chat-input');
                if (cInput && draft) {
                    cInput.value = draft;
                }
            }
        }
        
        if (header) {
            const headerAvatar = document.getElementById('header-avatar');
            const headerTitle = document.getElementById('chat-header-title');
            
            if (headerAvatar) {
                headerAvatar.innerHTML = `<img src="https://api.dicebear.com/7.x/identicon/svg?seed=${roomName}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                headerAvatar.style.background = 'transparent';
                headerAvatar.style.color = 'transparent';
            }
            if (headerTitle) {
                headerTitle.textContent = roomName.toUpperCase();
            }

            const headerStatus = document.getElementById('chat-header-status');
            const statusDot = header.querySelector('.status-dot');
            if (headerStatus) headerStatus.textContent = ''; 
            if (statusDot) statusDot.style.display = 'none';

            let badgeDiv = document.getElementById('chat-encryption-status');
            if (!badgeDiv) {
                badgeDiv = document.createElement('div');
                badgeDiv.className = 'encryption-badge';
                badgeDiv.id = 'chat-encryption-status';
                const span = document.createElement('span');
                badgeDiv.appendChild(span);
                const profile = header.querySelector('.chat-header-profile');
                if (profile) profile.appendChild(badgeDiv);
            }
            badgeDiv.innerHTML = '<span></span>';
        }

        // --- E2EE v2: Use centralized key management ---
        if (type === 'private' && receiverId) {
            const badge = document.getElementById('chat-encryption-status');
            try {
                await ensureKeys();
                const sessionKey = await getOrEstablishSessionKey(roomId, receiverId);
                if (sessionKey) {
                    const myFp = state.chat.keyFingerprint || '';
                    if (badge) {
                        badge.innerHTML = `®ﬂ‘“ E2EE ACTIVE`;
                        badge.title = `¶‚¶-¶-¶¶ ¶-T¬¶¨¶¶T«¶-T¬¶-¶¶: ${myFp.slice(0, 23)}...`;
                        badge.style.color = '#0f0';
                        badge.style.background = 'rgba(0, 255, 65, 0.1)';
                        badge.style.cursor = 'pointer';
                        badge.onclick = () => {
                            const fp = state.chat.keyFingerprint || '¶-/¶+';
                            alert(`®ﬂ‘— ¶‚¶-¶-¶¶ ¶-T¬¶¨¶¶T«¶-T¬¶-¶¶ ¶¶¶¨TŒT«¶-:\n${fp}\n\n¶ﬂ¶-¶¨T¿¶-T¡¶¨ T¡¶-¶-¶¶T¡¶¶¶+¶-¶¨¶¶¶- ¶¨T¿¶-T«¶¨T¬¶-T¬TÃ T¬¶¶¶-¶¶ T¡¶-¶-¶¶ ¶-T¬¶¨¶¶T«¶-T¬¶-¶¶ ¶-T¡¶¨T√T≈ Ú¿‘ ¶-¶-¶¨ ¶+¶-¶¨¶¶¶-TÀ T¡¶-¶-¶¨¶-¶+¶-T¬TÃ. ¶’T¡¶¨¶¨ ¶-¶¶T¬ Ú¿‘ ¶-¶-¶¨¶-¶-¶¶¶-¶- ¶-T¬¶-¶¶¶- MITM.`);
                        };
                    }
                } else {
                    if (badge) {
                        badge.innerHTML = 'Ú⁄‡ˇ¨œ E2EE ¶-¶¶¶+¶-T¡T¬T√¶¨¶¶¶-';
                        badge.style.color = '#ffaa00';
                        badge.style.background = 'rgba(255,170,0,0.1)';
                    }
                }
            } catch (e) {
                console.warn('E2EE init error:', e);
                if (badge) {
                    badge.innerHTML = 'Ú⁄‡ˇ¨œ ¶ﬁT»¶¨¶-¶¶¶- E2EE';
                    badge.style.color = '#f00';
                }
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

        // Show/hide group management buttons in dropdown
        const isGroupOrChannel = ['group', 'channel'].includes(type);
        const isAdminOrOwner = ['owner', 'admin'].includes(myRole);
        const btnAddMember = document.getElementById('btn-add-member');
        const btnGroupSettings = document.getElementById('btn-group-settings');
        if (btnAddMember) btnAddMember.style.display = (isGroupOrChannel && isAdminOrOwner) ? 'block' : 'none';
        if (btnGroupSettings) btnGroupSettings.style.display = isGroupOrChannel ? 'block' : 'none';

        
        const chatLayout = document.querySelector('.chat-layout');
        if (chatLayout) chatLayout.classList.add('chat-open');

        if (chatHistoryEl) {
            chatHistoryEl.innerHTML = '<div class="chat-placeholder">Loading buffer...</div>';
            try {
                const response = await apiRequest(`/chat/rooms/${roomId}/history?limit=50`);
                chatHistoryEl.innerHTML = '';
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
                        } catch(e) { m.text = "[ ¶◊¶–¶Ë¶ÿ¶‰¶‡¶ﬁ¶“¶–¶›¶ﬁ ]"; }
                    }
                    renderChatMessage(m);
                }
                chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
            } catch (e) { chatHistoryEl.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }

        }
    }

    
