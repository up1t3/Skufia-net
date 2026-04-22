#!/usr/bin/env node
/**
 * Deploy full stack updates (frontend + backend) and restart backend
 */
require('dotenv').config();
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const REMOTE_BASE_FRONTEND = '/opt/skufia/frontend';
const LOCAL_BASE_FRONTEND = path.join(__dirname, '..', 'frontend');
const REMOTE_BASE_BACKEND = '/opt/skufia/backend';
const LOCAL_BASE_BACKEND = path.join(__dirname, '..', 'backend');

const FILES_TO_UPLOAD = [
  { local: path.join(LOCAL_BASE_FRONTEND, 'style.css'), remote: `${REMOTE_BASE_FRONTEND}/style.css` },
  { local: path.join(LOCAL_BASE_FRONTEND, 'app.js'), remote: `${REMOTE_BASE_FRONTEND}/app.js` },
  { local: path.join(LOCAL_BASE_FRONTEND, 'index.html'), remote: `${REMOTE_BASE_FRONTEND}/index.html` },
  { local: path.join(LOCAL_BASE_FRONTEND, 'manifest.json'), remote: `${REMOTE_BASE_FRONTEND}/manifest.json` },
  { local: path.join(LOCAL_BASE_BACKEND, 'routes.py'), remote: `${REMOTE_BASE_BACKEND}/routes.py` },
  { local: path.join(LOCAL_BASE_BACKEND, 'database.py'), remote: `${REMOTE_BASE_BACKEND}/database.py` }
];

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ SSH connected\n');
  
  const sftp = (callback) => {
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP error:', err); conn.end(); return; }
      callback(sftp);
    });
  };

  sftp((sftp) => {
    let remaining = FILES_TO_UPLOAD.length;
    
    FILES_TO_UPLOAD.forEach(file => {
      sftp.fastPut(file.local, file.remote, (err) => {
        if (err) {
          console.error(`  ❌ Failed: ${file.local} -> ${file.remote}`, err.message);
        } else {
          console.log(`  ✅ Uploaded: ${file.remote}`);
        }
        remaining--;
        if (remaining === 0) {
            console.log('\n🔄 Restarting backend service...');
            conn.exec('docker restart skufia-api', (err, stream) => {
                let out = '';
                stream.on('data', d => out += d);
                stream.stderr.on('data', d => out += d);
                stream.on('close', () => {
                    console.log(`  Backend restart output: ${out.trim()}`);
                    console.log('✅ Full deploy complete!');
                    conn.end();
                });
            });
        }
      });
    });
  });
}).connect({
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  readyTimeout: 20000,
});
