
import os

path = r'e:\AgentZero\usr\projects\skufia\frontend\crypto.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the end of the CryptoManager class (approximate)
# The file currently ends with some weird mess from line 343

# Reconstruct everything from line 341 onwards
fixed_part = """                true,
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
"""

# Find line 341 or where it gets messy
cut_point = content.find("const pubKey = await window.crypto.subtle.importKey(")
if cut_point != -1:
    # Find the next 'jwk,' after cut_point
    next_jwk = content.find("'jwk',", cut_point)
    if next_jwk != -1:
        # Reconstruct from cut_point + some offset to reach the end of the importKey call
        # Or just replace from cut_point
        reconstructed = content[:cut_point] + """const pubKey = await window.crypto.subtle.importKey(
                'jwk',
                pubJwk,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
""" + fixed_part
        with open(path, 'w', encoding='utf-8') as f:
            f.write(reconstructed)
        print("SUCCESS: crypto.js reconstructed.")
    else:
        print("ERROR: Could not find 'jwk,' after cut_point.")
else:
    print("ERROR: Could not find cut_point.")
