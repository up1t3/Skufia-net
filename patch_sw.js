const fs = require('fs');
let code = fs.readFileSync('frontend/chat-sw.js', 'utf8');

// Remove skipWaiting from install event
code = code.replace(/self\.skipWaiting\(\);\s*\/\/[^\n]*/g, '');

// Remove the client broadcast for 'SW_UPDATED' from activate event
// The lines are:
/*
        }).then(() => {
            // Notify all open PWA windows to reload so they pick up fresh assets
            return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }));
            });
*/
code = code.replace(/\}\)\.then\(\(\) => \{\s*\/\/\s*Notify all open PWA windows to reload so they pick up fresh assets\s*return self\.clients\.matchAll\(\{ type: 'window', includeUncontrolled: true \}\)\.then\(clientList => \{\s*clientList\.forEach\(client => client\.postMessage\(\{ type: 'SW_UPDATED', version: CACHE_NAME \}\)\);\s*\}\);\s*\}\)/g, '');

// Add the message event listener for SKIP_WAITING at the end of the file
const messageListener = `

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
`;

code += messageListener;

fs.writeFileSync('frontend/chat-sw.js', code);
console.log("Patched chat-sw.js successfully");
