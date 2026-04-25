#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');

const conn = new Client();

const STEPS = [
  {
    label: 'Migration: Alter messages table',
    sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS key_version INTEGER DEFAULT NULL;`
  },
  {
    label: 'Migration: Alter room_key_bundles table (add is_active)',
    sql: `ALTER TABLE room_key_bundles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;`
  },
  {
    label: 'Migration: Alter room_key_bundles table (drop old unique constraint)',
    sql: `ALTER TABLE room_key_bundles DROP CONSTRAINT IF EXISTS uix_room_user_key;`
  },
  {
    label: 'Migration: Alter room_key_bundles table (add new unique constraint)',
    sql: `ALTER TABLE room_key_bundles ADD CONSTRAINT uix_room_user_key_version UNIQUE (room_id, user_id, key_version);`
  },
  {
    label: 'Migration: Create index on active keys',
    sql: `CREATE INDEX IF NOT EXISTS idx_rkb_active ON room_key_bundles(room_id, user_id) WHERE is_active = true;`
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
    console.log(out || 'OK');
  }
  conn.end();
  console.log('\n✅ Фаза 1 завершена.');
}).on('error', e => console.error('SSH Error:', e.message))
  .connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 20000,
  });
