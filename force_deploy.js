require('dotenv').config();
const {Client} = require('ssh2'); 
const conn = new Client(); 
conn.on('ready', () => { 
    console.log('Connected to server. Running docker compose up --build -d ...');
    conn.exec('cd /opt/skufia && docker compose -f docker-compose.production.yml build && docker compose -f docker-compose.production.yml up -d', (err, stream) => { 
        stream.on('close', () => { console.log('Deployment finished.'); conn.end(); }).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d)); 
    }); 
}).connect({host: process.env.SERVER_IP || '147.45.245.133', username: process.env.SERVER_USER || 'root', password: process.env.SERVER_PASSWORD});
