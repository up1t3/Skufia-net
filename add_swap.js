require('dotenv').config();
const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile || echo "Swap already exists or failed"', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end()).on('data', d => console.log(d.toString()));
    });
}).connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD
});
