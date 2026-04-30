#!/usr/bin/env node
const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    conn.exec('docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}"', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
              .on('data', d => process.stdout.write(d))
              .stderr.on('data', d => process.stderr.write(d));
    });
}).connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 30000
});
