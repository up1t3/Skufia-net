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
    const cmd = `
        journalctl --vacuum-size=100M &&
        sed -i 's/^#SystemMaxUse=.*/SystemMaxUse=100M/' /etc/systemd/journald.conf &&
        systemctl restart systemd-journald
    `;
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
            conn.end();
        }).on('data', (data) => {
            process.stdout.write(data);
        }).stderr.on('data', (data) => {
            process.stderr.write(data);
        });
    });
}).connect(config);
