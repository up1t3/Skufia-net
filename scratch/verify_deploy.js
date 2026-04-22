#!/usr/bin/env node
require('dotenv').config();
const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const checks = [
    // Check 1: New backend endpoints exist
    `docker exec skufia-api python -c "import routes; fns=[f for f in dir(routes) if 'delete_room' in f or 'upload_avatar' in f]; print('Backend endpoints:', fns)"`,
    // Check 2: Frontend app.js has /chat/private call
    `grep -c 'chat/private' /opt/skufia/frontend/app.js`,
    // Check 3: Frontend has room-delete-btn
    `grep -c 'room-delete-btn' /opt/skufia/frontend/app.js`,
    // Check 4: Frontend previewAvatar uploads
    `grep -c 'me/avatar/upload' /opt/skufia/frontend/app.js`,
  ];
  
  let i = 0;
  const runNext = () => {
    if (i >= checks.length) { conn.end(); return; }
    const cmd = checks[i++];
    conn.exec(cmd, (err, stream) => {
      if (err) { console.log('ERR:', err.message); runNext(); return; }
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => out += '[STDERR]' + d);
      stream.on('close', () => {
        console.log(`✅ Check ${i}: ${out.trim()}`);
        runNext();
      });
    });
  };
  runNext();
}).connect({
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  readyTimeout: 15000,
});
