require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const { Client } = require('ssh2');

const FRONTEND_HTML = ['frontend/index.html', 'frontend/messenger.html'];
const SW_FILE = 'frontend/chat-sw.js';
const MAJOR_VERSION = 'v2.2.0';

function runLocal(cmd, ignoreError = false) {
    try {
        console.log(`> ${cmd}`);
        return execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        if (!ignoreError) {
            console.error(`ERROR: Command failed: ${cmd}`);
            process.exit(1);
        }
    }
}

function getVersionString() {
    const d = new Date();
    // Adjust to Moscow time (UTC+3)
    d.setHours(d.getUTCHours() + 3);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${MAJOR_VERSION}_${dd}.${mm}_${hh}:${min}`;
}

async function startDeploy() {
    console.log('=== STARTING ZERO-ERROR DEPLOY ===');

    // 1. Check Git status for untracked/modified files
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
        console.log('Detected uncommitted changes. Auto-committing before version bump...');
        runLocal('git add .');
        runLocal('git commit -m "chore: Auto-commit before deploy"', true);
    }

    // 2. Generate new Version
    const version = getVersionString();
    console.log(`\n=> Bumping version to: ${version}`);

    // 3. Update HTML files
    FRONTEND_HTML.forEach(file => {
        if (fs.existsSync(file)) {
            let content = fs.readFileSync(file, 'utf8');
            content = content.replace(/(id="app-version-tag"[^>]*>)[^<]+(<\/span>)/g, `$1${version}$2`);
            fs.writeFileSync(file, content);
            console.log(`Updated version tag in ${file}`);
        }
    });

    // 4. Update Service Worker Cache Name
    if (fs.existsSync(SW_FILE)) {
        let content = fs.readFileSync(SW_FILE, 'utf8');
        content = content.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'skufia-chat-${version}';`);
        fs.writeFileSync(SW_FILE, content);
        console.log(`Updated CACHE_NAME in ${SW_FILE}`);
    }

    // 5. Commit and push the version bump
    console.log('\n=> Committing and Pushing to Git...');
    runLocal('git add .');
    runLocal(`git commit -m "chore(release): ${version}"`);
    runLocal('git push origin main');

    // 6. Connect via SSH and deploy
    console.log('\n=> Connecting to remote server to build and deploy...');
    const config = {
        host: process.env.SERVER_IP,
        port: 22,
        username: process.env.SERVER_USER || 'root',
        password: process.env.SERVER_PASSWORD
    };

    if (!config.password || !config.host) {
        console.error('ERROR: SERVER_IP or SERVER_PASSWORD missing from .env');
        process.exit(1);
    }

    const conn = new Client();
    conn.on('ready', () => {
        console.log('Client :: connected via SSH');
        
        // Command to execute on server
        const remoteCmd = `
            set -e
            cd /opt/skufia
            echo "-> Pulling latest code..."
            git fetch origin main
            git reset --hard origin/main
            
            echo "-> Building Frontend..."
            cd frontend
            docker build --no-cache -t skufia-frontend:latest .
            docker tag skufia-frontend:latest ghcr.io/up1t3/skufia-frontend:latest
            
            echo "-> Building Backend..."
            cd ../backend
            docker build --no-cache -t skufia-backend:latest .
            docker tag skufia-backend:latest ghcr.io/up1t3/skufia-backend:latest
            
            echo "-> Restarting Containers..."
            cd /opt/skufia
            docker stop skufia-web skufia-api-blue skufia-api-green || true
            docker rm skufia-web skufia-api-blue skufia-api-green || true
            docker compose -f docker-compose.production.yml up -d
            
            echo "-> Cleaning up old Docker images..."
            docker image prune -f
            echo "=== DEPLOYMENT COMPLETE: ${version} ==="
        `;

        conn.exec(remoteCmd, (err, stream) => {
            if (err) throw err;
            stream.on('close', (code, signal) => {
                console.log(`\nRemote stream closed (code: ${code})`);
                conn.end();
            }).on('data', (data) => {
                process.stdout.write(data);
            }).stderr.on('data', (data) => {
                process.stderr.write(data);
            });
        });
    }).connect(config);
}

startDeploy();
