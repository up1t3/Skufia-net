#!/usr/bin/env node
/**
 * E2EE Patch Script — без Docker rebuild
 * Копирует изменённые файлы и применяет миграцию БД
 */
'use strict';

require('dotenv').config();
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const SERVER = {
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  readyTimeout: 30000,
};

const REMOTE_DIR = '/opt/skufia';

function connectSSH() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject).connect(SERVER);
  });
}

function runSSH(conn, cmd) {
  const command = Array.isArray(cmd) ? cmd.join(' && ') : cmd;
  console.log(`\n🖥  SSH: ${command}`);
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream
        .on('close', (code) => {
          if (code !== 0) return reject(new Error(`Exit code ${code}`));
          resolve(out);
        })
        .on('data', (d) => { process.stdout.write(d); out += d; })
        .stderr.on('data', (d) => process.stderr.write(d));
    });
  });
}

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const content = fs.readFileSync(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('close', () => { console.log(`  ✅ Uploaded: ${remotePath}`); resolve(); });
      writeStream.on('error', reject);
      writeStream.end(content);
    });
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  🔐 Skufenger E2EE Patch              ║');
  console.log('╚══════════════════════════════════════╝\n');

  const conn = await connectSSH();
  console.log('✅ SSH connected to', SERVER.host);

  // 1. Upload changed backend files
  console.log('\n📦 Uploading backend files...');
  await uploadFile(conn,
    path.join(__dirname, 'backend', 'database.py'),
    `${REMOTE_DIR}/backend/database.py`
  );
  await uploadFile(conn,
    path.join(__dirname, 'backend', 'routes.py'),
    `${REMOTE_DIR}/backend/routes.py`
  );

  // 2. Upload changed frontend file
  console.log('\n📦 Uploading frontend files...');
  await uploadFile(conn,
    path.join(__dirname, 'frontend', 'app.js'),
    `${REMOTE_DIR}/frontend/app.js`
  );

  // 3. Apply DB migration
  console.log('\n🗄  Applying DB migration (creating room_key_bundles table)...');
  await runSSH(conn, [
    `docker exec skufia-api python -c "from database import init_db; init_db(); print('✅ Migration OK: room_key_bundles created')"`,
  ]);

  // 4. Restart backend to pick up new routes
  console.log('\n🔄 Restarting backend container...');
  await runSSH(conn, [`docker restart skufia-api`]);

  // 5. Wait for healthcheck
  await new Promise(r => setTimeout(r, 4000));
  console.log('\n🔍 Checking backend health...');
  const result = await runSSH(conn, `curl -s -o /dev/null -w "%{http_code}" http://localhost:8007/api/health || echo "no health"`);
  console.log('HTTP status:', result.trim().slice(-3));

  conn.end();
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  ✅ E2EE patch applied!               ║');
  console.log('║  Users must clear localStorage to    ║');
  console.log('║  re-generate their RSA key pair.     ║');
  console.log('╚══════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('❌ Patch failed:', err.message);
  process.exit(1);
});
