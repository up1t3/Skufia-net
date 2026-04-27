const fs = require('fs');
let code = fs.readFileSync('frontend/app.js', 'utf8');
const startTag = "navigator.serviceWorker.addEventListener('message'";
const endTag = "// Push Notifications Logic";

const startIdx = code.indexOf(startTag);
if (startIdx !== -1) {
    let before = code.substring(0, startIdx);
    // Find the end of the block
    let rest = code.substring(startIdx);
    let endIdx = rest.indexOf(endTag);
    if (endIdx !== -1) {
        let after = rest.substring(endIdx);
        // Replace the block
        let replacement = `let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });

            function showUpdateBanner(worker) {
                const banner = document.getElementById('pwa-update-banner');
                const btn = document.getElementById('pwa-update-btn');
                if (banner && btn) {
                    banner.style.display = 'flex';
                    btn.onclick = () => {
                        banner.style.display = 'none';
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    };
                }
            }

            navigator.serviceWorker.ready.then(reg => {
                if (reg.waiting) {
                    showUpdateBanner(reg.waiting);
                }
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateBanner(newWorker);
                        }
                    });
                });
            });
        }
    }

    `;
        
        // Remove the preceding comments from before
        let beforeTrimmed = before.replace(/\/\/ Auto-reload when a new SW activates with a fresh cache\s*\/\/ This prevents the PWA from running stale broken JS after an update\s*$/, '');
        
        let newCode = beforeTrimmed + replacement + after;
        fs.writeFileSync('frontend/app.js', newCode);
        console.log("Patched app.js successfully");
    } else {
        console.log("end tag not found");
    }
} else {
    console.log("start tag not found");
}
