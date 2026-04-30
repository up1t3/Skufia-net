#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');

const conn = new Client();

const STEPS = [
  {
    label: 'Показать сообщения которые будут удалены',
    sql: `SELECT room_id, COUNT(*) as count FROM messages
          WHERE encryption_iv IS NOT NULL AND encryption_iv != ''
          GROUP BY room_id ORDER BY room_id;`
  },
  {
    label: 'Удалить зашифрованные сообщения',
    sql: `DELETE FROM messages
          WHERE encryption_iv IS NOT NULL AND encryption_iv != '';`
  },
  {
    label: 'Удалить старые room_key_bundles (будут пересозданы с новой схемой)',
    sql: `DELETE FROM room_key_bundles;`
  },
  {
    label: 'Проверка: остаток сообщений',
    sql: `SELECT COUNT(*) AS remaining,
           COUNT(*) FILTER (WHERE encryption_iv IS NOT NULL AND encryption_iv != '') AS still_encrypted
          FROM messages;`
  },
  {
    label: 'Проверка: key bundles пусты',
    sql: `SELECT COUNT(*) AS key_bundles_count FROM room_key_bundles;`
  }
];

function runQuery(conn, sql) {
  return new Promise((resolve, reject) => {
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
  console.log('✅ SSH connected\n');
  for (const step of STEPS) {
    console.log('='.repeat(65));
    console.log('>> ' + step.label);
    console.log('-'.repeat(65));
    const { out, errOut } = await runQuery(conn, step.sql).catch(e => ({ out: '', errOut: e.message }));
    if (errOut && errOut.trim()) console.error('STDERR:', errOut.trim());
    console.log(out);
  }
  conn.end();
  console.log('\n✅ Фаза 0 завершена.');
}).on('error', e => console.error('SSH Error:', e.message))
  .connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 20000,
  });
