require('dotenv').config();
const { Client } = require('ssh2');

const config = {
    host: process.env.SERVER_IP || '147.45.245.133',
    port: 22,
    username: process.env.SERVER_USER || 'root',
    password: process.env.SERVER_PASSWORD
};

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: connected via SSH');
    conn.exec('df -h && echo "---" && docker system prune -af --volumes', (err, stream) => {
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
