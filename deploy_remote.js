const { execSync } = require('child_process');

try {
    console.log('Connecting via SSH to 147.45.245.133...');
    const script = `
        cd /opt/skufia && \\
        git fetch origin main && \\
        git reset --hard origin/main && \\
        node -e "const fs=require('fs'); let c=fs.readFileSync('frontend/chat-sw.js','utf8'); c=c.replace(/const CACHE_NAME = '[^']+';/, \\"const CACHE_NAME = 'skufia-chat-v\\" + Date.now() + \\"';\\"); fs.writeFileSync('frontend/chat-sw.js',c);" && \\
        cd frontend && \\
        docker build --no-cache -t skufia-frontend:latest . && \\
        docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest && \\
        cd /opt/skufia && \\
        docker stop skufia-web || true && \\
        docker rm skufia-web || true && \\
        docker compose -f docker-compose.production.yml up -d frontend
    `;
    execSync(`ssh root@147.45.245.133 "${script}"`, { stdio: 'inherit' });
    console.log('Done!');
} catch(e) {
    console.error('Deployment failed.');
    process.exit(1);
}
