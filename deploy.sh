#!/bin/bash
ssh root@147.45.245.133 << 'EOF'
cd /opt/skufia
git fetch origin main
git reset --hard origin/main

# Get short commit hash for versioning
export VERSION=$(git rev-parse --short HEAD)

# Update CACHE_NAME in chat-sw.js
node -e "const fs = require('fs'); let c = fs.readFileSync('frontend/chat-sw.js', 'utf8'); c = c.replace(/const CACHE_NAME = '[^']+';/, 'const CACHE_NAME = \'skufia-chat-' + process.env.VERSION + '\';'); fs.writeFileSync('frontend/chat-sw.js', c);"

# Update version in index.html footer
node -e "const fs = require('fs'); let c = fs.readFileSync('frontend/index.html', 'utf8'); c = c.replace(/id=\"app-version\">v[^<]+</, 'id=\"app-version\">v' + process.env.VERSION + '<'); fs.writeFileSync('frontend/index.html', c);"

# Update version in messenger.html settings
node -e "const fs = require('fs'); let c = fs.readFileSync('frontend/messenger.html', 'utf8'); c = c.replace(/(id=\"app-version-tag\"[^>]*>)[^<]+(<\/span>)/, '\$1v2.1.0-build.' + process.env.VERSION + '\$2'); fs.writeFileSync('frontend/messenger.html', c);"

cd frontend
docker build --no-cache -t skufia-frontend:latest .
docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest
cd /opt/skufia
docker stop skufia-web || true
docker rm skufia-web || true
docker compose -f docker-compose.production.yml up -d frontend
EOF
