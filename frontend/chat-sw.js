const CACHE_NAME = 'skufia-chat-v2.1.8_01.05_13:00'; // Bumped for robust cache-busting during install
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
    self.skipWaiting(); // Force new service worker to take over immediately
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async (cache) => {
                console.log('Opened cache, forcing fresh fetch for assets...');
                // Manually fetch each asset with cache: 'no-cache' to avoid getting stale versions from HTTP cache
                for (const asset of ASSETS_TO_CACHE) {
                    try {
                        const response = await fetch(new Request(asset, { cache: 'no-cache' }));
                        if (response.ok) {
                            await cache.put(asset, response);
                        }
                    } catch (err) {
                        console.warn(`Failed to cache ${asset} during install:`, err);
                    }
                }
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
            return self.clients.claim().then(() => {
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
                    });
                });
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

self.addEventListener('push', function(event) {
    console.log('[Service Worker] Push Received.');

    let title = 'SKUFenger';
    let options = {
        body: 'Новое сообщение',
        icon: '/favicon.png',
        badge: '/favicon.png',
        vibrate: [200, 100, 200],
        tag: 'skufia-msg',
        renotify: true
    };

    let isCall = false;

    if (event.data) {
        try {
            const data = event.data.json();
            title = data.title || title;
            options.body = data.body || options.body;
            if (data.icon) options.icon = data.icon;
            if (data.badge) options.badge = data.badge;
            if (data.data) {
                options.data = data.data;
                // For calls - use different tag and vibration
                if (data.data.action === 'call') {
                    isCall = true;
                    options.tag = 'skufia-call';
                    // Имитация длинного звонка (вибрация 1 сек, пауза 1 сек - 15 раз = 30 секунд звонка)
                    options.vibrate = Array(15).fill([1000, 1000]).flat();
                    options.requireInteraction = true; // Keep visible until user acts
                    options.silent = false; // Убеждаемся, что звук не заглушен
                    options.actions = [
                        { action: 'accept', title: '✅ Ответить' },
                        { action: 'decline', title: '❌ Отклонить' }
                    ];
                } else {
                    options.tag = `skufia-room-${data.data.roomId || 'msg'}`;
                }
            }
        } catch (e) {
            options.body = event.data.text();
        }
    }

    // Don't show message notifications if app is in focus (calls always show)
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (!isCall) {
                const hasFocused = clientList.some(c => c.focused);
                if (hasFocused) {
                    console.log('[SW] App is focused, skipping message notification.');
                    return; // App is open and active — WS will handle it
                }
            }
            return self.registration.showNotification(title, options);
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    console.log('[Service Worker] Notification click Received.');
    event.notification.close();

    const notifData = event.notification.data || {};

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('/messenger.html') && 'focus' in client) {
                    // Notify the app about the notification click
                    client.postMessage({ type: 'NOTIFICATION_CLICK', data: notifData, action: event.action });
                    return client.focus();
                }
            }
            // No window open - open messenger
            if (clients.openWindow) {
                let url = notifData.roomId ? `/messenger.html#room=${notifData.roomId}` : '/messenger.html';
                
                if (notifData.action === 'call') {
                    if (event.action === 'decline') {
                        // User declined and app is closed -> let server timeout handle the missed call
                        return;
                    }
                    // If accepted, action=accept. If just clicked the notification body, action=open
                    const act = event.action === 'accept' ? 'accept' : 'open';
                    url = `/messenger.html#call_action=${act}&caller_id=${notifData.sender_id}`;
                }
                
                return clients.openWindow(url);
            }
        })
    );
});

self.addEventListener('pushsubscriptionchange', function(event) {
    console.log('[Service Worker]: pushsubscriptionchange event fired.');
    event.waitUntil(
        // Fetch VAPID key dynamically from server
        fetch('/api/notifications/vapidPublicKey')
            .then(r => r.json())
            .then(data => {
                const padding = '='.repeat((4 - data.publicKey.length % 4) % 4);
                const base64 = (data.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
                const rawData = atob(base64);
                const applicationServerKey = Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));

                return self.registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });
            })
            .then(newSubscription => {
                console.log('[Service Worker] Re-subscribed:', newSubscription);
                // Send updated subscription to server
                return fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: newSubscription.endpoint,
                        keys: {
                            p256dh: btoa(String.fromCharCode(...new Uint8Array(newSubscription.getKey('p256dh')))),
                            auth: btoa(String.fromCharCode(...new Uint8Array(newSubscription.getKey('auth'))))
                        }
                    })
                });
            })
            .catch(err => console.error('[SW] pushsubscriptionchange error:', err))
    );
});


self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
