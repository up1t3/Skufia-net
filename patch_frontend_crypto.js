#!/usr/bin/env node
/**
 * Hot-patch: обновляет crypto.js и chat_core.js на production-сервере
 * через SFTP + docker cp в nginx-контейнер.
 */
const fs = require('fs');
const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
const ip = process.env.SERVER_IP || '147.45.245.133';
const pwd = process.env.SERVER_PASSWORD;

// Files to deploy
const files = [
    { local: 'frontend/crypto.js', remote: '/tmp/crypto.js', container: '/usr/share/nginx/html/crypto.js' },
    { local: 'frontend/chat_core.js', remote: '/tmp/chat_core.js', container: '/usr/share/nginx/html/chat_core.js' },
    { local: 'frontend/messenger_app.js', remote: '/tmp/messenger_app.js', container: '/usr/share/nginx/html/messenger_app.js' },
    { local: 'frontend/messenger.html', remote: '/tmp/messenger.html', container: '/usr/share/nginx/html/messenger.html' },
    { local: 'frontend/ui.js', remote: '/tmp/ui.js', container: '/usr/share/nginx/html/ui.js' },
];

console.log('🚀 Frontend Hot-Patch: crypto.js + chat_core.js');
console.log(`🔌 Connecting to ${ip}...`);

conn.on('ready', async () => {
    console.log('✅ SSH connected.');

    // Step 1: Upload files via SFTP
    try {
        const sftp = await new Promise((resolve, reject) => {
            conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
        });

        for (const f of files) {
            console.log(`📤 Uploading ${f.local} → ${f.remote}`);
            await new Promise((resolve, reject) => {
                sftp.fastPut(f.local, f.remote, (err) => err ? reject(err) : resolve());
            });
        }
        console.log('✅ All files uploaded via SFTP.');

        // Step 2: docker cp into frontend container
        const script = [
            'FRONTEND=skufia-web',
            'echo "📦 Frontend container: $FRONTEND"',
            ...files.map(f => `docker cp ${f.remote} $FRONTEND:${f.container} && echo "  ✅ ${f.local}"`),
            ...files.map(f => `rm -f ${f.remote}`),
            'echo "🎉 Hot-patch complete!"',
        ].join('\n');

        conn.exec(script, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code) => {
                console.log(code === 0 ? '🎉 Hot-patch successful!' : `⚠️ Exit code: ${code}`);
                conn.end();
            }).on('data', (data) => {
                process.stdout.write(data);
            }).stderr.on('data', (data) => {
                process.stderr.write(data);
            });
        });
    } catch (e) {
        console.error('❌ Error:', e.message);
        conn.end();
    }
}).connect({
    host: ip,
    port: 22,
    username: 'root',
    password: pwd,
    readyTimeout: 30000
});
