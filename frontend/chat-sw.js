const CACHE_NAME = 'skufia-chat-v25'; // Bumped version for auto-update
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

    // Skip WebSockets or API calls entirely (Fixes Unexpected token < in JSON)
    if (event.request.url.includes('/ws/') || event.request.url.includes('/api/')) return;

    // Apply Stale-While-Revalidate strategy for auto-updating application on launch
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchedResponse = fetch(event.request).then((networkResponse) => {
                    // Update cache for next time
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => {
                    console.log('Fetch failed, maybe offline.');
                });

                // Return cached response immediately if available, otherwise wait for network
                return cachedResponse || fetchedResponse;
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
