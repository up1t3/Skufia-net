require('dotenv').config();
const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  const SQL = `
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS room_invites (
    id          SERIAL PRIMARY KEY,
    room_id     INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    max_uses    INTEGER,
    uses        INTEGER DEFAULT 0,
    expires_at  TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_invites_code ON room_invites(code);
CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);

UPDATE chat_rooms
SET owner_id = (
    SELECT user_id FROM chat_room_members
    WHERE room_id = chat_rooms.id AND role IN ('admin','owner')
    ORDER BY joined_at ASC LIMIT 1
)
WHERE owner_id IS NULL AND room_type IN ('group','channel');

UPDATE chat_room_members
SET role = 'owner'
WHERE role = 'admin' AND id IN (
    SELECT MIN(id) FROM chat_room_members
    WHERE role = 'admin'
    GROUP BY room_id
);
`;
  const escaped = SQL.replace(/'/g, "'\\''");
  const cmd = `echo '${escaped}' | docker exec -i skufia-postgres psql -U postgres -d skufia`;
  conn.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => out += d);
    stream.on('close', () => {
      console.log('Output:\\n' + out);
      conn.end();
    });
  });
}).connect({
  host: process.env.SERVER_IP || '147.45.245.133',
  port: 22,
  username: process.env.SERVER_USER || 'root',
  password: process.env.SERVER_PASSWORD,
  readyTimeout: 10000
});
