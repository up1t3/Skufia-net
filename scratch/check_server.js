require('dotenv').config();
const {Client} = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const cmd = [
        'echo "=== chat_core.js check ==="',
        'docker exec skufia-web grep "ЗАШИФРОВАНО" /usr/share/nginx/html/chat_core.js | head -5',
        'echo "---"',
        'docker exec skufia-web grep "Зашифрованное сообщение" /usr/share/nginx/html/chat_core.js | head -5',
        'echo "=== SW version ==="',
        'docker exec skufia-web head -1 /usr/share/nginx/html/chat-sw.js',
    ].join('; ');
    conn.exec(cmd, (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.stderr.on('data', d => out += d);
        stream.on('close', () => { console.log(out); conn.end(); });
    });
});
conn.connect({ host: process.env.SERVER_IP, port: 22, username: 'root', password: process.env.SERVER_PASSWORD });
