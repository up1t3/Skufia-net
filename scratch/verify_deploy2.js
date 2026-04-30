const https = require('https');
https.get('https://skuf-net.ru/chat_core.js', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
        const bare = (d.match(/(?<!window\.)CryptoManager\./g) || []).length;
        const windowed = (d.match(/window\.CryptoManager\./g) || []).length;
        console.log('Bare CryptoManager. references:', bare);
        console.log('window.CryptoManager. references:', windowed);
    });
}).on('error', e => console.error(e));
