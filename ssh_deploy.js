require('dotenv').config();
const { Client } = require('ssh2');

const config = {
    host: process.env.SERVER_IP,
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD
};

if (!config.password) {
    console.error('ERROR: SERVER_PASSWORD not set');
    process.exit(1);
}

const conn = new Client();
conn.on('ready', () => {
  console.log('Client :: ready');
  conn.exec(`cd /opt/skufia && git reset --hard && git pull && export VERSION="v2.1.8_01.05_13:00" && node -e "const fs=require('fs'); let c=fs.readFileSync('frontend/chat-sw.js','utf8'); c=c.replace(/const CACHE_NAME = '[^']+';/, \\"const CACHE_NAME = 'skufia-chat-\\"+process.env.VERSION+\\"';\\"); fs.writeFileSync('frontend/chat-sw.js',c);" && cd frontend && docker build --no-cache -t skufia-frontend:latest . && docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest && cd /opt/skufia/backend && docker build --no-cache -t skufia-backend:latest . && docker tag skufia-backend:latest ghcr.io/up1t3/skufia-backend:latest && cd /opt/skufia && docker compose -f docker-compose.production.yml up -d`, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
      conn.end();
    }).on('data', (data) => {
      console.log('STDOUT: ' + data);
    }).stderr.on('data', (data) => {
      console.log('STDERR: ' + data);
    });
  });
}).connect(config);
