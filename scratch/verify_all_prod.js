const https = require('https');
const files = ['crypto.js', 'chat_core.js', 'messenger_app.js'];
const checks = {
    'crypto.js': [
        { label: 'extractable: true (wrapKey fix)', pattern: 'true,               // ← extractable: true' },
        { label: 'wrapKey in generateKeyPair', pattern: 'wrapKey' },
        { label: 'window.CryptoManager export', pattern: 'window.CryptoManager = CryptoManager' },
    ],
    'chat_core.js': [
        { label: 'window.CryptoManager (no bare)', pattern: 'window.CryptoManager.decryptMessage' },
        { label: 'edit-banner null guard', pattern: 'if (editBanner)' },
    ],
    'messenger_app.js': [
        { label: '/api/me BEFORE ensureKeys', pattern: 'Load user profile FIRST' },
    ],
};

let completed = 0;
files.forEach(file => {
    https.get(`https://skuf-net.ru/${file}`, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
            console.log(`\n=== ${file} (${r.statusCode}) ===`);
            (checks[file] || []).forEach(c => {
                const ok = d.includes(c.pattern);
                console.log(`  ${ok ? '✅' : '❌'} ${c.label}`);
            });
            if (++completed === files.length) console.log('\n🏁 Проверка завершена.');
        });
    }).on('error', e => console.error(`❌ ${file}: ${e.message}`));
});
