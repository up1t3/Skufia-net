const fs = require('fs');
const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();

const mainPyContent = fs.readFileSync('backend/main.py', 'utf8');
const seedPyContent = fs.readFileSync('backend/seed_everything.py', 'utf8');
const ip = process.env.SERVER_IP || '147.45.245.133';
const pwd = process.env.SERVER_PASSWORD;

console.log('Connecting to Timeweb over IP...');

conn.on('ready', () => {
  console.log('Client :: ready. Sending patch...');
  
  // Bash script to write the files and modify docker-compose
  const script = `
cd /opt/skufia

cat << 'EOF_MAIN' > main.py
${mainPyContent.replace(/\$/g, '\\$')}
EOF_MAIN

cat << 'EOF_SEED' > seed_everything.py
${seedPyContent.replace(/\$/g, '\\$')}
EOF_SEED

# We will use docker commit to permanently patch the image so we don't need volumes
docker ps -a
docker rm -f temp_backend_patch || true
docker create --name temp_backend_patch ghcr.io/$(echo $GHCR_USER | grep -v '^$' || echo "up1t3")/skufia-backend:latest
docker cp main.py temp_backend_patch:/app/main.py
docker cp seed_everything.py temp_backend_patch:/app/seed_everything.py
docker commit temp_backend_patch ghcr.io/$(echo $GHCR_USER | grep -v '^$' || echo "up1t3")/skufia-backend:latest
docker rm -f temp_backend_patch

echo "Image patched directly! Restarting docker compose..."
docker compose -f docker-compose.production.yml up -d
`;

  conn.exec(script, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
      conn.end();
    }).on('data', (data) => {
      process.stdout.write(data);
    }).stderr.on('data', (data) => {
      process.stderr.write(data);
    });
  });
}).connect({
  host: ip,
  port: 22,
  username: 'root',
  password: pwd,
  readyTimeout: 30000
});
