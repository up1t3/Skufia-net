import paramiko, sys
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('147.45.245.133', username='root', password='y38N*dQM.X33k?')

stdin, stdout, stderr = client.exec_command('''
cd /opt/skufia
echo "=== GIT PULL ==="
git fetch origin main && git reset --hard origin/main 2>&1

echo "=== REBUILD FRONTEND ==="
node -e "const fs = require('fs'); let c = fs.readFileSync('frontend/chat-sw.js', 'utf8'); c = c.replace(/const CACHE_NAME = '[^']+';/, 'const CACHE_NAME = \\'skufia-chat-v' + Date.now() + '\\';'); fs.writeFileSync('frontend/chat-sw.js', c);"
cd frontend && docker build --no-cache -t skufia-frontend:latest . 2>&1 | tail -5
docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest 2>&1

echo "=== RESTART ==="
cd /opt/skufia
docker stop skufia-web 2>/dev/null && docker rm skufia-web 2>/dev/null
docker compose -f docker-compose.production.yml up -d frontend 2>&1

sleep 3

echo "=== FINAL VERIFY ==="
docker exec skufia-web grep -c "media-preview-modal" /usr/share/nginx/html/style.css
docker exec skufia-web head -1 /usr/share/nginx/html/chat-sw.js
docker exec skufia-web grep "chat_core.js?v=" /usr/share/nginx/html/messenger.html | head -1
docker ps --filter name=skufia-web --format "{{.Names}} {{.Status}}"
echo "ALL_DONE"
''')

out = stdout.read().decode()
err = stderr.read().decode()
print(out)
if err:
    print("STDERR:", err[:500])
client.close()
