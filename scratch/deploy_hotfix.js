require('dotenv').config();
const {Client} = require('ssh2');
const fs = require('fs');
const conn = new Client();

conn.on('ready', () => {
    // Step 1: Upload files to host temp
    conn.sftp((err, sftp) => {
        if (err) { console.error(err); conn.end(); return; }

        const uploads = [
            { local: 'frontend/app.js', remote: '/tmp/app.js' },
            { local: 'frontend/style.css', remote: '/tmp/style.css' },
            { local: 'frontend/index.html', remote: '/tmp/index.html' },
            { local: 'frontend/chat_core.js', remote: '/tmp/chat_core.js' },
            { local: 'frontend/chat-sw.js', remote: '/tmp/chat-sw.js' },
            { local: 'frontend/features.js', remote: '/tmp/features.js' }
        ];

        let done = 0;
        uploads.forEach(u => {
            sftp.writeFile(u.remote, fs.readFileSync(u.local), (err) => {
                if (err) console.error('SFTP ERR:', u.local, err.message);
                else console.log('SFTP OK:', u.local);
                done++;
                if (done === uploads.length) {
                    // Step 2: docker cp into containers
                    const cmds = [
                        'docker cp /tmp/app.js skufia-web:/usr/share/nginx/html/app.js',
                        'docker cp /tmp/style.css skufia-web:/usr/share/nginx/html/style.css',
                        'docker cp /tmp/index.html skufia-web:/usr/share/nginx/html/index.html',
                        'docker cp /tmp/chat_core.js skufia-web:/usr/share/nginx/html/chat_core.js',
                        'docker cp /tmp/chat-sw.js skufia-web:/usr/share/nginx/html/chat-sw.js',
                        'docker cp /tmp/features.js skufia-web:/usr/share/nginx/html/features.js',
                        'echo "DEPLOY COMPLETE"',
                    ].join(' && ');

                    conn.exec(cmds, (err, stream) => {
                        let out = '';
                        stream.on('data', d => out += d);
                        stream.stderr.on('data', d => out += d);
                        stream.on('close', (code) => {
                            console.log(out);
                            console.log('Exit code:', code);
                            conn.end();
                        });
                    });
                }
            });
        });
    });
});

conn.on('error', e => console.error('SSH error:', e.message));
conn.connect({
    host: process.env.SERVER_IP,
    port: 22,
    username: 'root',
    password: process.env.SERVER_PASSWORD
});
