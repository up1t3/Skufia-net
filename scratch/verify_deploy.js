const https = require('https');
https.get('https://skuf-net.ru/crypto.js', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
        console.log('wrapKey present:', d.includes('wrapKey'));
        console.log('window.CryptoManager present:', d.includes('window.CryptoManager'));
        console.log('user.id guard present:', d.includes("state.user.id !== 'null'"));
    });
}).on('error', e => console.error(e));
