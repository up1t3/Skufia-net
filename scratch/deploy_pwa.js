#!/usr/bin/env node
/**
 * Deploy PWA fixes + verify all 3 previous fixes
 */
require('dotenv').config();
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const REMOTE_BASE = '/opt/skufia/frontend';
const LOCAL_BASE = path.join(__dirname, '..', 'frontend');

const FILES_TO_UPLOAD = [
  'style.css',
  'app.js',
  'index.html',
  'manifest.json',
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

  // Upload all files
  sftp((sftp) => {
    let remaining = FILES_TO_UPLOAD.length;
    
    FILES_TO_UPLOAD.forEach(filename => {
      const local = path.join(LOCAL_BASE, filename);
      const remote = `${REMOTE_BASE}/${filename}`;
      
      sftp.fastPut(local, remote, (err) => {
        if (err) {
          console.error(`  ❌ Failed: ${filename}`, err.message);
        } else {
          console.log(`  ✅ Uploaded: ${remote}`);
        }
        remaining--;
        if (remaining === 0) {
          // Verify new backend endpoints and restart if needed
          const checks = [
            // Check all 3 previous fixes still in frontend
            `grep -c 'chat/private' ${REMOTE_BASE}/app.js`,
            `grep -c 'room-delete-btn' ${REMOTE_BASE}/app.js`,
            `grep -c 'me/avatar/upload' ${REMOTE_BASE}/app.js`,
            // Check new PWA fixes
            `grep -c 'visualViewport' ${REMOTE_BASE}/app.js`,
            `grep -c 'pushState' ${REMOTE_BASE}/app.js`,
            `grep -c '\\-\\-app-height' ${REMOTE_BASE}/style.css`,
            `grep -c 'display_override' ${REMOTE_BASE}/manifest.json`,
            // Backend endpoints
            `docker exec skufia-api grep -c 'leave_or_delete_room\\|upload_avatar_file' /opt/skufia/backend/routes.py 2>/dev/null || echo 0`,
          ];
          
          const labels = [
            'Fix 1 (/chat/private endpoint)',
            'Fix 2 (room-delete-btn)',
            'Fix 3 (avatar upload)',
            'PWA: visualViewport listener',
            'PWA: pushState history nav',
            'PWA: --app-height CSS var',
            'PWA: display_override manifest',
            'Backend: delete_room + upload_avatar',
          ];
          
          let ci = 0;
          const runCheck = () => {
            if (ci >= checks.length) {
              console.log('\n✅ All checks done!');
              conn.end();
              return;
            }
            conn.exec(checks[ci], (err, stream) => {
              let out = '';
              stream.on('data', d => out += d);
              stream.stderr.on('data', d => out += d);
              stream.on('close', () => {
                const val = parseInt(out.trim());
                const ok = val > 0;
                console.log(`  ${ok ? '✅' : '❌'} ${labels[ci]}: ${out.trim()}`);
                ci++;
                runCheck();
              });
            });
          };
          
          console.log('\n📋 Verification:\n');
          runCheck();
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
