const fs = require('fs');

const filepath = 'chat-sw.js';
let content = fs.readFileSync(filepath, 'utf-8');

// 1. Update version to v37 to trigger update
content = content.replace("const CACHE_NAME = 'skufia-chat-v36';", "const CACHE_NAME = 'skufia-chat-v37';");

// 2. Add activate event listener to delete old caches and claim clients
const activateCode = `
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
        })
    );
});
`;

// Insert the activate event right before the fetch event
content = content.replace("self.addEventListener('fetch',", activateCode + "\nself.addEventListener('fetch',");

fs.writeFileSync(filepath, content, 'utf-8');
console.log("chat-sw.js patched successfully.");
