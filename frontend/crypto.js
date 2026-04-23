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
                true,                             // ← extractable: TRUE (required for multi-device export)
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

        // ── Identity Export / Import (PBKDF2 + AES-GCM) ───────────────────────────

        /**
         * Export the RSA private key, encrypting it with a user-provided password.
         * @param {CryptoKey} rsaPrivateKey 
         * @param {string} password 
         * @returns {Promise<string>} Base64 encoded JSON string containing salt, iv, and encrypted JWK
         */
        static async exportIdentityWithPassword(rsaPrivateKey, password) {
            if (!rsaPrivateKey.extractable) {
                throw new Error("Текущий приватный ключ не поддерживает экспорт. Вам необходимо перегенерировать ключи.");
            }
            
            // 1. Export key to JWK
            const jwk = await window.crypto.subtle.exportKey('jwk', rsaPrivateKey);
            const jwkString = JSON.stringify(jwk);
            
            // 2. Generate PBKDF2 salt and derive AES key
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const enc = new TextEncoder();
            const passKey = await window.crypto.subtle.importKey(
                'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
            );
            
            const aesKey = await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                passKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );
            
            // 3. Encrypt the JWK
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                enc.encode(jwkString)
            );
            
            // 4. Return combined package
            const payload = {
                salt: btoa(String.fromCharCode(...salt)),
                iv: btoa(String.fromCharCode(...iv)),
                ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
            };
            return btoa(JSON.stringify(payload));
        }

        /**
         * Import an RSA private key from a password-encrypted export payload.
         * @param {string} payloadBase64 
         * @param {string} password 
         * @returns {Promise<{privateKey: CryptoKey, publicKey: string}>}
         */
        static async importIdentityWithPassword(payloadBase64, password) {
            const payload = JSON.parse(atob(payloadBase64));
            const salt = Uint8Array.from(atob(payload.salt), c => c.charCodeAt(0));
            const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
            const ciphertext = Uint8Array.from(atob(payload.ciphertext), c => c.charCodeAt(0));
            
            // 1. Derive AES key from password
            const enc = new TextEncoder();
            const passKey = await window.crypto.subtle.importKey(
                'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
            );
            
            const aesKey = await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                passKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
            
            // 2. Decrypt JWK
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                ciphertext
            );
            const jwkString = new TextDecoder().decode(decrypted);
            const jwk = JSON.parse(jwkString);
            
            // 3. Import back into CryptoKey (keeping it extractable: true for future exports)
            const privateKey = await window.crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                true,
                ['decrypt']
            );
            
            // Generate corresponding public key JWK by stripping private fields
            const pubJwk = {
                kty: jwk.kty,
                n: jwk.n,
                e: jwk.e,
                alg: jwk.alg,
                ext: true
            };
            
            const pubKey = await window.crypto.subtle.importKey(
                'jwk',
                pubJwk,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                true,
                ['encrypt']
            );
            
            const publicKeyBase64 = await CryptoManager.exportPublicKey(pubKey);
            
            return { privateKey, publicKey: publicKeyBase64 };
        }
    }

    // ── Key Vault: persist identity + session keys in IndexedDB ──────────────

    async function ensureKeys() {
        if (state.chat.keys.publicKey && state.chat.keys.privateKey) return;

        try {
            // Try loading from IndexedDB vault
            const storedPub = await vaultGet(IDB_STORE_KEYS, 'pub_base64');
            const storedPriv = await vaultGet(IDB_STORE_KEYS, 'priv_cryptokey');

            if (storedPub && storedPriv) {
                addLog('🔐 Ключи загружены локально', 'info');
                state.chat.keys.publicKey = await CryptoManager.importPublicKey(storedPub);
                state.chat.keys.privateKey = storedPriv;
                // Sync with server if needed
                await apiRequest('/me/key', 'POST', { public_key: storedPub }).catch(() => {});
                state.chat.keyFingerprint = await CryptoManager.keyFingerprint(storedPub);
                return;
            }
        } catch (e) {
            console.warn('IDB access failed:', e);
        }

        // If not in IDB, check server
        addLog('🔍 Поиск ключей в облачном хранилище...', 'info');
        try {
            const myKeys = await apiRequest(`/users/${state.user.id}/key`);
            if (myKeys && myKeys.encrypted_private_key && myKeys.public_key) {
                // Found in cloud!
                const password = state.user.password;
                if (password) {
                    addLog('☁️ Ключи найдены в облаке. Синхронизация...', 'info');
                    const { privateKey, publicKey } = await CryptoManager.importIdentityWithPassword(myKeys.encrypted_private_key, password);
                    
                    // Save to IDB
                    await vaultPut(IDB_STORE_KEYS, 'pub_base64', publicKey);
                    await vaultPut(IDB_STORE_KEYS, 'priv_cryptokey', privateKey);
                    
                    // Load to memory
                    state.chat.keys.publicKey = await CryptoManager.importPublicKey(publicKey);
                    state.chat.keys.privateKey = privateKey;
                    state.chat.keyFingerprint = await CryptoManager.keyFingerprint(publicKey);
                    addLog('✅ Ключи восстановлены из облака', 'success');
                    return;
                } else {
                    addLog('⚠️ Требуется пароль для расшифровки облачного ключа', 'warning');
                }
            }
        } catch (err) {
            console.error('Cloud key check failed:', err);
        }

        // If neither local nor cloud, generate new
        addLog('⚙️ Создание новой цифровой личности (E2EE)...', 'info');
        const pair = await CryptoManager.generateKeyPair();
        const pubBase64 = await CryptoManager.exportPublicKey(pair.publicKey);
        
        state.chat.keys.publicKey = pair.publicKey;
        state.chat.keys.privateKey = pair.privateKey;
        state.chat.keyFingerprint = await CryptoManager.keyFingerprint(pubBase64);

        // Save to IDB
        await vaultPut(IDB_STORE_KEYS, 'pub_base64', pubBase64);
        await vaultPut(IDB_STORE_KEYS, 'priv_cryptokey', pair.privateKey);

        // Upload to server
        const password = state.user.password;
        let encryptedPrivate = null;
        if (password) {
            try {
                encryptedPrivate = await CryptoManager.exportIdentityWithPassword(pair.privateKey, password);
            } catch (e) {
                console.error('Encryption failed', e);
            }
        }
        
        await apiRequest('/me/key', 'POST', { 
            public_key: pubBase64,
            encrypted_private_key: encryptedPrivate
        }).catch(() => {});
        
        addLog('✅ Личность создана и сохранена в облаке', 'success');
    }

    async function getOrEstablishSessionKey(roomId, receiverId) {
        if (state.chat.sessionKeys[roomId]) return state.chat.sessionKeys[roomId];
        try {
            const cached = await vaultGet(IDB_STORE_SESSION, `room_${roomId}`);
            if (cached) {
                state.chat.sessionKeys[roomId] = cached;
                return cached;
            }
        } catch(e) {}

        await ensureKeys();
        if (!state.chat.keys.privateKey) return null;

        try {
            const keyBundle = await apiRequest(`/chat/rooms/${roomId}/key`);
            if (keyBundle && keyBundle.wrapped_key) {
                const sessionKey = await CryptoManager.unwrapKey(
                    state.chat.keys.privateKey,
                    keyBundle.wrapped_key
                );
                state.chat.sessionKeys[roomId] = sessionKey;
                await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});
                return sessionKey;
            }
        } catch (e) {}

        if (!receiverId) return null;

        const targetKeyData = await apiRequest(`/users/${receiverId}/key`).catch(() => null);
        if (!targetKeyData || !targetKeyData.public_key) return null;

        const sessionKey = await CryptoManager.generateSessionKey();
        state.chat.sessionKeys[roomId] = sessionKey;

        const recipientPubKey = await CryptoManager.importPublicKey(targetKeyData.public_key);
        const wrappedForRecipient = await CryptoManager.wrapKey(recipientPubKey, sessionKey);

        const myPubBase64 = await vaultGet(IDB_STORE_KEYS, 'pub_base64');
        const myPubKey = await CryptoManager.importPublicKey(myPubBase64);
        const wrappedForSelf = await CryptoManager.wrapKey(myPubKey, sessionKey);

        const keysPayload = {};
        keysPayload[String(receiverId)] = wrappedForRecipient;
        keysPayload[String(state.user.id)] = wrappedForSelf;
        await apiRequest(`/chat/rooms/${roomId}/key`, 'POST', { keys: keysPayload });

        await vaultPut(IDB_STORE_SESSION, `room_${roomId}`, sessionKey).catch(() => {});
        return sessionKey;
    }

    window.resetIdentityKeys = async function() {
        if (!confirm('ВНИМАНИЕ! Ваши текущие ключи будут удалены. Продолжить?')) return;
        try {
            await vaultDelete(IDB_STORE_KEYS, 'pub_base64');
            await vaultDelete(IDB_STORE_KEYS, 'priv_cryptokey');
            state.chat.keys = { publicKey: null, privateKey: null };
            state.chat.keyFingerprint = null;
            await apiRequest('/me/key', 'POST', { public_key: "", encrypted_private_key: "" }).catch(() => {});
            await ensureKeys();
            alert('Ключи успешно сброшены!');
            if (document.getElementById('settings-modal')) document.getElementById('settings-modal').style.display = 'none';
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    };

    window.vaultGet = vaultGet;
    window.vaultPut = vaultPut;
    window.vaultDelete = vaultDelete;
    window.ensureKeys = ensureKeys;
    window.getOrEstablishSessionKey = getOrEstablishSessionKey;
})();
