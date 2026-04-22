#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { Client } = require('ssh2');

const SERVER = {
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
};

function runSSH(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream
        .on('close', () => resolve(out))
        .on('data', (d) => { out += d; })
        .stderr.on('data', (d) => { out += d; });
    });
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect(SERVER);
  });
  console.log('=== Connected ===\n');

  console.log('--- Docker Containers ---');
  console.log(await runSSH(conn, 'docker ps -a'));

  console.log('\n--- Backend Logs (last 50) ---');
  console.log(await runSSH(conn, 'docker logs --tail 50 skufia-api 2>&1'));

  console.log('\n--- Disk Space ---');
  console.log(await runSSH(conn, 'df -h /'));

  conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
