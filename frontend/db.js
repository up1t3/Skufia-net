const db = new Dexie("SkufNetDB");

db.version(1).stores({
    rooms: 'id, type, created_at',
    members: '[room_id+user_id], room_id, user_id, role',
    messages: 'id, client_msg_id, room_id, sender_id, [room_id+created_at], created_at'
});

// Version 2: Add audio cache store
db.version(2).stores({
    rooms: 'id, type, created_at',
    members: '[room_id+user_id], room_id, user_id, role',
    messages: 'id, client_msg_id, room_id, sender_id, [room_id+created_at], created_at',
    audio_cache: 'url, cached_at'
});

window.db = db;

/**
 * Cache an audio file locally in IndexedDB for offline playback.
 * Audio blobs are kept for 5 days locally (matching server TTL).
 * @param {string} url - Relative URL key (e.g., /api/uploads/voice/xxx.webm)
 * @param {string} fullUrl - Full URL to fetch the blob from
 */
window._cacheAudioLocally = async function(url, fullUrl) {
    try {
        // Check if already cached
        const existing = await db.audio_cache.get(url);
        if (existing && existing.blob) return; // already cached

        const resp = await fetch(fullUrl);
        if (!resp.ok) return;
        const blob = await resp.blob();

        await db.audio_cache.put({ url, blob, cached_at: Date.now() });
        console.log('[AudioCache] Cached:', url);

        // Clean up entries older than 5 days
        const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);
        await db.audio_cache.where('cached_at').below(fiveDaysAgo).delete();
    } catch(e) {
        console.warn('[AudioCache] Failed to cache:', url, e);
    }
};

/**
 * Get a cached audio blob URL, or return the original URL if not cached.
 * @param {string} url - Original relative URL
 * @param {string} fallback - Full URL to use as fallback
 * @returns {Promise<string>} - Object URL or fallback
 */
window._getAudioUrl = async function(url, fallback) {
    try {
        const entry = await db.audio_cache.get(url);
        if (entry && entry.blob) {
            return URL.createObjectURL(entry.blob);
        }
    } catch(e) { /* fall through */ }
    return fallback;
};
