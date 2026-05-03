require('dotenv').config();
const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH Client :: ready');
    conn.exec(`
set -e
cd /opt/skufia
git fetch origin main
git reset --hard origin/main

export GIT_HASH=$(git rev-parse --short HEAD)
echo "=== Deploying BACKEND ==="

docker compose -f docker-compose.production.yml up -d --build backend-blue backend-green
echo "=== BACKEND DEPLOY COMPLETE ==="
    `, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
            conn.end();
        }).on('data', (data) => {
            process.stdout.write(data);
        }).stderr.on('data', (data) => {
            process.stderr.write(data);
        });
    });
}).connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD
});
