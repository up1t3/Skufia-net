const fs = require('fs');
let lines = fs.readFileSync('frontend/app.js', 'utf8').split('\n');
const start = lines.findIndex(l => l.includes("navigator.serviceWorker.addEventListener('message', (event) => {"));
const end = lines.findIndex((l, i) => i > start && l.trim() === "}");
if (start !== -1 && end !== -1) {
    const newCode = \            let refreshing = false;
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
            });\;
    lines.splice(start, end - start + 1, newCode);
    fs.writeFileSync('frontend/app.js', lines.join('\n'));
    console.log("Patched successfully");
} else {
    console.log("Could not find block", start, end);
}
