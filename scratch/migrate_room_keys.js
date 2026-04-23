#!/usr/bin/env node
/**
 * Apply migration: add missing columns to room_key_bundles table.
 */
const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    console.log('✅ SSH connected. Running migration...');
    
    const sql = `
ALTER TABLE room_key_bundles ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE room_key_bundles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `.trim();

    const cmd = `docker exec skufia-postgres psql -U postgres -d skufia -c "${sql}"`;
    
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code) => {
            console.log(code === 0 ? '🎉 Migration applied!' : `⚠️ Exit code: ${code}`);
            conn.end();
        }).on('data', d => process.stdout.write(d))
          .stderr.on('data', d => process.stderr.write(d));
    });
}).connect({
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: 'root',
    password: process.env.SERVER_PASSWORD,
    readyTimeout: 30000
});
