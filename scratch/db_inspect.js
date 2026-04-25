#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');

const conn = new Client();

const QUERIES = [
  {
    label: '1. Messages: total / encrypted / plaintext',
    sql: `SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN encryption_iv IS NOT NULL AND encryption_iv <> '' THEN 1 END) AS encrypted,
      COUNT(CASE WHEN encryption_iv IS NULL OR encryption_iv = '' THEN 1 END) AS plaintext
    FROM messages;`
  },
  {
    label: '2. room_key_bundles: per room / key_version',
    sql: `SELECT room_id, key_version, COUNT(*) AS users_with_key 
    FROM room_key_bundles 
    GROUP BY room_id, key_version 
    ORDER BY room_id;`
  },
  {
    label: '3. Private rooms with encrypted messages (mismatch check)',
    sql: `SELECT 
      m.room_id,
      cr.room_type,
      COUNT(m.id) AS encrypted_msg_count,
      MAX(m.created_at) AS last_msg,
      COUNT(DISTINCT rkb.id) AS key_bundle_entries
    FROM messages m
    JOIN chat_rooms cr ON cr.id = m.room_id
    LEFT JOIN room_key_bundles rkb ON rkb.room_id = m.room_id
    WHERE m.encryption_iv IS NOT NULL AND m.encryption_iv <> ''
    GROUP BY m.room_id, cr.room_type
    ORDER BY m.room_id;`
  },
  {
    label: '4. Users & their public keys (E2EE readiness)',
    sql: `SELECT 
      id, username,
      CASE WHEN public_key IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_pubkey,
      handle
    FROM users
    ORDER BY id;`
  }
];

function runSSH(conn, sql) {
  return new Promise((resolve, reject) => {
    const cmd = `docker exec skufia-postgres psql -U postgres -d skufia -c "${sql.replace(/\n\s+/g, ' ').replace(/"/g, '\\"')}"`;
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => {
          if (code !== 0) return reject(new Error(`Exit ${code}: ${errOut}`));
          resolve(out);
        })
        .on('data', d => { out += d; })
        .stderr.on('data', d => { errOut += d; });
    });
  });
}

conn.on('ready', async () => {
  console.log('✅ SSH connected to', process.env.SERVER_IP || '147.45.245.133');
  console.log('');

  for (const q of QUERIES) {
    console.log('═'.repeat(60));
    console.log('📊 ' + q.label);
    console.log('─'.repeat(60));
    try {
      const result = await runSSH(conn, q.sql);
      console.log(result);
    } catch (e) {
      console.error('  ❌ Error:', e.message);
    }
  }

  conn.end();
  console.log('✅ Done.');

}).on('error', (err) => {
  console.error('SSH Error:', err.message);
}).connect({
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  readyTimeout: 20000,
});
