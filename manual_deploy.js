require('dotenv').config();
const fs = require('fs');
const { Client } = require('ssh2');

const filesToUpload = [
    'frontend/chat_core.js',
    'backend/routers/chat.py',
    'frontend/chat-sw.js',
    'frontend/messenger.html',
    'frontend/extract_messenger.js',
    'frontend/style.css',
    'frontend/style-modal.css',
    'frontend/messenger_app.js',
    'frontend/index.html'
];

console.log('=== STARTING MANUAL SFTP DEPLOY ===');

const config = {
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD
};

const conn = new Client();

conn.on('ready', () => {
    console.log('Client :: connected via SSH');
    
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        let filesUploaded = 0;
        
        filesToUpload.forEach(file => {
            const localPath = `./${file}`;
            const remotePath = `/opt/skufia/${file}`;
            
            sftp.fastPut(localPath, remotePath, (err) => {
                if (err) throw err;
                console.log(`Uploaded ${file} successfully.`);
                filesUploaded++;
                
                if (filesUploaded === filesToUpload.length) {
                    console.log('All files uploaded via SFTP. Proceeding to Docker rebuild...');
                    
                    const remoteCmd = `
                        set -e
                        echo "-> Rebuilding Frontend..."
                        cd /opt/skufia/frontend
                        docker build -t ghcr.io/up1t3/skufia-frontend:latest .
                        
                        echo "-> Restarting Web Container..."
                        cd /opt/skufia
                        docker stop skufia-web || true
                        docker rm skufia-web || true
                        docker compose -f docker-compose.production.yml up -d frontend

                        echo "-> Rebuilding Backend..."
                        cd /opt/skufia/backend
                        docker build -t ghcr.io/up1t3/skufia-backend:latest .
                        
                        echo "-> Restarting API Containers..."
                        cd /opt/skufia
                        docker stop skufia-api-blue skufia-api-green || true
                        docker rm skufia-api-blue skufia-api-green || true
                        docker compose -f docker-compose.production.yml up -d backend-blue backend-green
                        
                        echo "=== DEPLOYMENT COMPLETE ==="
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
                }
            });
        });
    });
}).connect(config);
