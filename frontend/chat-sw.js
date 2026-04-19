const CACHE_NAME = 'skufia-chat-v14';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];


self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force the waiting service worker to become the active service worker.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

self.addEventListener('fetch', (event) => {
    // Only intercept GET requests
    if (event.request.method !== 'GET') return;

    // Skip WebSockets or API calls
    if (event.request.url.includes('/ws/') || event.request.url.includes('/chat/upload_audio')) return;

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                // Not in cache - fetch from network
                return fetch(event.request).then(
                    (networkResponse) => {
                        // Check if valid response
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                            return networkResponse;
                        }

                        // Clone response and add to cache
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return networkResponse;
                    }
                ).catch(() => {
                    // Fallback for offline if not in cache (could return an offline HTML page if we had one)
                    console.log('Fetch failed, maybe offline.');
                });
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    const cacheAllowlist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheAllowlist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
// --- Push Notification Listeners ---

self.addEventListener('push', function(event) {
    console.log('[Service Worker] Push Received.');
    console.log(`[Service Worker] Push had this data: "${event.data.text()}"`);

    let title = 'Skufia Notification';
    let options = {
        body: 'New message',
        icon: '/favicon.png', // Assuming favicon.png exists as seen in ls -la
        badge: '/favicon.png'
    };

    if (event.data) {
        try {
            const data = event.data.json();
            title = data.title || title;
            options.body = data.body || options.body;
            if (data.icon) options.icon = data.icon;
            if (data.badge) options.badge = data.badge;
            if (data.data) options.data = data.data; // Custom payload data
        } catch (e) {
            // If not JSON, use the text as body
            options.body = event.data.text();
        }
    }

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
    console.log('[Service Worker] Notification click Received.');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // If a window is already open, focus it
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('/chat.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow) {
                return clients.openWindow('/chat.html');
            }
        })
    );
});

self.addEventListener('pushsubscriptionchange', function(event) {
    console.log('[Service Worker]: \'pushsubscriptionchange\' event fired.');
    // Logic to re-subscribe and send the new subscription to the server
    const applicationServerKey = 'YOUR_PUBLIC_VAPID_KEY_HERE'; // Ideally fetched or injected
    event.waitUntil(
        self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        })
        .then(function(newSubscription) {
            console.log('[Service Worker] New subscription: ', newSubscription);
            // Send the new subscription details to the server using fetch()
            // e.g., fetch('/api/subscribe', { method: 'POST', body: JSON.stringify(newSubscription) })
        })
    );
});
