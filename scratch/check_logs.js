#!/usr/bin/env node
require('dotenv').config();
const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
    conn.exec('docker logs skufia-api-green --tail 200 2>&1 | tail -60', (err, stream) => {
        if (err) { console.error(err); conn.end(); return; }
        let output = '';
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', d => { output += d.toString(); });
        stream.on('close', () => {
            console.log(output);
            conn.end();
        });
    });
}).connect({
    host: '147.45.245.133',
    port: 22,
    username: 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 10000
});
