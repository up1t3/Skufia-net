#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');

const conn = new Client();

const QUERIES = [
  {
    label: 'Message counts',
    sql: `SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE encryption_iv IS NOT NULL AND encryption_iv != '') AS encrypted,
  COUNT(*) FILTER (WHERE encryption_iv IS NULL OR encryption_iv = '') AS plaintext
FROM messages;`
  },
  {
    label: 'Room key bundles (private rooms only)',
    sql: `SELECT rkb.room_id, cr.room_type, rkb.key_version, u.username,
  CASE WHEN u.public_key IS NOT NULL THEN 'HAS_KEY' ELSE 'NO_KEY' END as pubkey_status
FROM room_key_bundles rkb
JOIN users u ON u.id = rkb.user_id
JOIN chat_rooms cr ON cr.id = rkb.room_id
WHERE cr.room_type = 'private'
ORDER BY rkb.room_id, rkb.key_version;`
  },
  {
    label: 'Private rooms between real users (141-163)',
    sql: `SELECT cr.id as room_id,
  string_agg(u.username, ', ' ORDER BY u.id) as members,
  string_agg(crm.user_id::text, ', ' ORDER BY u.id) as member_ids
FROM chat_rooms cr
JOIN chat_room_members crm ON crm.room_id = cr.id
JOIN users u ON u.id = crm.user_id
WHERE cr.room_type = 'private' AND crm.user_id BETWEEN 141 AND 163
GROUP BY cr.id
ORDER BY cr.id;`
  },
  {
    label: 'Sample encrypted messages in rooms 101 and 105',
    sql: `SELECT id, sender_id, room_id,
  length(content) as content_len,
  length(encryption_iv) as iv_len,
  created_at
FROM messages
WHERE room_id IN (101, 105)
  AND encryption_iv IS NOT NULL
  AND encryption_iv != ''
ORDER BY created_at DESC LIMIT 10;`
  },
  {
    label: 'Key version mismatch: msgs encrypted before key rotation',
    sql: `SELECT m.room_id, rkb.key_version, rkb.updated_at as key_updated,
  COUNT(m.id) as msgs_before_rotation
FROM messages m
JOIN room_key_bundles rkb ON rkb.room_id = m.room_id
WHERE m.encryption_iv IS NOT NULL AND m.encryption_iv != ''
  AND m.created_at < rkb.updated_at
GROUP BY m.room_id, rkb.key_version, rkb.updated_at
ORDER BY m.room_id;`
  }
];

function runQuery(conn, sql) {
  return new Promise((resolve, reject) => {
    // Use echo + pipe to avoid quoting hell
    conn.exec('docker exec -i skufia-postgres psql -U postgres -d skufia', (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', () => resolve({ out, errOut }))
        .on('data', d => { out += d; })
        .stderr.on('data', d => { errOut += d; });
      stream.write(sql + '\n');
      stream.end();
    });
  });
}

conn.on('ready', async () => {
  console.log('SSH connected\n');
  for (const q of QUERIES) {
    console.log('='.repeat(65));
    console.log('>> ' + q.label);
    console.log('-'.repeat(65));
    const { out, errOut } = await runQuery(conn, q.sql).catch(e => ({ out: '', errOut: e.message }));
    if (errOut && errOut.trim()) console.error('STDERR:', errOut.trim());
    console.log(out);
  }
  conn.end();
  console.log('Done.');
}).on('error', e => console.error('SSH Error:', e.message))
  .connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 20000,
  });
