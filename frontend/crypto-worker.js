// frontend/crypto-worker.js

// Double Ratchet Algorithm Skeleton using WebCrypto API
// Implements ECDH (Curve25519 / X25519) and AES-GCM

// --- 1. Key Generation (Curve25519) ---
async function generateKeyPair() {
    return await crypto.subtle.generateKey(
        { name: "X25519" },
        true, // extractable for skeleton purposes
        ["deriveKey", "deriveBits"]
    );
}

// --- 2. Shared Secret Derivation (ECDH) ---
async function deriveSharedSecret(privateKey, publicKey) {
    return await crypto.subtle.deriveBits(
        {
            name: "X25519",
            public: publicKey
        },
        privateKey,
        256 // 32 bytes
    );
}

// --- 3. Key Derivation Function (HKDF) ---
async function deriveMessageKey(sharedSecretBits) {
    // Import the shared secret as a raw key for HKDF
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        sharedSecretBits,
        { name: "HKDF" },
        false,
        ["deriveKey"]
    );

    // Derive an AES-GCM key from the HKDF key
    return await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(), // Should be unique per session in a real implementation
            info: new TextEncoder().encode("DoubleRatchetMessageKey") // Context info
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// --- 4. Encryption (AES-GCM) ---
async function encryptPayload(key, payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        encodedPayload
    );

    return {
        ciphertext: ciphertext,
        iv: iv
    };
}

// --- 5. Decryption (AES-GCM) ---
async function decryptPayload(key, iv, ciphertext) {
    const decryptedBytes = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        ciphertext
    );

    const decodedPayload = new TextDecoder().decode(decryptedBytes);
    return JSON.parse(decodedPayload);
}

// --- Worker Message Handler ---
self.addEventListener('message', async (event) => {
    const { action, payload, key, iv, ciphertext, privateKey, publicKey, sharedSecretBits } = event.data;

    try {
        if (action === 'encrypt') {
            const result = await encryptPayload(key, payload);
            self.postMessage({ action: 'encrypt_result', success: true, ...result });

        } else if (action === 'decrypt') {
            const result = await decryptPayload(key, iv, ciphertext);
            self.postMessage({ action: 'decrypt_result', success: true, payload: result });

        } else if (action === 'generateKeyPair') {
            const keyPair = await generateKeyPair();
            self.postMessage({ action: 'generateKeyPair_result', success: true, keyPair });

        } else if (action === 'deriveSharedSecret') {
            const sharedSecret = await deriveSharedSecret(privateKey, publicKey);
            self.postMessage({ action: 'deriveSharedSecret_result', success: true, sharedSecret });

        } else if (action === 'deriveMessageKey') {
            const messageKey = await deriveMessageKey(sharedSecretBits);
            self.postMessage({ action: 'deriveMessageKey_result', success: true, messageKey });

        } else {
            self.postMessage({ action: 'error', success: false, error: 'Unknown action' });
        }
    } catch (error) {
        self.postMessage({ action: 'error', success: false, error: error.message });
    }
});
