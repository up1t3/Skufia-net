    // =========================================================================
    // SECURE CRYPTO ENGINE v2 — Signal-inspired E2EE
    // =========================================================================
    // Security properties:
    // ✅ RSA private key: non-extractable, persisted in IndexedDB only
    // ✅ AES session keys: non-extractable, cached per-room in IndexedDB
    // ✅ Key fingerprint: SHA-256 of public key bytes, displayed to user
    // ✅ Per-room AES-256-GCM keys — no universal key
    // ✅ Private key NEVER sent to server
    // ✅ Server stores only: public keys + RSA-wrapped AES bundles
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

        // ── RSA Key Pair ──────────────────────────────────────────────────────

        /**
         * Generate RSA-OAEP 4096-bit key pair.
         * Private key is NON-EXTRACTABLE — cannot be exported by any JS code.
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
                false,                            // ← extractable: FALSE (private key protected!)
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

        // ── AES Session Key ───────────────────────────────────────────────────

        /**
         * Generate a fresh AES-256-GCM key for a chat session.
         * NON-EXTRACTABLE — key bytes never leave the browser's crypto engine.
         * @returns {Promise<CryptoKey>}
         */
        static async generateSessionKey() {
            return await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                false,              // ← non-extractable!
                ['encrypt', 'decrypt']
            );
        }

        // ── Key Wrapping (RSA-OAEP wraps AES) ────────────────────────────────

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
                false,              // ← result is also non-extractable
                ['encrypt', 'decrypt']
            );
        }

        // ── Message Encryption / Decryption ───────────────────────────────────

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

    // ── Key Vault: persist identity + session keys in IndexedDB ──────────────

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
                addLog('🔐 Загрузка ключей из защищённого хранилища...', 'info');
                state.chat.keys.publicKey = await CryptoManager.importPublicKey(storedPub);
                state.chat.keys.privateKey = storedPriv; // already a CryptoKey
                // Always re-register pubKey in case server restarted
                await apiRequest('/me/key', 'POST', { public_key: storedPub }).catch(() => {});
                const fp = await CryptoManager.keyFingerprint(storedPub);
                state.chat.keyFingerprint = fp;
                addLog(`🔑 Ключи восстановлены | Отпечаток: ${fp.slice(0, 23)}...`, 'success');
                // Clear old insecure localStorage keys if present
                localStorage.removeItem('skufia_pub_spki');
                localStorage.removeItem('skufia_priv_pkcs8');
                return;
            }
        } catch (e) {
            addLog('⚠️ Ошибка чтения хранилища, генерируем новые ключи...', 'info');
            try {
                await vaultDelete(IDB_STORE_KEYS, 'pub_base64');
                await vaultDelete(IDB_STORE_KEYS, 'priv_cryptokey');
            } catch (err) {
                console.warn('Failed to clear vault:', err);
            }
        }

        // Generate fresh RSA-4096 identity key pair
        addLog('⚙️ Генерация RSA-4096 ключевой пары...', 'info');
        const pair = await CryptoManager.generateKeyPair();
        state.chat.keys.publicKey = pair.publicKey;
        state.chat.keys.privateKey = pair.privateKey;

        // Export ONLY the public key (private stays inside WebCrypto engine)
        const pubBase64 = await CryptoManager.exportPublicKey(pair.publicKey);

        // Save to IndexedDB:
        try {
            await vaultPut(IDB_STORE_KEYS, 'pub_base64', pubBase64);
            await vaultPut(IDB_STORE_KEYS, 'priv_cryptokey', pair.privateKey);
        } catch (err) {
            console.warn('Failed to save keys to IDB:', err);
        }

        // Register public key on server (server NEVER sees private key)
        await apiRequest('/me/key', 'POST', { public_key: pubBase64 });

        const fp = await CryptoManager.keyFingerprint(pubBase64);
        state.chat.keyFingerprint = fp;
        addLog(`✅ E2EE ключи созданы и защищены | Отпечаток: ${fp.slice(0, 23)}...`, 'success');
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
                addLog(`🔓 Сессионный ключ восстановлен для комнаты #${roomId}`, 'success');
                return sessionKey;
            }
        } catch (e) {
            // 404 = no key yet — we are the initiator
        }

        // 4. Generate new session key and distribute to both parties
        if (!receiverId) return null;

        addLog(`🔑 Установка E2EE сессии с пользователем #${receiverId}...`, 'info');

        // Fetch recipient's public key
        const targetKeyData = await apiRequest(`/users/${receiverId}/key`).catch(() => null);
        if (!targetKeyData || !targetKeyData.public_key) {
            addLog('⚠️ Получатель ещё не зарегистрировал ключи E2EE', 'error');
            return null;
        }

        // Show fingerprint of recipient's key for MITM detection
        const recipientFp = await CryptoManager.keyFingerprint(targetKeyData.public_key);
        addLog(`🔍 Отпечаток ключа получателя: ${recipientFp.slice(0, 23)}...`, 'info');

        // Generate fresh AES-256-GCM session key
        const sessionKey = await CryptoManager.generateSessionKey();
        state.chat.sessionKeys[roomId] = sessionKey;

        // Wrap session key for RECIPIENT using their RSA public key
        let recipientPubKey;
        let wrappedForRecipient;
        try {
            recipientPubKey = await CryptoManager.importPublicKey(targetKeyData.public_key);
            wrappedForRecipient = await CryptoManager.wrapKey(recipientPubKey, sessionKey);
        } catch (err) {
            console.warn("Invalid recipient public key:", err);
            addLog('⚠️ Публичный ключ получателя поврежден', 'error');
            return null;
        }

        // Wrap session key for OURSELVES (so we can decrypt our own sent messages)
        let myPubBase64 = null;
        try { myPubBase64 = await vaultGet(IDB_STORE_KEYS, 'pub_base64'); } catch(e) {}
        if (!myPubBase64 && state.chat.keys.publicKey) {
            myPubBase64 = await CryptoManager.exportPublicKey(state.chat.keys.publicKey);
        }
        if (!myPubBase64) throw new Error("Our public key not found");
        const myPubKey = await CryptoManager.importPublicKey(myPubBase64);
        const wrappedForSelf = await CryptoManager.wrapKey(myPubKey, sessionKey);

        // Store both bundles on server (server cannot decrypt — only wrapped blobs)
        const keysPayload = {};
        keysPayload[String(receiverId)] = wrappedForRecipient;
        keysPayload[String(state.user.id)] = wrappedForSelf;
        await apiRequest(`/chat/rooms/${roomId}/key`, 'POST', { keys: keysPayload });

        // Cache in IndexedDB
        await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});

        addLog(`✅ E2EE сессия установлена | Отпечаток: ${recipientFp.slice(0, 11)}...`, 'success');
        return sessionKey;
    }



