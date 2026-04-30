const fs = require('fs');
let code = fs.readFileSync('frontend/chat-sw.js', 'utf8');

code = code.replace(/self\.addEventListener\('activate'[\s\S]*?\}\);/, `self.addEventListener('activate', (event) => {
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
        })
    );
});`);

fs.writeFileSync('frontend/chat-sw.js', code);
console.log("Fixed chat-sw.js activate event");
