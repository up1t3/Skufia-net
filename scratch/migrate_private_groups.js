#!/usr/bin/env node
/**
 * Migration: Private Groups & Channels
 * Adds: chat_rooms.owner_id, .description, .avatar_url
 * Creates: room_invites table
 */
require('dotenv').config();
const { Client } = require('ssh2');

const SQL = `
-- Safe column additions (SQLite-compatible via separate ALTER TABLE per column)
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create room_invites table
CREATE TABLE IF NOT EXISTS room_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    max_uses    INTEGER,
    uses        INTEGER DEFAULT 0,
    expires_at  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_invites_code ON room_invites(code);
CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);

-- Backfill owner_id from chat_room_members where role='admin' (oldest member per room)
UPDATE chat_rooms
SET owner_id = (
    SELECT user_id FROM chat_room_members
    WHERE room_id = chat_rooms.id AND role IN ('admin','owner')
    ORDER BY joined_at ASC LIMIT 1
)
WHERE owner_id IS NULL AND room_type IN ('group','channel');

-- Update role 'admin' -> 'owner' for the first admin in each group/channel room
UPDATE chat_room_members
SET role = 'owner'
WHERE role = 'admin' AND id IN (
    SELECT MIN(id) FROM chat_room_members
    WHERE role = 'admin'
    GROUP BY room_id
);
`;

const conn = new Client();
conn.on('ready', () => {
    console.log('✅ SSH connected');
    // Write SQL to temp file and execute inside container
    const escaped = SQL.replace(/'/g, "'\\''");
    const cmd = `echo '${escaped}' > /tmp/migrate_groups.sql && docker exec skufia-api python3 -c "
import sqlite3, os
db_path = '/opt/skufia/backend/chat.db'
if not os.path.exists(db_path):
    db_path = '/opt/skufia/backend/skufia.db'
con = sqlite3.connect(db_path)
cur = con.cursor()
stmts = open('/tmp/migrate_groups.sql').read()
for stmt in stmts.split(';'):
    s = stmt.strip()
    if s:
        try:
            cur.execute(s)
            print('OK:', s[:60].replace(chr(10),' '))
        except Exception as e:
            print('SKIP:', str(e)[:80])
con.commit()
con.close()
print('Migration complete')
"`;

    conn.exec(cmd, (err, stream) => {
        if (err) { console.error('exec error:', err); conn.end(); return; }
        stream.on('data', d => process.stdout.write(String(d)));
        stream.stderr.on('data', d => process.stderr.write(String(d)));
        stream.on('close', () => { conn.end(); });
    });
}).connect({
    host: process.env.SERVER_IP,
    port: 22,
    username: process.env.SERVER_USER,
    password: process.env.SERVER_PASSWORD,
});
