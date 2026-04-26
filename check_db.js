'use strict';
require('dotenv').config();
const { Client } = require('ssh2');

const CONFIG = {
  host: process.env.SERVER_IP,
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD
};

const conn = new Client();
conn.on('ready', () => {
  conn.exec('docker exec skufia-postgres psql -U postgres -d skufia -c "SELECT * FROM users;"', (err, stream) => {
    if (err) throw err;
    let out = '';
    stream.on('close', (code, signal) => {
      console.log(out);
      conn.end();
    }).on('data', (data) => {
      out += data;
    }).stderr.on('data', (data) => {
      console.error('STDERR: ' + data);
    });
  });
}).on('error', (err) => {
  console.error('SSH Error:', err);
}).connect(CONFIG);
