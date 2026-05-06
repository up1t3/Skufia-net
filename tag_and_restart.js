require('dotenv').config();
const {Client} = require('ssh2'); 
const conn = new Client(); 
conn.on('ready', () => { 
    console.log('Connected. Rebuilding with correct GHCR tags...');
    const cmd = `
        set -e
        cd /opt/skufia
        git reset --hard
        git pull origin main
        cd /opt/skufia/frontend
        docker build -t ghcr.io/up1t3/skufia-frontend:latest .
        
        cd /opt/skufia/backend
        docker build -t ghcr.io/up1t3/skufia-backend:latest .
        
        cd /opt/skufia
        docker stop skufia-web skufia-api-blue skufia-api-green || true
        docker rm skufia-web skufia-api-blue skufia-api-green || true
        docker compose -f docker-compose.production.yml up -d frontend backend-blue backend-green
    `;
    conn.exec(cmd, (err, stream) => { 
        stream.on('close', () => { console.log('Done!'); conn.end(); }).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d)); 
    }); 
}).connect({host: process.env.SERVER_IP || '147.45.245.133', username: process.env.SERVER_USER || 'root', password: process.env.SERVER_PASSWORD});
