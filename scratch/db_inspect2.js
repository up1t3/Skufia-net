#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');

const conn = new Client();

// Focused queries on the real users and their private rooms
const QUERIES = [
  {
    label: 'Message counts (total / encrypted / plaintext)',
    sql: `SELECT COUNT(*) AS total, COUNT(CASE WHEN encryption_iv IS NOT NULL AND encryption_iv <> '' THEN 1 END) AS encrypted, COUNT(CASE WHEN encryption_iv IS NULL OR encryption_iv = '' THEN 1 END) AS plaintext FROM messages`
  },
  {
    label: 'Room key bundles state (private rooms only)',
    sql: `SELECT rkb.room_id, cr.room_type, rkb.key_version, u.username, u.id as user_id, CASE WHEN u.public_key IS NOT NULL THEN 'YES' ELSE 'NO' END as has_pubkey FROM room_key_bundles rkb JOIN users u ON u.id = rkb.user_id JOIN chat_rooms cr ON cr.id = rkb.room_id WHERE cr.room_type = 'private' ORDER BY rkb.room_id, rkb.key_version`
  },
  {
    label: 'Private rooms with real users (id 141-163)',
    sql: `SELECT cr.id as room_id, cr.room_type, array_agg(u.username ORDER BY u.id) as members, array_agg(crm.user_id ORDER BY u.id) as member_ids FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id JOIN users u ON u.id = crm.user_id WHERE cr.room_type = 'private' AND crm.user_id BETWEEN 141 AND 163 GROUP BY cr.id, cr.room_type ORDER BY cr.id`
  },
  {
    label: 'Encrypted messages in rooms 101 and 105 (sample)',
    sql: `SELECT id, sender_id, length(content) as content_len, length(encryption_iv) as iv_len, created_at FROM messages WHERE room_id IN (101, 105) AND encryption_iv IS NOT NULL AND encryption_iv <> '' ORDER BY created_at DESC LIMIT 10`
  }
];

function runSSH(conn, sql) {
  return new Promise((resolve, reject) => {
    const safe = sql.replace(/\n\s+/g, ' ');
    const cmd = `docker exec skufia-postgres psql -U postgres -d skufia -c '${safe}'`;
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => resolve(out + (errOut ? '\nSTDERR: ' + errOut : '')))
        .on('data', d => { out += d; })
        .stderr.on('data', d => { errOut += d; });
    });
  });
}

conn.on('ready', async () => {
  console.log('SSH connected\n');
  for (const q of QUERIES) {
    console.log('='.repeat(60));
    console.log('>> ' + q.label);
    console.log('-'.repeat(60));
    const result = await runSSH(conn, q.sql).catch(e => 'ERROR: ' + e.message);
    console.log(result);
  }
  conn.end();
}).on('error', e => console.error('SSH Error:', e.message))
  .connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 20000,
  });
