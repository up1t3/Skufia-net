const { Client } = require('ssh2');
require('dotenv').config({ path: 'e:/Skufia-net/.env' });

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

const remoteCmd = process.argv.slice(2).join(' ');
if (!remoteCmd) {
    console.error('Usage: node run_ssh.js "<command>"');
    process.exit(1);
}

console.log(`Connecting to ${config.host} and running: ${remoteCmd}\n`);

const conn = new Client();
conn.on('ready', () => {
    conn.exec(remoteCmd, (err, stream) => {
        if (err) {
            console.error('Exec error:', err);
            conn.end();
            process.exit(1);
        }
        stream.on('close', (code, signal) => {
            conn.end();
            process.exit(code);
        }).on('data', (data) => {
            process.stdout.write(data);
        }).stderr.on('data', (data) => {
            process.stderr.write(data);
        });
        
        // Pipe local stdin to remote process
        process.stdin.pipe(stream);
    });
}).on('error', (err) => {
    console.error('Connection error:', err);
}).connect(config);
