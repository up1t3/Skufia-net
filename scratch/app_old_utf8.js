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
        filters: { q: '', cat: '╨Т╤Б╨╡', loc: '╨Т╨╡╨╖╨┤╨╡', sort: 'newest', min: null, max: null }
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
    // SECURE CRYPTO ENGINE v2 тАФ Signal-inspired E2EE
    // =========================================================================
    // Security properties:
    // тЬЕ RSA private key: non-extractable, persisted in IndexedDB only
    // тЬЕ AES session keys: non-extractable, cached per-room in IndexedDB
    // тЬЕ Key fingerprint: SHA-256 of public key bytes, displayed to user
    // тЬЕ Per-room AES-256-GCM keys тАФ no universal key
    // тЬЕ Private key NEVER sent to server
    // тЬЕ Server stores only: public keys + RSA-wrapped AES bundles
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

        // тФАтФА RSA Key Pair тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

        /**
         * Generate RSA-OAEP 4096-bit key pair.
         * Private key is NON-EXTRACTABLE тАФ cannot be exported by any JS code.
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
                false,                            // тЖР extractable: FALSE (private key protected!)
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

        // тФАтФА AES Session Key тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

        /**
         * Generate a fresh AES-256-GCM key for a chat session.
         * NON-EXTRACTABLE тАФ key bytes never leave the browser's crypto engine.
         * @returns {Promise<CryptoKey>}
         */
        static async generateSessionKey() {
            return await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                false,              // тЖР non-extractable!
                ['encrypt', 'decrypt']
            );
        }

        // тФАтФА Key Wrapping (RSA-OAEP wraps AES) тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

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
                false,              // тЖР result is also non-extractable
                ['encrypt', 'decrypt']
            );
        }

        // тФАтФА Message Encryption / Decryption тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

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

    // тФАтФА Key Vault: persist identity + session keys in IndexedDB тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

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
                addLog('ЁЯФР ╨Ч╨░╨│╤А╤Г╨╖╨║╨░ ╨║╨╗╤О╤З╨╡╨╣ ╨╕╨╖ ╨╖╨░╤Й╨╕╤Й╤С╨╜╨╜╨╛╨│╨╛ ╤Е╤А╨░╨╜╨╕╨╗╨╕╤Й╨░...', 'info');
                state.chat.keys.publicKey = await CryptoManager.importPublicKey(storedPub);
                state.chat.keys.privateKey = storedPriv; // already a CryptoKey
                // Always re-register pubKey in case server restarted
                await apiRequest('/me/key', 'POST', { public_key: storedPub }).catch(() => {});
                const fp = await CryptoManager.keyFingerprint(storedPub);
                state.chat.keyFingerprint = fp;
                addLog(`ЁЯФС ╨Ъ╨╗╤О╤З╨╕ ╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╤Л | ╨Ю╤В╨┐╨╡╤З╨░╤В╨╛╨║: ${fp.slice(0, 23)}...`, 'success');
                // Clear old insecure localStorage keys if present
                localStorage.removeItem('skufia_pub_spki');
                localStorage.removeItem('skufia_priv_pkcs8');
                return;
            }
        } catch (e) {
            addLog('тЪая╕П ╨Ю╤И╨╕╨▒╨║╨░ ╤З╤В╨╡╨╜╨╕╤П ╤Е╤А╨░╨╜╨╕╨╗╨╕╤Й╨░, ╨│╨╡╨╜╨╡╤А╨╕╤А╤Г╨╡╨╝ ╨╜╨╛╨▓╤Л╨╡ ╨║╨╗╤О╤З╨╕...', 'info');
            await vaultDelete(IDB_STORE_KEYS, 'pub_base64');
            await vaultDelete(IDB_STORE_KEYS, 'priv_cryptokey');
        }

        // Generate fresh RSA-4096 identity key pair
        addLog('тЪЩя╕П ╨У╨╡╨╜╨╡╤А╨░╤Ж╨╕╤П RSA-4096 ╨║╨╗╤О╤З╨╡╨▓╨╛╨╣ ╨┐╨░╤А╤Л...', 'info');
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
        addLog(`тЬЕ E2EE ╨║╨╗╤О╤З╨╕ ╤Б╨╛╨╖╨┤╨░╨╜╤Л ╨╕ ╨╖╨░╤Й╨╕╤Й╨╡╨╜╤Л | ╨Ю╤В╨┐╨╡╤З╨░╤В╨╛╨║: ${fp.slice(0, 23)}...`, 'success');
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
                addLog(`ЁЯФУ ╨б╨╡╤Б╤Б╨╕╨╛╨╜╨╜╤Л╨╣ ╨║╨╗╤О╤З ╨▓╨╛╤Б╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜ ╨┤╨╗╤П ╨║╨╛╨╝╨╜╨░╤В╤Л #${roomId}`, 'success');
                return sessionKey;
            }
        } catch (e) {
            // 404 = no key yet тАФ we are the initiator
        }

        // 4. Generate new session key and distribute to both parties
        if (!receiverId) return null;

        addLog(`ЁЯФС ╨г╤Б╤В╨░╨╜╨╛╨▓╨║╨░ E2EE ╤Б╨╡╤Б╤Б╨╕╨╕ ╤Б ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╨╡╨╝ #${receiverId}...`, 'info');

        // Fetch recipient's public key
        const targetKeyData = await apiRequest(`/users/${receiverId}/key`).catch(() => null);
        if (!targetKeyData || !targetKeyData.public_key) {
            addLog('тЪая╕П ╨Я╨╛╨╗╤Г╤З╨░╤В╨╡╨╗╤М ╨╡╤Й╤С ╨╜╨╡ ╨╖╨░╤А╨╡╨│╨╕╤Б╤В╤А╨╕╤А╨╛╨▓╨░╨╗ ╨║╨╗╤О╤З╨╕ E2EE', 'error');
            return null;
        }

        // Show fingerprint of recipient's key for MITM detection
        const recipientFp = await CryptoManager.keyFingerprint(targetKeyData.public_key);
        addLog(`ЁЯФН ╨Ю╤В╨┐╨╡╤З╨░╤В╨╛╨║ ╨║╨╗╤О╤З╨░ ╨┐╨╛╨╗╤Г╤З╨░╤В╨╡╨╗╤П: ${recipientFp.slice(0, 23)}...`, 'info');

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

        // Store both bundles on server (server cannot decrypt тАФ only wrapped blobs)
        const keysPayload = {};
        keysPayload[String(receiverId)] = wrappedForRecipient;
        keysPayload[String(state.user.id)] = wrappedForSelf;
        await apiRequest(`/chat/rooms/${roomId}/key`, 'POST', { keys: keysPayload });

        // Cache in IndexedDB
        await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});

        addLog(`тЬЕ E2EE ╤Б╨╡╤Б╤Б╨╕╤П ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜╨░ | ╨Ю╤В╨┐╨╡╤З╨░╤В╨╛╨║: ${recipientFp.slice(0, 11)}...`, 'success');
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
            backLink.textContent = '<< ╨Т╨╡╤А╨╜╤Г╤В╤М╤Б╤П ╨║ ╤Б╨┐╨╕╤Б╨║╤Г';
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
                metaDiv.textContent = `by ${post.author} | ЁЯСН `;

                const likesSpan = document.createElement('span');
                likesSpan.id = `likes-${post.id}`;
                likesSpan.textContent = post.likes;

                const btn = document.createElement('button');
                btn.className = 'small-btn';
                btn.textContent = '╨Я╨╛╨┤╨┤╨╡╤А╨╢╨░╤В╤М';
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
                container.innerHTML = '<div class="system-msg">LIBRARY_EMPTY: ╨Я╨╛╨╕╤Б╨║ ╨┤╨░╨╜╨╜╤Л╤Е ╨╜╨╡ ╨┤╨░╨╗ ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В╨╛╨▓.</div>';
                return;
            }
            articles.forEach(art => {
                const div = document.createElement('div');
                div.className = 'wiki-card';
                const h3 = document.createElement('h3');
                h3.textContent = art.title;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = 'ЁЯСН ';

                const likesSpan = document.createElement('span');
                likesSpan.id = `wiki-likes-${art.id}`;
                likesSpan.textContent = art.likes || 0;

                const likeBtn = document.createElement('button');
                likeBtn.className = 'small-btn';
                likeBtn.textContent = '╨Ю╨┤╨╛╨▒╤А╨╕╤В╤М';
                likeBtn.onclick = () => likeWiki(art.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(likeBtn);

                const p = document.createElement('p');
                p.className = 'wiki-excerpt';
                p.textContent = art.content ? art.content.substring(0, 150) + '...' : '╨Ъ╨╛╨╜╤В╨╡╨╜╤В ╨╖╨░╤Б╨╡╨║╤А╨╡╤З╨╡╨╜';

                const openBtn = document.createElement('button');
                openBtn.className = 'cyber-btn-small';
                openBtn.textContent = '╨Ю╨в╨Ъ╨а╨л╨в╨м ╨Ф╨Р╨Э╨Э╨л╨Х';
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
            if (window.marketState.filters.cat && window.marketState.filters.cat !== '╨Т╤Б╨╡') {
                params.append('category', window.marketState.filters.cat);
            }
            if (window.marketState.filters.loc && window.marketState.filters.loc !== '╨Т╨╡╨╖╨┤╨╡') {
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
                container.innerHTML = '<div class="system-msg">MARKET_EMPTY: ╨Э╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╤Л╤Е ╨╗╨╛╤В╨╛╨▓ ╨╜╨░ ╨▒╨╕╤А╨╢╨╡.</div>';
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
                    statusBadgeHtml = `<span class="status-badge sold">╨Я╨а╨Ю╨Ф╨Р╨Э╨Ю</span>`;
                } else if (item.status === 'reserved') {
                    statusBadgeHtml = `<span class="status-badge reserved">╨Т ╨а╨Х╨Ч╨Х╨а╨Т╨Х</span>`;
                } else {
                    statusBadgeHtml = `<span class="status-badge active">╨Р╨Ъ╨в╨Ш╨Т╨Х╨Э</span>`;
                }

                // Favorite Heart
                const isFav = item.is_favorite ? 'favorited' : '';
                const favHtml = `<span class="favorite-btn ${isFav}" onclick="toggleFavorite(event, ${item.id})">тЭдя╕П</span>`;

                let deleteButtonHTML = '';
                if (item.seller_id === state.user.id) {
                    deleteButtonHTML = `<button class="btn-danger" style="margin-top: 5px; font-size: 10px; width: 100%" onclick="event.stopPropagation(); deleteMarketListing(${item.id})">╨г╨Ф╨Р╨Ы╨Ш╨в╨м ╨Ы╨Ю╨в</button>`;
                }

                const imgContainer = document.createElement('div');
                imgContainer.className = 'market-card-image-container';
                imgContainer.innerHTML = coverImageHtml + statusBadgeHtml + favHtml; // Safe: no user text in these HTML strings
                const viewsDiv = document.createElement('div');
                viewsDiv.className = 'views-count';
                viewsDiv.textContent = `ЁЯСБ ${item.views_count || 0}`;
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
            container.innerHTML = '<div class="system-msg">ERROR: ╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨╕╨╜╤Е╤А╨╛╨╜╨╕╨╖╨╕╤А╨╛╨▓╨░╤В╤М ╨┤╨░╨╜╨╜╤Л╨╡ ╨▒╨╕╤А╨╢╨╕.</div>';
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
        prevBtn.textContent = '╨Э╨Р╨Ч╨Р╨Ф';
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
        pageText.textContent = `╨б╨в╨а╨Р╨Э╨Ш╨ж╨Р ${currentPage} / ${totalPages}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'cyber-btn-small';
        nextBtn.textContent = '╨Т╨Я╨Х╨а╨Х╨Ф';
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
                addLog('╨Ы╨╛╤В ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜ ╨▓ ╨╕╨╖╨▒╤А╨░╨╜╨╜╨╛╨╡', 'info');
            } else {
                target.classList.remove('favorited');
                addLog('╨Ы╨╛╤В ╤Г╨┤╨░╨╗╨╡╨╜ ╨╕╨╖ ╨╕╨╖╨▒╤А╨░╨╜╨╜╨╛╨│╨╛', 'info');
            }
        } catch (e) { console.error("Favorite toggle failed", e); }
    }

    window.openListingModal = async function(itemId) {
        try {
            const item = await apiRequest(`/market/${itemId}`);

            document.getElementById('listing-detail-title').textContent = item.title;
            document.getElementById('listing-detail-price').textContent = item.price;
            document.getElementById('listing-detail-desc').textContent = item.description || '╨Э╨╡╤В ╨╛╨┐╨╕╤Б╨░╨╜╨╕╤П.';

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
                optActive.textContent = '╨Р╨Ъ╨в╨Ш╨Т╨Х╨Э';

                const optReserved = document.createElement('option');
                optReserved.value = 'reserved';
                optReserved.textContent = '╨Т ╨а╨Х╨Ч╨Х╨а╨Т╨Х';

                const optSold = document.createElement('option');
                optSold.value = 'sold';
                optSold.textContent = '╨Я╨а╨Ю╨Ф╨Р╨Э╨Ю';

                select.appendChild(optActive);
                select.appendChild(optReserved);
                select.appendChild(optSold);

                select.value = item.status || 'active';

                select.onchange = async (e) => {
                    try {
                        await apiRequest(`/market/${item.id}/status`, 'PATCH', { status: e.target.value });
                        addLog('╨б╤В╨░╤В╤Г╤Б ╨╗╨╛╤В╨░ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜', 'success');
                        loadMarket(); // Refresh list in background
                    } catch (err) {
                        addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╤А╨╕ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╕ ╤Б╤В╨░╤В╤Г╤Б╨░', 'error');
                        // Revert selection on error
                        select.value = item.status || 'active';
                    }
                };

                statusContainer.innerHTML = '╨б╤В╨░╤В╤Г╤Б: ';
                statusContainer.appendChild(select);
            } else {
                let statusText = '╨Р╨Ъ╨в╨Ш╨Т╨Х╨Э';
                if (item.status === 'sold') statusText = '╨Я╨а╨Ю╨Ф╨Р╨Э╨Ю';
                if (item.status === 'reserved') statusText = '╨Т ╨а╨Х╨Ч╨Х╨а╨Т╨Х';
                statusContainer.textContent = `╨б╤В╨░╤В╤Г╤Б: ${statusText}`;
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
                gallery.innerHTML = '<div style="color: var(--text-dim); font-style: italic;">╨Э╨╡╤В ╤Д╨╛╤В╨╛╨│╤А╨░╤Д╨╕╨╣</div>';
            }

            document.getElementById('listing-detail-message-btn').onclick = () => {
                document.getElementById('listing-detail-modal').style.display = 'none';
                startPrivateChat(item.seller_id);
            };

            const favBtn = document.getElementById('listing-detail-fav-btn');
            favBtn.textContent = item.is_favorite ? '╨г╨С╨а╨Р╨в╨м ╨Ш╨Ч ╨Ш╨Ч╨С╨а╨Р╨Э╨Э╨Ю╨У╨Ю' : 'тЭдя╕П ╨Т ╨Ш╨Ч╨С╨а╨Р╨Э╨Э╨Ю╨Х';
            favBtn.onclick = async (e) => {
                await window.toggleFavorite(e, item.id);
                favBtn.textContent = favBtn.classList.contains('favorited') ? '╨г╨С╨а╨Р╨в╨м ╨Ш╨Ч ╨Ш╨Ч╨С╨а╨Р╨Э╨Э╨Ю╨У╨Ю' : 'тЭдя╕П ╨Т ╨Ш╨Ч╨С╨а╨Р╨Э╨Э╨Ю╨Х';
            };

            document.getElementById('listing-detail-modal').style.display = 'flex';
        } catch(e) {
            addLog('╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨┤╨╡╤В╨░╨╗╨╕ ╨╗╨╛╤В╨░', 'error');
        }
    }

    // @ts-ignore
    window.deleteMarketListing = async function(itemId) {
        if (!confirm('╨Я╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨░╨╡╤В╨╡ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╨╗╨╛╤В╨░?')) return;
        try {
            await apiRequest(`/market/${itemId}`, 'DELETE');
            addLog('╨Ы╨╛╤В ╤Б╨╜╤П╤В ╤Б ╨▒╨╕╤А╨╢╨╕', 'success');
            loadMarket();
        } catch(e) {
            addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╤А╨╕ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╕ ╨╗╨╛╤В╨░', 'error');
        }
    }

    window.loadWikiArticle = async function(artId) {
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            alert(`--- ╨У╨Ш╨Я╨Х╨а╨в╨Х╨Ъ╨б╨в╨Ю╨Т╨Р╨п ╨С╨Р╨Ч╨Р --- \n\n${art.title.toUpperCase()}\n\n${art.content}`);
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
            addLog(`╨Ч╨░╨│╤А╤Г╨╢╨╡╨╜╨╛ ${urls.length} ╤Д╨╛╤В╨╛`, 'success');
        } catch (e) {
            addLog(`╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╤Д╨╛╤В╨╛: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
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
        const category = catElem?.value || '╨а╨░╨╖╨╜╨╛╨╡';
        // @ts-ignore
        const location = locElem?.value || '╨Т╤Б╤П ╤Б╨╡╤В╤М';
        
        if (!title || !price) { addLog('Validation Error: ╨Ч╨░╨┐╨╛╨╗╨╜╨╕╤В╨╡ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡ ╨╕ ╤Ж╨╡╨╜╤Г', 'error'); return; }
        
        try {
            await apiRequest('/market', 'POST', {
                title,
                price,
                description,
                category,
                location,
                images: uploadedImageUrls
            });
            addLog('╨Ы╨╛╤В ╤Г╤Б╨┐╨╡╤И╨╜╨╛ ╨╛╨┐╤Г╨▒╨╗╨╕╨║╨╛╨▓╨░╨╜', 'success');
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
                chatBtn.textContent = '╨б╨Х╨Ъ╨а╨Х╨в╨Э╨л╨Щ ╨з╨Р╨в';
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
            addLog('╨Э╨╡╨╗╤М╨╖╤П ╨╛╤В╨║╤А╤Л╤В╤М ╤З╨░╤В ╤Б ╤Б╨░╨╝╨╕╨╝ ╤Б╨╛╨▒╨╛╨╣', 'error');
            return;
        }
        try {
            addLog('╨Ю╤В╨║╤А╤Л╨▓╨░╤О ╨╖╨░╤Й╨╕╤Й╤С╨╜╨╜╤Л╨╣ ╨║╨░╨╜╨░╨╗ ╤Б╨▓╤П╨╖╨╕...', 'info');
            // Use the dedicated /chat/private endpoint (get-or-create, no duplicates)
            const room = await apiRequest('/chat/private', 'POST', {
                target_user_id: targetId
            });
            switchView('messages');
            // Refresh room list and then select the new/existing room
            await loadChatRooms();
            const roomInList = state.chat.rooms.find(r => r.id === room.id);
            const roomName = roomInList ? roomInList.name : '╨Я╤А╨╕╨▓╨░╤В╨╜╤Л╨╣ ╤З╨░╤В';
            const roomType = roomInList ? roomInList.type : 'private';
            selectChatRoom(room.id, roomName, roomType, targetId);
            addLog('E2EE-╨Ъ╨░╨╜╨░╨╗ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜', 'success');
        } catch (e) {
            addLog('╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╕╤В╤М ╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡', 'error');
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
                container.innerHTML = '<div class="system-msg">╨Э╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╤Л╤Е ╤Б╨╛╨▒╤Л╤В╨╕╨╣.</div>';
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
                p.textContent = `ЁЯУН ${e.location || '╨б╨╡╨║╤А╨╡╤В╨╜╨░╤П ╨╗╨╛╨║╨░╤Ж╨╕╤П'}`;

                contentDiv.appendChild(h4);
                contentDiv.appendChild(p);

                const actionDiv = document.createElement('div');
                actionDiv.className = 'event-action';
                actionDiv.textContent = '> ╨Ф╨Х╨в╨Р╨Ы╨Ш';

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
        
        if (!title) { addLog('Validation Error: ╨г╨║╨░╨╢╨╕╤В╨╡ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡', 'error'); return; }
        
        try {
            await apiRequest('/events', 'POST', { title, event_date, location, description });
            addLog('╨б╨╛╨▒╤Л╤В╨╕╨╡ ╨░╨╜╨╛╨╜╤Б╨╕╤А╨╛╨▓╨░╨╜╨╛', 'success');
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
            ╨ж╨Х╨Ы╨м: ${event.title}
            ╨Ф╨Р╨в╨Р: ${new Date(event.event_date).toLocaleString()}
            ╨Ы╨Ю╨Ъ╨Р╨ж╨Ш╨п: ${event.location}
            ╨Ю╨Я╨Ш╨б╨Р╨Э╨Ш╨Х: ${event.description || '╨Ф╨░╨╜╨╜╤Л╨╡ ╨╖╨░╤Б╨╡╨║╤А╨╡╤З╨╡╨╜╤Л'}
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
        
        if (sidebarName) sidebarName.textContent = `╨Ю╨┐╨╡╤А╨░╤В╨╛╤А: ${data.display_name || data.username}`;
        if (sidebarRank) sidebarRank.textContent = data.rank;
        if (sidebarAvatar && data.avatar_url) {
            applyAvatarDisplay(sidebarAvatar, data.avatar_url);
        }
    }

    // --- ╨Ф╨Х╨Щ╨б╨в╨Т╨Ш╨п: ╨Ы╨Ш╨з╨Э╨л╨Щ ╨Ъ╨Р╨С╨Ш╨Э╨Х╨в ---
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
                addLog('╨Ы╨╕╤З╨╜╨╛╨╡ ╨┤╨╡╨╗╨╛ ╤Г╤Б╨┐╨╡╤И╨╜╨╛ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╛ тЬЕ', 'success');
                loadDashboard(); // Refresh everything
            }
        } catch (e) {
            console.error('Profile update error:', e);
            addLog('╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╛╨▒╨╜╨╛╨▓╨╕╤В╤М ╨┐╤А╨╛╤Д╨╕╨╗╤М (╨▓╨╛╨╖╨╝╨╛╨╢╨╜╨╛, ╨┐╨╛╨╖╤Л╨▓╨╜╨╛╨╣ ╨╖╨░╨╜╤П╤В)', 'error');
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
            
            addLog('╨Р╨▓╨░╤В╨░╤А ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜: ╨Ъ╨░╨╜╨░╨╗ ╤Б╨▓╤П╨╖╨╕ ╨░╨║╤В╨╕╨▓╨╡╨╜ тЬЕ', 'success');
            window.closeAvatarModal();
            loadDashboard(); // Refresh UI
        } catch (e) {
            addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╕╨╜╤Е╤А╨╛╨╜╨╕╨╖╨░╤Ж╨╕╨╕ ╨║╨░╨╜╨░╨╗╨░ ╨░╨▓╨░╤В╨░╤А╨░', 'error');
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
                        msg.content = "[ ╨Ф╨Р╨Э╨Э╨л╨Х ╨Ч╨Р╨и╨Ш╨д╨а╨Ю╨Т╨Р╨Э╨л // ╨Ъ╨Ы╨о╨з ╨Э╨Х ╨Э╨Р╨Щ╨Ф╨Х╨Э ]";
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
                        if (mheader) mheader.insertAdjacentHTML('beforeend', '<span class="is-edited">(╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╛)</span>');
                    }
                }
            } else if (data.type === 'delete_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) el.remove();
            } else if (data.type === 'typing_status') {
                if (state.chat.currentRoomId === data.room_id && data.sender_id !== state.user.id) {
                    const typingEl = document.getElementById('typing-indicator');
                    if (typingEl) {
                        typingEl.textContent = `${data.sender} ╨┐╨╡╤З╨░╤В╨░╨╡╤В...`;
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
            lastMsgDiv.textContent = room.last_message || '╨Э╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╣';

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(lastMsgDiv);

            const statusSpan = document.createElement('span');
            statusSpan.className = `status-dot ${room.is_online ? 'online' : ''}`;
            statusSpan.style.display = 'none';

            // Delete/Leave button (visible on hover)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'room-delete-btn';
            deleteBtn.innerHTML = 'тЬХ';
            deleteBtn.title = room.type === 'private' ? '╨г╨┤╨░╨╗╨╕╤В╤М ╤З╨░╤В' : '╨Я╨╛╨║╨╕╨╜╤Г╤В╤М / ╤Г╨┤╨░╨╗╨╕╤В╤М';
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
                const label = room.type === 'private' ? '╤Г╨┤╨░╨╗╨╕╤В╤М ╤Н╤В╨╛╤В ╨┐╤А╨╕╨▓╨░╤В╨╜╤Л╨╣ ╤З╨░╤В' : '╨┐╨╛╨║╨╕╨╜╤Г╤В╤М/╤Г╨┤╨░╨╗╨╕╤В╤М ╤Н╤В╤Г ╨║╨╛╨╝╨╜╨░╤В╤Г';
                if (!confirm(`╨Т╤Л ╤Г╨▓╨╡╤А╨╡╨╜╤Л, ╤З╤В╨╛ ╤Е╨╛╤В╨╕╤В╨╡ ${label}? ╨н╤В╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╨╡ ╨╜╨╡╨╛╨▒╤А╨░╤В╨╕╨╝╨╛.`)) return;
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
                    addLog(`тЬЕ ╨з╨░╤В ╤Г╨┤╨░╨╗╤С╨╜`, 'success');
                } catch (err) {
                    addLog(`тЭМ ╨Ю╤И╨╕╨▒╨║╨░: ${err.message}`, 'error');
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
               container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-dim)">╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨╜╤Л╤Е ╤З╨░╤В╨╛╨▓</div>';
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
        if (!name) return addLog('╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨╕╨╝╤П ╨┐╨░╨┐╨║╨╕', 'error');
        
        const checkboxes = document.querySelectorAll('#folder-rooms-selection input[type="checkbox"]:checked');
        const roomIds = Array.from(checkboxes).map(c => parseInt(c.value));
        
        try {
            const resp = await apiRequest('/chat/folders', 'POST', { name: name, rooms: roomIds });
            addLog('╨Я╨░╨┐╨║╨░ ' + name + ' ╤Б╨╛╨╖╨┤╨░╨╜╨░', 'success');
            document.getElementById('folder-modal').style.display = 'none';
            await loadFolders();
        } catch(e) {
            addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╨┐╨░╨┐╨║╨╕', 'error');
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
        allTab.innerText = '╨Т╤Б╨╡ ╤З╨░╤В╤Л';
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
        addBtn.title = "╨б╨╛╨╖╨┤╨░╤В╤М ╨┐╨░╨┐╨║╤Г";
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
                inputArea.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim); font-style:italic; background:var(--bg-black); border-top:1px solid #333; width:100%;">╨в╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А╤Л ╨╝╨╛╨│╤Г╤В ╨┐╨╕╤Б╨░╤В╤М ╨▓ ╤Н╤В╨╛╤В ╨║╨░╨╜╨░╨╗</div>`;
            } else {
                inputArea.innerHTML = `
                    <div class="chat-capsule" style="width: 100%; box-sizing: border-box;">
                        <button class="capsule-btn" title="╨Я╤А╨╕╨║╤А╨╡╨┐╨╕╤В╤М" onclick="document.getElementById('file-input').click()">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </button>
                        <input type="file" id="file-input" style="display:none" onchange="uploadFileAndSend()">
                        <textarea id="chat-input" rows="1" placeholder="╨б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡..." oninput="this.style.height = ''; this.style.height = Math.min(this.scrollHeight, 120) + 'px';" onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.sendChatMessage(); }"></textarea>
                        
                        <div class="action-buttons" style="display: flex; align-items: flex-end; gap: 4px;">
                            <button class="capsule-btn" title="╨б╨╝╨░╨╣╨╗╤Л">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                            </button>
                            <button class="capsule-btn" title="╨У╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨╡">
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
                        badge.innerHTML = `ЁЯФТ E2EE ACTIVE`;
                        badge.title = `╨в╨▓╨╛╨╣ ╨╛╤В╨┐╨╡╤З╨░╤В╨╛╨║: ${myFp.slice(0, 23)}...`;
                        badge.style.color = '#0f0';
                        badge.style.background = 'rgba(0, 255, 65, 0.1)';
                        badge.style.cursor = 'pointer';
                        badge.onclick = () => {
                            const fp = state.chat.keyFingerprint || '╨╜/╨┤';
                            alert(`ЁЯФС ╨в╨▓╨╛╨╣ ╨╛╤В╨┐╨╡╤З╨░╤В╨╛╨║ ╨║╨╗╤О╤З╨░:\n${fp}\n\n╨Я╨╛╨┐╤А╨╛╤Б╨╕ ╤Б╨╛╨▒╨╡╤Б╨╡╨┤╨╜╨╕╨║╨░ ╨┐╤А╨╛╤З╨╕╤В╨░╤В╤М ╤В╨╡╨▒╨╡ ╤Б╨▓╨╛╨╣ ╨╛╤В╨┐╨╡╤З╨░╤В╨╛╨║ ╨▓╤Б╨╗╤Г╤Е тАФ ╨╛╨╜╨╕ ╨┤╨╛╨╗╨╢╨╜╤Л ╤Б╨╛╨▓╨┐╨░╨┤╨░╤В╤М. ╨Х╤Б╨╗╨╕ ╨╜╨╡╤В тАФ ╨▓╨╛╨╖╨╝╨╛╨╢╨╜╨░ ╨░╤В╨░╨║╨░ MITM.`);
                        };
                    }
                } else {
                    if (badge) {
                        badge.innerHTML = 'тЪая╕П E2EE ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╡╨╜';
                        badge.style.color = '#ffaa00';
                        badge.style.background = 'rgba(255,170,0,0.1)';
                    }
                }
            } catch (e) {
                console.warn('E2EE init error:', e);
                if (badge) {
                    badge.innerHTML = 'тЪая╕П ╨Ю╤И╨╕╨▒╨║╨░ E2EE';
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
                        } catch(e) { m.text = "[ ╨Ч╨Р╨и╨Ш╨д╨а╨Ю╨Т╨Р╨Э╨Ю ]"; }
                    }
                    renderChatMessage(m);
                }
                chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
            } catch (e) { chatHistoryEl.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }

        }
    }

    /** @param {any} msg */
    function renderChatMessage(msg) {
        const history = document.getElementById('chat-history');
        if (!history) return;

        const placeholder = history.querySelector('.chat-placeholder');
        if (placeholder) placeholder.remove();

        const div = document.createElement('div');
        const isMe = msg.sender_id === state.user.id || msg.sender === state.user.username;
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
                fileHtml = `<a class="msg-file-attachment" href="${API_BASE_URL}${fileUrl}" target="_blank" download><span class="file-icon">ЁЯУБ</span> ╨б╨Ъ╨Р╨з╨Р╨в╨м: ${fname}</a>`;
            }
        }

        div.id = `msg-${msg.id}`;
        
        let replyHtml = '';
        if (msg.reply_to_id) {
            replyHtml = `<div class="reply-badge" onclick="document.getElementById('msg-${msg.reply_to_id}')?.scrollIntoView({behavior:'smooth'})">╨Ю╤В╨▓╨╡╤В ╨╜╨░ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡</div>`;
        }
        const isEditedHtml = msg.is_edited ? '<span class="is-edited">(╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╛)</span>' : '';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'msg-header';
        headerDiv.textContent = msg.sender + ' ';

        if (msg.is_secure || msg.iv) {
            const secureSpan = document.createElement('span');
            secureSpan.className = 'msg-secure-icon';
            secureSpan.textContent = 'ЁЯФТ';
            headerDiv.appendChild(secureSpan);
        }
        if (msg.is_edited) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'is-edited';
            editedSpan.textContent = '(╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╛)';
            headerDiv.appendChild(editedSpan);
        }

        const textDiv = document.createElement('div');
        textDiv.className = 'msg-text';
        textDiv.textContent = msg.text || msg.content || '';

        const footerDiv = document.createElement('div');
        footerDiv.className = 'msg-footer';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        timeSpan.innerHTML = `${timeStr} `;
        if (isMe) {
            const isRead = msg.is_read;
            const checkSvg = isRead 
                ? '<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--accent-cyan)"><path d="M7 11.5L10 14.5L17 7.5"></path><path d="M11 11.5L14 14.5L21 7.5" fill="none" stroke="currentColor"></path></svg>'
                : '<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--text-dim)"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor"></path></svg>';
            timeSpan.insertAdjacentHTML('beforeend', checkSvg);
        } else if (!msg.is_read && state.chat.socket && state.chat.socket.readyState === 1) {
            state.chat.socket.send(JSON.stringify({
                type: 'read_ack',
                room_id: state.chat.currentRoomId,
                message_id: msg.id
            }));
        }
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
            replyDiv.textContent = '╨Ю╤В╨▓╨╡╤В╨╕╤В╤М';
            replyDiv.onclick = () => setReply(msg.id, cleanText);
            menu.appendChild(replyDiv);

            if (isMe) {
                const editDiv = document.createElement('div');
                editDiv.textContent = '╨а╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╤В╤М';
                editDiv.onclick = () => setEdit(msg.id, cleanText);
                menu.appendChild(editDiv);

                const deleteDiv = document.createElement('div');
                deleteDiv.className = 'delete-ctx';
                deleteDiv.textContent = '╨г╨┤╨░╨╗╨╕╤В╤М';
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
        localStorage.removeItem(`skuf_draft_${state.chat.currentRoomId}`);

        const roomId = state.chat.currentRoomId;
        const receiverId = state.chat.currentReceiverId;

        // --- E2EE: Lazy key establishment ---
        // Try to get/establish session key (private chats only)
        let sessionKey = null;
        if (receiverId) {
            sessionKey = await getOrEstablishSessionKey(roomId, receiverId).catch(() => null);
        }

        let payload;
        if (sessionKey) {
            // Encrypt the message
            try {
                const encrypted = await CryptoManager.encryptMessage(sessionKey, content);
                payload = {
                    content: encrypted.content,
                    encryption_iv: encrypted.iv,
                    file_url: state.pendingFile ? state.pendingFile.url : null,
                    reply_to_id: state.chat.replyToId
                };
            } catch (e) {
                addLog('тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╤И╨╕╤Д╤А╨╛╨▓╨░╨╜╨╕╤П ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П', 'error');
                return;
            }
        } else {
            // No E2EE тАФ group chat or recipient hasn't registered keys
            payload = {
                content,
                encryption_iv: '',
                file_url: state.pendingFile ? state.pendingFile.url : null,
                reply_to_id: state.chat.replyToId
            };
        }

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
            addLog('╨д╨░╨╣╨╗ ╨┐╤А╨╡╨▓╤Л╤И╨░╨╡╤В ╨╗╨╕╨╝╨╕╤В 5 ╨Ь╨С', 'error');
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
            if (nameEl) nameEl.textContent = `ЁЯУО ${state.pendingFile.name} (${(file.size / 1024).toFixed(1)} KB)`;
            addLog(`╨д╨░╨╣╨╗ '${file.name}' ╨╖╨░╨│╤А╤Г╨╢╨╡╨╜`, 'success');
        } catch (e) {
            addLog(`╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╤Д╨░╨╣╨╗╨░: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
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
        contactList.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</div>';
        
        // Load all users initially
        apiRequest('/users/list').then(users => {
            state.contacts = users.filter(u => u.id !== state.user.id);
            window['filterFabContacts']();
        }).catch(e => {
            contactList.innerHTML = '<div style="text-align:center; padding:15px; color:red;">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438</div>';
        });
    };

    // Debounced server search
    let _fabSearchTimer = null;

    // @ts-ignore
    window.filterFabContacts = function() {
        const query = (document.getElementById('fab-contact-search')?.value || '').trim();
        const contactList = document.getElementById('fab-contacts-list');

        // If query long enough тАФ search server (by phone or nickname)
        if (query.length >= 2) {
            clearTimeout(_fabSearchTimer);
            _fabSearchTimer = setTimeout(async () => {
                contactList.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-dim);">\u041f\u043e\u0438\u0441\u043a...</div>';
                try {
                    const results = await apiRequest(`/users/search/${encodeURIComponent(query)}`);
                    renderFabContacts(results, contactList);
                } catch(e) {
                    contactList.innerHTML = '<div style="text-align:center; padding:10px; color:red;">\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0438\u0441\u043a\u0430</div>';
                }
            }, 350);
            return;
        }

        // Otherwise filter local cache
        const filtered = (state.contacts || []).filter(u =>
            (u.username || '').toLowerCase().includes(query.toLowerCase())
        );
        renderFabContacts(filtered, contactList);
    };

    function renderFabContacts(users, contactList) {
        contactList.innerHTML = '';

        // --- Invite button always at top ---
        const inviteDiv = document.createElement('div');
        inviteDiv.style.cssText = 'padding: 10px 12px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-metal); cursor: pointer; border-radius: 8px; transition: background 0.15s;';
        inviteDiv.onmouseover = () => inviteDiv.style.background = 'rgba(0,242,255,0.07)';
        inviteDiv.onmouseout = () => inviteDiv.style.background = 'transparent';
        inviteDiv.innerHTML = `
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(0,242,255,0.12);border:1px dashed var(--accent-cyan);display:flex;align-items:center;justify-content:center;color:var(--accent-cyan);flex-shrink:0;">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </div>
            <div>
                <div style="font-size:14px;font-weight:600;color:var(--accent-cyan);">╨Я╤А╨╕╨│╨╗╨░╤Б╨╕╤В╤М ╨┤╤А╤Г╨│╨░</div>
                <div style="font-size:11px;color:var(--text-dim);">╨Ю╤В╨┐╤А╨░╨▓╨╕╤В╤М ╤Б╤Б╤Л╨╗╨║╤Г ╨┤╨╗╤П ╤А╨╡╨│╨╕╤Б╤В╤А╨░╤Ж╨╕╨╕ ╨▓ Skufia-Net</div>
            </div>
        `;
        inviteDiv.onclick = async () => {
            try {
                const resp = await apiRequest('/invite/generate', 'POST');
                const fullUrl = `${window.location.origin}${resp.invite_url}`;
                if (navigator.share) {
                    await navigator.share({
                        title: 'Skufia-Net тАФ ╨┐╤А╨╕╨│╨╗╨░╤И╨╡╨╜╨╕╨╡',
                        text: '╨Я╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╤П╨╣╤Б╤П ╨║╨╛ ╨╝╨╜╨╡ ╨▓ Skufia-Net тАФ ╨╖╨░╤Й╨╕╤Й╤С╨╜╨╜╨╛╨╝ ╨╝╨╡╤Б╤Б╨╡╨╜╨┤╨╢╨╡╤А╨╡ ╨┤╨╗╤П ╤Б╨▓╨╛╨╕╤Е.',
                        url: fullUrl
                    });
                } else {
                    await navigator.clipboard.writeText(fullUrl);
                    addLog('╨б╤Б╤Л╨╗╨║╨░-╨┐╤А╨╕╨│╨╗╨░╤И╨╡╨╜╨╕╨╡ ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜╨░ ╨▓ ╨▒╤Г╤Д╨╡╤А тАФ ╨▓╤Б╤В╨░╨▓╤М╤В╨╡ ╨▓ WhatsApp, Telegram ╨╕╨╗╨╕ SMS', 'success');
                }
            } catch(e) {
                addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨│╨╡╨╜╨╡╤А╨░╤Ж╨╕╨╕ ╤Б╤Б╤Л╨╗╨║╨╕', 'error');
            }
        };
        contactList.appendChild(inviteDiv);

        if (!users || users.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center; padding:20px; color:var(--text-dim); font-size:13px;';
            empty.textContent = '╨Я╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╨╕ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╤Л. ╨Я╤А╨╕╨│╨╗╨░╤Б╨╕╤В╨╡ ╨┤╤А╤Г╨╖╨╡╨╣!';
            contactList.appendChild(empty);
            return;
        }
        
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.cursor = 'pointer';
            
            const initial = (u.username || '?').charAt(0).toUpperCase();
            const charCode = initial.charCodeAt(0) || 65;
            const hue = (charCode * 137) % 360;
            const avatarHtml = u.avatar_url 
                ? `<img src="${u.avatar_url}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">` 
                : `<div class="sidebar-item-avatar dynamic-avatar" style="background:linear-gradient(135deg,hsl(${hue},70%,50%),hsl(${hue},80%,30%));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;">${initial}</div>`;
            const onlineDot = u.is_online ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00f2ff;margin-left:5px;vertical-align:middle;"></span>` : '';
            const handleText = u.handle ? `<span style="color:var(--text-dim);font-size:11px;">${u.handle}</span>` : '';
            
            div.innerHTML = `
                ${avatarHtml}
                <div class="sidebar-item-info">
                    <div class="sidebar-item-name">${u.username}${onlineDot}</div>
                    <div class="sidebar-item-last-msg">${handleText || 'Skufia-Net'}</div>
                </div>
            `;
            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: 'Private', room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? '╨з╨░╤В ╤Г╨╢╨╡ ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╨╡╤В' : '╨Ы╨╕╤З╨╜╤Л╨╣ ╤З╨░╤В ╤Б╨╛╨╖╨┤╨░╨╜', 'success');
                    await window.loadChatRooms();
                    window.selectChatRoom(room.id, u.username, 'private', u.id, 'member');
                } catch(e) {
                    addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╤З╨░╤В╨░', 'error');
                }
            };
            contactList.appendChild(div);
        });
    }

    // @ts-ignore
    window.openCreateRoomModal = function(type) {
        const modal = document.getElementById('create-room-modal');
        const title = document.getElementById('create-room-title');
        const label = document.getElementById('create-room-label');
        const typeInput = document.getElementById('create-room-type');
        const input = document.getElementById('create-room-input');
        const descInput = document.getElementById('create-room-desc');

        title.textContent = type === 'channel' ? '╨б╨Ю╨Ч╨Ф╨Р╨в╨м ╨Ъ╨Р╨Э╨Р╨Ы' : '╨б╨Ю╨Ч╨Ф╨Р╨в╨м ╨У╨а╨г╨Я╨Я╨г';
        label.textContent = type === 'channel' ? '╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ ╨║╨░╨╜╨░╨╗╨░' : '╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ ╨│╤А╤Г╨┐╨┐╤Л';
        if (typeInput) typeInput.value = type;
        if (input) input.value = '';
        if (descInput) descInput.value = '';

        modal.style.display = 'flex';
        if (input) input.focus();
    };

    // @ts-ignore
    window.confirmCreateRoom = async function() {
        const input = document.getElementById('create-room-input');
        const typeInput = document.getElementById('create-room-type');
        const pubToggle = document.getElementById('create-room-public');
        const descInput = document.getElementById('create-room-desc');
        const name = input ? input.value.trim() : '';
        const rType = typeInput ? typeInput.value : 'group';
        const isPublic = pubToggle ? pubToggle.checked : false;
        const description = descInput ? descInput.value.trim() : '';

        if (!name) return;

        try {
            document.getElementById('create-room-modal').style.display = 'none';
            // Use new /chat/groups endpoint which sets owner_id and invite_code
            const payload = { name, room_type: rType, is_public: isPublic, description, initial_members: [] };
            const room = await apiRequest('/chat/groups', 'POST', payload);
            addLog(`тЬЕ ╨б╨╛╨╖╨┤╨░╨╜╨╛: ${name}`, 'success');
            await loadChatRooms();
            // Auto-open the new room
            if (room && room.id) {
                selectChatRoom(room.id, name, rType, null, 'owner');
            }
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П', 'error'); }
    };

    // тФАтФАтФА GROUP SETTINGS MODAL тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

    /**
     * Opens the group/channel settings modal for the current room.
     * Shows member list, role management, invite links, and danger zone.
     */
    // @ts-ignore
    window.openGroupSettings = async function() {
        const roomId = state.chat.currentRoomId;
        const myRole = state.chat.currentMyRole;
        if (!roomId) return;
        if (window.toggleChatOptions) window.toggleChatOptions();

        // Fetch room info and members in parallel
        let roomInfo = null, members = [];
        try {
            [roomInfo, members] = await Promise.all([
                apiRequest(`/chat/rooms/${roomId}/info`),
                apiRequest(`/chat/rooms/${roomId}/members`)
            ]);
        } catch (e) {
            addLog('╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨╕╨╜╤Д╨╛╤А╨╝╨░╤Ж╨╕╤О ╨╛ ╨│╤А╤Г╨┐╨┐╨╡', 'error');
            return;
        }

        const isAdmin = ['owner', 'admin'].includes(myRole);
        const isOwner = myRole === 'owner';

        // тФАтФА Build modal тФАтФА
        const existing = document.getElementById('group-settings-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'group-settings-modal';
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);
            display:flex; align-items:center; justify-content:center; z-index:9999;
            animation: fadeIn 0.2s ease;
        `;
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        const roleBadgeColor = { owner: '#f0b429', admin: '#00ff41', member: '#888', banned: '#f00' };
        const roleLabel = { owner: 'ЁЯСС ╨Т╨╗╨░╨┤╨╡╨╗╨╡╤Ж', admin: 'тЪб ╨Р╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А', member: 'ЁЯСд ╨г╤З╨░╤Б╤В╨╜╨╕╨║', banned: 'ЁЯЪл ╨Ч╨░╨▒╨╗╨╛╨║╨╕╤А╨╛╨▓╨░╨╜' };

        const membersHTML = members.map(m => {
            const canKick = isAdmin && m.role !== 'owner' && !(m.role === 'admin' && !isOwner) && m.user_id !== state.user.id;
            const canChangeRole = isOwner && m.role !== 'owner' && m.user_id !== state.user.id;
            const avatar = m.avatar_url
                ? `<img src="${m.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
                : `<img src="https://api.dicebear.com/7.x/identicon/svg?seed=${m.username}" style="width:36px;height:36px;border-radius:50%;">`;

            return `
            <div class="member-row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${avatar}
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;">${m.username}</div>
                    <div style="font-size:11px;color:${roleBadgeColor[m.role] || '#888'};">${roleLabel[m.role] || m.role}</div>
                </div>
                <div style="display:flex;gap:6px;">
                    ${canChangeRole ? `
                        <select onchange="window.updateMemberRole(${roomId}, ${m.user_id}, this.value)"
                            style="background:var(--bg-panel);border:1px solid var(--border-metal);color:var(--text-primary);padding:3px 6px;border-radius:4px;font-size:11px;cursor:pointer;">
                            <option value="admin" ${m.role==='admin'?'selected':''}>тЪб ╨Р╨┤╨╝╤Ц╨╜</option>
                            <option value="member" ${m.role==='member'?'selected':''}>ЁЯСд ╨г╤З╨░╤Б╤В╨╜╨╕╨║</option>
                            <option value="banned" ${m.role==='banned'?'selected':''}>ЁЯЪл ╨С╨░╨╜</option>
                        </select>
                    ` : ''}
                    ${canKick ? `
                        <button onclick="window.kickMember(${roomId}, ${m.user_id}, '${m.username}')"
                            style="background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.3);color:#ff5555;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">
                            ╨Ш╤Б╨║╨╗╤О╤З╨╕╤В╤М
                        </button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');

        overlay.innerHTML = `
        <div style="background:var(--bg-panel);border:1px solid var(--border-metal);border-radius:16px;width:min(520px,95vw);max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
            <!-- Header -->
            <div style="padding:20px;border-bottom:1px solid var(--border-metal);display:flex;align-items:center;gap:14px;">
                <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#0f0,#0af);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">
                    ${roomInfo.type === 'channel' ? 'ЁЯУв' : 'ЁЯСе'}
                </div>
                <div style="flex:1;">
                    <div style="font-size:16px;font-weight:700;">${roomInfo.name}</div>
                    <div style="font-size:12px;color:var(--text-dim);">${roomInfo.type === 'channel' ? '╨Ъ╨░╨╜╨░╨╗' : '╨У╤А╤Г╨┐╨┐╨░'} ┬╖ ${roomInfo.member_count} ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨▓ ┬╖ ${roomInfo.is_public ? 'ЁЯМН ╨Я╤Г╨▒╨╗╨╕╤З╨╜╤Л╨╣' : 'ЁЯФТ ╨Я╤А╨╕╨▓╨░╤В╨╜╤Л╨╣'}</div>
                    ${roomInfo.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${roomInfo.description}</div>` : ''}
                </div>
                <button onclick="document.getElementById('group-settings-modal').remove()"
                    style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;padding:4px;">тЬХ</button>
            </div>

            <!-- Invite section (admin only) -->
            ${isAdmin ? `
            <div style="padding:16px 20px;border-bottom:1px solid var(--border-metal);">
                <div style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:8px;">ЁЯФЧ ╨Я╨а╨Ш╨У╨Ы╨Р╨б╨Ш╨в╨м</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <div style="flex:1;background:rgba(0,255,65,0.07);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;color:#0f0;word-break:break-all;" id="invite-link-display">
                        ${window.location.origin}/join/${roomInfo.invite_code}
                    </div>
                    <button onclick="window.copyInviteLink('${roomInfo.invite_code}')"
                        style="background:rgba(0,255,65,0.1);border:1px solid rgba(0,255,65,0.3);color:#0f0;padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:12px;">
                        ЁЯУЛ ╨Ъ╨╛╨┐╨╕╤А╨╛╨▓╨░╤В╤М
                    </button>
                </div>
                <button onclick="window.generateNewInvite(${roomId})"
                    style="margin-top:8px;background:none;border:1px solid var(--border-metal);color:var(--text-dim);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;">
                    тЖ╗ ╨б╨╛╨╖╨┤╨░╤В╤М ╨╜╨╛╨▓╤Г╤О ╤Б╤Б╤Л╨╗╨║╤Г
                </button>
            </div>` : ''}

            <!-- Add member button (admin only) -->
            ${isAdmin ? `
            <div style="padding:12px 20px;border-bottom:1px solid var(--border-metal);">
                <button onclick="document.getElementById('group-settings-modal').remove(); window.openAddMemberModal();"
                    style="width:100%;background:rgba(0,175,255,0.1);border:1px solid rgba(0,175,255,0.3);color:#0af;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;">
                    тЮХ ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨▓
                </button>
            </div>` : ''}

            <!-- Members list -->
            <div>
                <div style="padding:12px 20px 8px;font-size:11px;letter-spacing:0.1em;color:var(--text-dim);">
                    ЁЯСе ╨г╨з╨Р╨б╨в╨Э╨Ш╨Ъ╨Ш (${members.length})
                </div>
                <div id="group-members-list">
                    ${membersHTML}
                </div>
            </div>

            <!-- Settings (admin only) -->
            ${isAdmin ? `
            <div style="padding:16px 20px;border-top:1px solid var(--border-metal);">
                <div style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:10px;">тЪЩя╕П ╨Э╨Р╨б╨в╨а╨Ю╨Щ╨Ъ╨Ш</div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-size:13px;">╨Я╤Г╨▒╨╗╨╕╤З╨╜╤Л╨╣ ╨┤╨╛╤Б╤В╤Г╨┐</span>
                    <label style="position:relative;display:inline-block;width:44px;height:22px;">
                        <input type="checkbox" id="group-public-toggle" ${roomInfo.is_public ? 'checked' : ''}
                            onchange="window.toggleGroupPublic(${roomId}, this.checked)"
                            style="opacity:0;width:0;height:0;">
                        <span style="position:absolute;cursor:pointer;inset:0;background:${roomInfo.is_public ? '#0f0' : '#333'};border-radius:22px;transition:.3s;"></span>
                        <span style="position:absolute;content:'';height:16px;width:16px;left:3px;bottom:3px;background:white;border-radius:50%;transition:.3s;transform:${roomInfo.is_public ? 'translateX(22px)' : 'none'};"></span>
                    </label>
                </div>
            </div>` : ''}

            <!-- Danger zone / Leave -->
            <div style="padding:16px 20px;border-top:1px solid rgba(255,50,50,0.2);">
                ${isOwner ? `
                <button onclick="window.confirmDeleteRoom(${roomId}, '${roomInfo.name}')"
                    style="width:100%;background:rgba(255,50,50,0.1);border:1px solid rgba(255,50,50,0.4);color:#ff5555;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">
                    ЁЯЧСя╕П ╨г╨┤╨░╨╗╨╕╤В╤М ╨│╤А╤Г╨┐╨┐╤Г ╨╜╨░╨▓╤Б╨╡╨│╨┤╨░
                </button>` : ''}
                <button onclick="window.leaveCurrentRoom(${roomId})"
                    style="width:100%;background:rgba(255,150,0,0.08);border:1px solid rgba(255,150,0,0.3);color:#ffaa00;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;">
                    ЁЯЪк ╨Я╨╛╨║╨╕╨╜╤Г╤В╤М ╨│╤А╤Г╨┐╨┐╤Г
                </button>
            </div>
        </div>`;

        document.body.appendChild(overlay);
    };

    // тФАтФАтФА Group management helper functions тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

    window.copyInviteLink = function(code) {
        const url = `${window.location.origin}/join/${code}`;
        navigator.clipboard.writeText(url).then(() => addLog('тЬЕ ╨б╤Б╤Л╨╗╨║╨░ ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜╨░', 'success'));
    };

    window.generateNewInvite = async function(roomId) {
        try {
            const inv = await apiRequest(`/chat/rooms/${roomId}/invite`, 'POST', { max_uses: null, expires_hours: null });
            const el = document.getElementById('invite-link-display');
            if (el) el.textContent = `${window.location.origin}/join/${inv.invite_code}`;
            addLog('тЬЕ ╨Э╨╛╨▓╨░╤П ╨╕╨╜╨▓╨░╨╣╤В-╤Б╤Б╤Л╨╗╨║╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨░', 'success');
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╨╕╨╜╨▓╨░╨╣╤В╨░', 'error'); }
    };

    window.kickMember = async function(roomId, userId, username) {
        if (!confirm(`╨Ш╤Б╨║╨╗╤О╤З╨╕╤В╤М ${username} ╨╕╨╖ ╨│╤А╤Г╨┐╨┐╤Л?`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}/members/${userId}`, 'DELETE');
            addLog(`тЬЕ ${username} ╨╕╤Б╨║╨╗╤О╤З╤С╨╜`, 'success');
            // Refresh modal
            window.openGroupSettings();
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨╕╤Б╨║╨╗╤О╤З╨╡╨╜╨╕╤П', 'error'); }
    };

    window.updateMemberRole = async function(roomId, userId, newRole) {
        try {
            await apiRequest(`/chat/rooms/${roomId}/members/${userId}/role`, 'PUT', { role: newRole });
            addLog(`тЬЕ ╨а╨╛╨╗╤М ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨░`, 'success');
        } catch (e) {
            addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╤А╨╛╨╗╨╕', 'error');
            window.openGroupSettings(); // revert UI
        }
    };

    window.toggleGroupPublic = async function(roomId, isPublic) {
        try {
            await apiRequest(`/chat/rooms/${roomId}/settings`, 'PUT', { is_public: isPublic });
            addLog(`тЬЕ ╨Ф╨╛╤Б╤В╤Г╨┐: ${isPublic ? '╨┐╤Г╨▒╨╗╨╕╤З╨╜╤Л╨╣' : '╨┐╤А╨╕╨▓╨░╤В╨╜╤Л╨╣'}`, 'success');
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П ╨╜╨░╤Б╤В╤А╨╛╨╡╨║', 'error'); }
    };

    window.confirmDeleteRoom = async function(roomId, name) {
        if (!confirm(`╨г╨┤╨░╨╗╨╕╤В╤М ╨│╤А╤Г╨┐╨┐╤Г ┬л${name}┬╗ ╨╜╨░╨▓╤Б╨╡╨│╨┤╨░? ╨н╤В╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╨╡ ╨╜╨╡╨╗╤М╨╖╤П ╨╛╤В╨╝╨╡╨╜╨╕╤В╤М.`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}`, 'DELETE');
            const modal = document.getElementById('group-settings-modal');
            if (modal) modal.remove();
            addLog('тЬЕ ╨У╤А╤Г╨┐╨┐╨░ ╤Г╨┤╨░╨╗╨╡╨╜╨░', 'success');
            // Return to sidebar
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) chatMain.classList.remove('active');
            state.chat.currentRoomId = null;
            await loadChatRooms();
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╤П', 'error'); }
    };

    window.leaveCurrentRoom = async function(roomId) {
        const name = state.chat.currentRoomName || '╨│╤А╤Г╨┐╨┐╤Г';
        if (!confirm(`╨Я╨╛╨║╨╕╨╜╤Г╤В╤М ${name}?`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}/leave`, 'POST');
            const modal = document.getElementById('group-settings-modal');
            if (modal) modal.remove();
            addLog('тЬЕ ╨Т╤Л ╨┐╨╛╨║╨╕╨╜╤Г╨╗╨╕ ╨│╤А╤Г╨┐╨┐╤Г', 'info');
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) chatMain.classList.remove('active');
            state.chat.currentRoomId = null;
            await loadChatRooms();
        } catch (e) { addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨▓╤Л╤Е╨╛╨┤╨░ ╨╕╨╖ ╨│╤А╤Г╨┐╨┐╤Л', 'error'); }
    };

    // тФАтФАтФА Join by invite code тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА

    window.openJoinByInviteModal = function() {
        const existing = document.getElementById('join-invite-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'join-invite-modal';
        overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;`;
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
        <div style="background:var(--bg-panel);border:1px solid var(--border-metal);border-radius:16px;width:min(420px,92vw);padding:24px;">
            <div style="font-size:15px;font-weight:700;margin-bottom:16px;">ЁЯФЧ ╨Т╨б╨в╨г╨Я╨Ш╨в╨м ╨Я╨Ю ╨б╨б╨л╨Ы╨Ъ╨Х</div>
            <input id="join-invite-input" type="text" placeholder="╨Т╤Б╤В╨░╨▓╤М╤В╨╡ ╨╕╨╜╨▓╨░╨╣╤В-╤Б╤Б╤Л╨╗╨║╤Г ╨╕╨╗╨╕ ╨║╨╛╨┤..."
                style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);border-radius:8px;padding:10px 12px;color:var(--text-primary);font-size:14px;box-sizing:border-box;margin-bottom:12px;">
            <div style="display:flex;gap:8px;">
                <button onclick="document.getElementById('join-invite-modal').remove()"
                    style="flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);color:var(--text-secondary);padding:10px;border-radius:8px;cursor:pointer;">
                    ╨Ю╤В╨╝╨╡╨╜╨░
                </button>
                <button onclick="window.submitJoinInvite()"
                    style="flex:1;background:linear-gradient(135deg,#0f0,#0af);border:none;color:#000;padding:10px;border-radius:8px;cursor:pointer;font-weight:700;">
                    ╨Т╤Б╤В╤Г╨┐╨╕╤В╤М
                </button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        setTimeout(() => document.getElementById('join-invite-input')?.focus(), 50);
    };

    window.submitJoinInvite = async function() {
        const input = document.getElementById('join-invite-input');
        if (!input) return;
        let code = input.value.trim();
        // Extract code from full URL if pasted
        const match = code.match(/\/join\/([A-Za-z0-9_-]+)/);
        if (match) code = match[1];
        if (!code) { addLog('╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨╕╨╜╨▓╨░╨╣╤В-╨║╨╛╨┤', 'error'); return; }

        try {
            const res = await apiRequest(`/chat/join/${code}`, 'POST');
            document.getElementById('join-invite-modal')?.remove();
            addLog(`тЬЕ ${res.status}: ${res.room_name}`, 'success');
            await loadChatRooms();
            if (res.room_id) selectChatRoom(res.room_id, res.room_name, res.room_type, null, 'member');
        } catch (e) {
            addLog(e.message || '╨Э╨╡╨▓╨╡╤А╨╜╨░╤П ╨╕╨╗╨╕ ╤Г╤Б╤В╨░╤А╨╡╨▓╤И╨░╤П ╤Б╤Б╤Л╨╗╨║╨░', 'error');
        }
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
            list.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim);">╨Э╨╕╤З╨╡╨│╨╛ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨╛</div>`;
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
            addLog(`╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╛ ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨▓: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
        } catch (e) {
            addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╤А╨╕ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╨╕ ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨▓', 'error');
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
            previewText.textContent = `╨Ю╤В╨▓╨╡╤В ╨╜╨░: ${text.substring(0, 25)}...`;
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
            previewText.textContent = `╨а╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡...`;
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
            if (input.value === '╨а╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡...') input.value = '';
        }
    }

    window['deleteMessage'] = async function(id) {
        if (!confirm('╨г╨┤╨░╨╗╨╕╤В╤М ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡?')) return;
        try {
            // @ts-ignore
            await apiRequest(`/chat/messages/${id}`, 'DELETE');
        } catch(e) { 
            // @ts-ignore
            addLog('╨г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╨╜╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М', 'error'); 
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
        let typingTimer;
        chatInput.addEventListener('input', (e) => {
            if (state.chat.currentRoomId) {
                localStorage.setItem(`skuf_draft_${state.chat.currentRoomId}`, e.target.value);
            }
            if (state.chat.socket && state.chat.socket.readyState === 1) {
                state.chat.socket.send(JSON.stringify({
                    type: 'typing_status',
                    status: true,
                    room_id: state.chat.currentRoomId,
                    sender: state.user.username,
                    sender_id: state.user.id
                }));
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    state.chat.socket.send(JSON.stringify({
                        type: 'typing_status',
                        status: false,
                        room_id: state.chat.currentRoomId,
                        sender: state.user.username,
                        sender_id: state.user.id
                    }));
                }, 2000);
            }
        });
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
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
                addLog('╨Ч╨░╨┐╨╕╤Б╤М ╨│╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨│╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П...', 'info');
            } catch(e) {
                addLog('╨Ь╨╕╨║╤А╨╛╤Д╨╛╨╜ ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╡╨╜: ' + e.message, 'error');
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
                msgInput.value = 'ЁЯОд ╨У╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡';
                await sendChatMsg();
                msgInput.value = originalVal;
            } catch(e) {
                addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨╛╤В╨┐╤А╨░╨▓╨║╨╕ ╨│╨╛╨╗╨╛╤Б╨╛╨▓╨╛╨│╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П', 'error');
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
            
            const emojis = ['ЁЯША','ЁЯШВ','ЁЯе░','ЁЯШО','ЁЯдФ','ЁЯШб','ЁЯСН','ЁЯСО','тЭдя╕П','ЁЯФе','ЁЯОЙ','ЁЯСА','ЁЯТп','ЁЯдб','ЁЯе║','ЁЯТА','ЁЯдУ','ЁЯза','ЁЯН║','ЁЯНХ'];
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
        if (!state.user.token) return; // Prevent 401 polling
        const banner = document.getElementById('global-alert-banner');
        if (!banner) return;
        try {
            const data = await apiRequest('/notifications/all');
            if (data && data.length > 0) {
                const alert = data[0]; // Show most recent
                banner.textContent = `тЪая╕П SYSTEM ALERT: ${alert.message}`;
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
        document.getElementById('auth-title').textContent = '╨а╨Х╨У╨Ш╨б╨в╨а╨Р╨ж╨Ш╨п';
    });

    document.getElementById('toggle-to-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('auth-title').textContent = '╨Р╨Т╨в╨Ю╨а╨Ш╨Ч╨Р╨ж╨Ш╨п';
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = '╨Ю╨Ц╨Ш╨Ф╨Р╨Э╨Ш╨Х...';
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
            addLog('╨Р╤Г╤В╨╡╨╜╤В╨╕╤Д╨╕╨║╨░╤Ж╨╕╤П ╤Г╤Б╨┐╨╡╤И╨╜╨░', 'system');
            
            // Re-bind auth logic on boot system
            bootSystem();
        } catch (err) {
            document.getElementById('login-error').textContent = err.message;
        } finally {
            btn.textContent = '╨Т╨Ю╨Щ╨в╨Ш ╨Т ╨б╨Х╨в╨м';
        }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('reg-submit-btn') || e.target.querySelector('button[type="submit"]');
        if (btn) btn.textContent = '╨Ю╨Ц╨Ш╨Ф╨Р╨Э╨Ш╨Х...';
        try {
            const pdConsent = document.getElementById('reg-pd-consent');
            const res = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('reg-username').value,
                    email: document.getElementById('reg-email').value,
                    password: document.getElementById('reg-password').value,
                    accepted_pd: pdConsent ? pdConsent.checked : false  // [╨д╨Ч-152]
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Registration failed');
            
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('auth-title').textContent = '╨Р╨Т╨в╨Ю╨а╨Ш╨Ч╨Р╨ж╨Ш╨п';
            document.getElementById('login-username').value = document.getElementById('reg-username').value;
            document.getElementById('login-password').value = document.getElementById('reg-password').value;
            document.getElementById('login-error').textContent = '╨а╨╡╨│╨╕╤Б╤В╤А╨░╤Ж╨╕╤П ╤Г╤Б╨┐╨╡╤И╨╜╨░. ╨Т╤Л╨┐╨╛╨╗╨╜╨╕╤В╨╡ ╨▓╤Е╨╛╨┤.';
            document.getElementById('login-error').style.color = '#00f2ff';
        } catch (err) {
            document.getElementById('reg-error').textContent = err.message;
        } finally {
            if (btn) btn.textContent = '╨Р╨Ъ╨в╨Ш╨Т╨Ш╨а╨Ю╨Т╨Р╨в╨м ╨Р╨Ъ╨Ъ╨Р╨г╨Э╨в';
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
                addLog('╨Ъ╨╛╤А╨╛╤В╨║╨╛╨╡ ╨╕╨╝╤П ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╛', 'success');
            } catch (err) {
                addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╤А╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨╕╨╕ ╨╕╨╝╨╡╨╜╨╕', 'error');
            }
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
            syncContactsBtn.textContent = '╨Ш╨Ф╨Х╨в ╨Я╨Ю╨Ш╨б╨Ъ...';
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
                            addLog(`╨г╤Б╨┐╨╡╤И╨╜╨╛ ╨┐╨╛╨┤╤В╤П╨╜╤Г╤В╨╛ ╨░╨▒╨╛╨╜╨╡╨╜╤В╨╛╨▓: ${contacts.length}`, 'success');
                            loadChatRooms(); // refresh sidebar 
                        } else throw new Error();
                    } else {
                        addLog('╨Ъ╨╛╨╜╤В╨░╨║╤В╤Л ╨╜╨╡ ╨▓╤Л╨▒╤А╨░╨╜╤Л', 'info');
                    }
                } else {
                    addLog('Contact Picker API ╨╜╨╡ ╨┐╨╛╨┤╨┤╨╡╤А╨╢╨╕╨▓╨░╨╡╤В╤Б╤П ╨╜╨░ ╨▓╨░╤И╨╡╨╝ ╤Г╤Б╤В╤А╨╛╨╣╤Б╤В╨▓╨╡. Backend Sync Mode ╨░╨║╤В╨╕╨▓╨╕╤А╨╛╨▓╨░╨╜.', 'info');
                    // Fallback to manual sync trigger on backend
                    const resp = await fetch(`${API_BASE_URL}/api/contacts/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.user.token}` },
                        body: JSON.stringify({ contacts: [] })
                    });
                    if (resp.ok) addLog('Backend Sync ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜', 'success');
                }
            } catch (err) {
                addLog('╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╕╨╜╤Е╤А╨╛╨╜╨╕╨╖╨░╤Ж╨╕╨╕ ╨║╨╛╨╜╤В╨░╨║╤В╨╛╨▓', 'error');
            } finally {
                syncContactsBtn.textContent = '╨Я╨Ю╨Ф╨в╨п╨Э╨г╨в╨м ╨Ъ╨Ю╨Э╨в╨Р╨Ъ╨в╨л';
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

        // --- SKUFENGER AUTH BRANDING ---
        const authTitle = document.getElementById('auth-title');
        const loginBtn = document.querySelector('#login-form button[type="submit"]');
        const regBtn = document.querySelector('#register-form button[type="submit"]');
        
        if (authTitle) authTitle.textContent = '╨Т╨е╨Ю╨Ф ╨Т SKUFENGER';
        if (loginBtn) loginBtn.textContent = '╨Т╨Ю╨Щ╨в╨Ш ╨Т ╨Ь╨Х╨б╨б╨Х╨Э╨Ф╨Ц╨Х╨а';
        if (regBtn) regBtn.textContent = '╨б╨Ю╨Ч╨Ф╨Р╨в╨м ╨Р╨Ъ╨Ъ╨Р╨г╨Э╨в';

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
    window.loadFolders = loadFolders;
    window.renderChatRooms = renderChatRooms;
    window.loadTopicPosts = loadTopicPosts;
    window.likePost = likePost;
    window.likeWiki = likeWiki;
    window.switchView = switchView;
    window.selectChatRoom = selectChatRoom;
    // [FIX-06] Alias: selectChatRoom renders new #chat-input with inline onclick="window.sendChatMessage()"
    window.sendChatMessage = sendChatMsg;
    window.openSkufenger = function() {
        window.open(window.location.pathname + '?app=skufenger', '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
    };

    // --- CONTACT SEARCH FILTER ---
    window.closeChatMobile = function() {
        const chatLayout = document.querySelector('.chat-layout');
        if (chatLayout) chatLayout.classList.remove('chat-open');
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
            addLog('╨б╨╜╨░╤З╨░╨╗╨░ ╨▓╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨║╨╛╨╜╤В╨░╨║╤В ╨┤╨╗╤П ╨╖╨▓╨╛╨╜╨║╨░', 'error');
            return;
        }
        const targetId = state.chat.currentReceiverId || state.chat.currentRoomId;
        if (!window.RTCManagerInstance) {
            addLog('RTC ╨╝╨╛╨┤╤Г╨╗╤М ╨╜╨╡ ╨╕╨╜╨╕╤Ж╨╕╨░╨╗╨╕╨╖╨╕╤А╨╛╨▓╨░╨╜', 'error');
            return;
        }
        addLog(`╨Ш╨╜╨╕╤Ж╨╕╨░╤Ж╨╕╤П ${isVideo ? '╨▓╨╕╨┤╨╡╨╛' : '╨░╤Г╨┤╨╕╨╛'} ╨╖╨▓╨╛╨╜╨║╨░...`, 'info');
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
                if (!roomId) { addLog('╨б╨╜╨░╤З╨░╨╗╨░ ╨▓╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤З╨░╤В', 'error'); return; }
                const mutedRooms = JSON.parse(localStorage.getItem('skuf_muted_rooms') || '[]');
                const idx = mutedRooms.indexOf(roomId);
                if (idx === -1) {
                    mutedRooms.push(roomId);
                    addLog('ЁЯФХ ╨г╨▓╨╡╨┤╨╛╨╝╨╗╨╡╨╜╨╕╤П ╤З╨░╤В╨░ ╨╛╤В╨║╨╗╤О╤З╨╡╨╜╤Л', 'info');
                } else {
                    mutedRooms.splice(idx, 1);
                    addLog('ЁЯФФ ╨г╨▓╨╡╨┤╨╛╨╝╨╗╨╡╨╜╨╕╤П ╤З╨░╤В╨░ ╨▓╨║╨╗╤О╤З╨╡╨╜╤Л', 'info');
                }
                localStorage.setItem('skuf_muted_rooms', JSON.stringify(mutedRooms));
                break;
            }
            case 'search': {
                const chatHistory = document.getElementById('chat-history');
                if (!chatHistory) return;
                const term = prompt('╨Я╨╛╨╕╤Б╨║ ╨┐╨╛ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П╨╝:');
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
                addLog(`ЁЯФН ╨Э╨░╨╣╨┤╨╡╨╜╨╛ ╤Б╨╛╨▓╨┐╨░╨┤╨╡╨╜╨╕╨╣: ${found}`, found ? 'info' : 'error');
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
                addLog('ЁЯОи ╨д╨╛╨╜ ╤З╨░╤В╨░ ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜', 'info');
                break;
            }
            case 'clear': {
                if (!state.chat.currentRoomId) { addLog('╨б╨╜╨░╤З╨░╨╗╨░ ╨▓╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤З╨░╤В', 'error'); return; }
                if (!confirm('╨Ю╤З╨╕╤Б╤В╨╕╤В╤М ╨╕╤Б╤В╨╛╤А╨╕╤О ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╣? ╨н╤В╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╨╡ ╨╜╨╡╨╛╨▒╤А╨░╤В╨╕╨╝╨╛.')) return;
                const chatHistory = document.getElementById('chat-history');
                if (chatHistory) {
                    chatHistory.innerHTML = '<div class="chat-placeholder">╨Ш╤Б╤В╨╛╤А╨╕╤П ╨╛╤З╨╕╤Й╨╡╨╜╨░</div>';
                }
                addLog('ЁЯЧСя╕П ╨Ш╤Б╤В╨╛╤А╨╕╤П ╤З╨░╤В╨░ ╨╛╤З╨╕╤Й╨╡╨╜╨░', 'info');
                break;
            }
            case 'encryption': {
                const badge = document.getElementById('chat-encryption-status');
                const isE2EE = badge && badge.textContent.includes('E2EE');
                alert(isE2EE
                    ? 'ЁЯФТ ╨н╤В╨╛╤В ╤З╨░╤В ╨╖╨░╤Й╨╕╤Й╤С╨╜ ╤Б╨║╨▓╨╛╨╖╨╜╤Л╨╝ ╤И╨╕╤Д╤А╨╛╨▓╨░╨╜╨╕╨╡╨╝ (E2EE).\n╨Ъ╨╗╤О╤З╨╕ ╤Б╨╡╤Б╤Б╨╕╨╕ ╨│╨╡╨╜╨╡╤А╨╕╤А╤Г╤О╤В╤Б╤П ╨╗╨╛╨║╨░╨╗╤М╨╜╨╛ ╨╕ ╨╜╨╡ ╨┐╨╡╤А╨╡╨┤╨░╤О╤В╤Б╤П ╨╜╨░ ╤Б╨╡╤А╨▓╨╡╤А.'
                    : 'тЪая╕П ╨и╨╕╤Д╤А╨╛╨▓╨░╨╜╨╕╨╡ ╨╜╨╡ ╨░╨║╤В╨╕╨▓╨╜╨╛.\n╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨┐╤А╨╕╨▓╨░╤В╨╜╤Л╨╣ ╤З╨░╤В ╨┤╨╗╤П ╨░╨║╤В╨╕╨▓╨░╤Ж╨╕╨╕ E2EE.');
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


// Settings Avatar Preview + Upload
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
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`${API_BASE_URL}/api/me/avatar/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.user.token}` },
            body: formData
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Upload failed');
        }
        const data = await resp.json();
        const avatarUrl = data.avatar_url;

        // Update sidebar and dashboard avatars
        const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
        if (sidebarAvatar) applyAvatarDisplay(sidebarAvatar, avatarUrl);
        const dashAvatar = document.getElementById('dash-avatar');
        if (dashAvatar) applyAvatarDisplay(dashAvatar, avatarUrl);

        addLog('тЬЕ ╨Р╨▓╨░╤В╨░╤А╨║╨░ ╨╖╨░╨│╤А╤Г╨╢╨╡╨╜╨░ ╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨░!', 'success');
    } catch (e) {
        console.error('Avatar upload error:', e);
        addLog(`тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╨░╨▓╨░╤В╨░╤А╨║╨╕: ${e.message}`, 'error');
    }
};



// --- MODULE: CHANNEL/GROUP MEMBER MANAGEMENT ---
window.openAddMemberModal = async function() {
    const roomId = state.chat.activeRoomId;
    if (!roomId) return;
    
    document.getElementById('add-member-modal').style.display = 'flex';
    document.getElementById('add-member-search').value = '';
    const listContainer = document.getElementById('add-member-list');
    listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">╨Ч╨░╨│╤А╤Г╨╖╨║╨░ ╨║╨╛╨╜╤В╨░╨║╤В╨╛╨▓...</div>';
    
    try {
        const contacts = await apiRequest('/contacts');
        state.contacts = contacts || [];
        window.filterAddMemberContacts();
    } catch(e) {
        console.error('Error fetching contacts for add member:', e);
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#ff3333;">╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕</div>';
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
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">╨Э╨╕╤З╨╡╨│╨╛ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨╛</div>';
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
        addLog('╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤Е╨╛╤В╤П ╨▒╤Л ╨╛╨┤╨╕╨╜ ╨║╨╛╨╜╤В╨░╨║╤В', 'error');
        return;
    }
    
    try {
        for (let uid of userIds) {
            await apiRequest(`/chat/rooms/${roomId}/members`, 'POST', { user_id: uid });
        }
        addLog(`╨Ф╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╛ ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨▓: ${userIds.length}`, 'success');
        document.getElementById('add-member-modal').style.display = 'none';
    } catch(e) {
        console.error('Error adding members:', e);
        addLog('╨Ю╤И╨╕╨▒╨║╨░ ╨┐╤А╨╕ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╨╕', 'error');
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
        this.chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ╨Р╨С╨Т╨У╨Ф╨Х╨Ч╨Ш╨Ъ╨Ы╨Ь╨Э╨Ю╨Я╨а╨б╨в╨г╨д╨е╨ж╨з╨и╨й╨о╨п0123456789уВвуВдуВжуВиуВкуВлуВнуВпуВ▒уВ│уВ╡уВ╖уВ╣уВ╗уВ╜уВ┐уГБуГДуГЖуГИуГКуГЛуГМуГНуГОуГПуГТуГХуГШуГЫуГЮуГЯуГауГбуГвуГдуГжуГиуГйуГкуГлуГмуГнуГпуГ░уГ▒уГ▓уГ│';
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
 * Fix #1 тАФ Address bar overlap
 * Yandex Browser (and Chrome/Firefox on Android) shrink the visual viewport
 * when the address bar appears. We keep --app-height in sync with the actual
 * visible area so nothing gets hidden behind the browser chrome.
 */
(function setupViewportHeight() {
    function setAppHeight() {
        // visualViewport.height is the visible area excluding browser UI
        const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', h + 'px');
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
 * Fix #2 тАФ Back button behavior
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

        if (s.chat) {
            // Was in chat тАФ close the chat panel, go back to room list
            const chatMain = document.querySelector('.chat-main');
            const chatLayout = document.querySelector('.chat-layout');
            if (chatLayout) chatLayout.classList.remove('chat-open');
            if (chatMain) chatMain.classList.remove('active');
            return;
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
