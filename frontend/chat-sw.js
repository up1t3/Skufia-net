const CACHE_NAME = 'skufia-chat-v1777337200000'; // Force re-cache with glassmorphism media modal
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/messenger.html',
    '/style.css',
    '/app.js',
    '/messenger_app.js',
    '/ui.js',
    '/api.js',
    '/crypto.js',
    '/features.js',
    '/chat_core.js',
    '/manifest.json',
    '/manifest-skufenger.json'
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


self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName.startsWith('skufia-chat-')) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        }).then(() => {
            // Notify all open PWA windows to reload so they pick up fresh assets
            return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }));
            });
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Only intercept GET requests
    if (event.request.method !== 'GET') return;

    // Skip WebSockets or API calls entirely (Fixes Unexpected token < in JSON)
    if (event.request.url.includes('/ws/') || event.request.url.includes('/api/')) return;
    
    // Only intercept http/https schemes (Fixes chrome-extension error)
    if (!event.request.url.startsWith('http')) return;

    // Determine if it's an HTML request
    const isHtml = event.request.headers.get('accept').includes('text/html');

    if (isHtml) {
        // Network First for HTML to ensure latest app.js and buttons are loaded
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                if (event.request.url.startsWith('http')) {
                    cache.put(event.request, responseClone);
                }
            });
                }
                return networkResponse;
            }).catch(() => {
                return caches.match(event.request);
            })
        );
    } else {
        // Apply Stale-While-Revalidate strategy for JS/CSS/Assets
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchedResponse = fetch(event.request).then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            if (event.request.url.startsWith('http')) {
                                cache.put(event.request, networkResponse.clone());
                            }
                        }
                        return networkResponse;
                    }).catch(() => {
                        console.log('Fetch failed, maybe offline.');
                    });
                    return cachedResponse || fetchedResponse;
                });
            })
        );
    }
});

// Second activate handler — deduplicated into the one above (no-op keep for safety)
// self.addEventListener('activate', ...) → merged above
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
