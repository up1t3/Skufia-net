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
export VERSION="v2.1_$(TZ=Europe/Moscow date +'%d.%m_%H:%M')"
echo "=== Deploying version: $VERSION ==="

# Update CACHE_NAME in chat-sw.js
sed -i -E "s/const CACHE_NAME = '[^']+';/const CACHE_NAME = 'skufia-chat-$VERSION';/" frontend/chat-sw.js

# Update version in index.html footer
sed -i -E "s/id=\\"app-version\\">[^<]*/id=\\"app-version\\">$VERSION/" frontend/index.html

# Update version in messenger.html settings
sed -i -E "s/(id=\\"app-version-tag\\"[^>]*>)[^<]+(<\\/span>)/\\\\1$VERSION\\\\2/" frontend/messenger.html

cd frontend
docker build -t skufia-frontend:latest .
docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest
cd /opt/skufia
docker stop skufia-web || true
docker rm skufia-web || true
docker compose -f docker-compose.production.yml up -d frontend
echo "=== DEPLOY COMPLETE: $VERSION ==="
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
