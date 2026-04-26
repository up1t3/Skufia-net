require('dotenv').config();
const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  const cmd = `docker exec skufia-postgres psql -U postgres -d skufia -c "SELECT id, username, created_at FROM users;"`;
  conn.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => out += d);
    stream.on('close', () => {
      console.log('--- USERS IN DB ---');
      console.log(out);
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
