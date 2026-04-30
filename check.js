require('dotenv').config();
const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
    conn.exec('grep "app-version" /opt/skufia/frontend/index.html', (err, stream) => {
        stream.on('data', d => console.log(d.toString())).on('close', () => conn.end());
    });
}).connect({
    host: '147.45.245.133',
    port: 22,
    username: 'root',
    password: process.env.SERVER_PASSWORD
});
