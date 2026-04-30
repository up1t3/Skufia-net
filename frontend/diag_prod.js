const {Client} = require('ssh2');

function sshExec(client, cmd) {
    return new Promise((resolve, reject) => {
        client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let out = '', stderr = '';
            stream.on('data', d => out += d.toString());
            stream.stderr.on('data', d => stderr += d.toString());
            stream.on('close', (code) => resolve({ out: out.trim(), stderr: stderr.trim(), code }));
        });
    });
}

async function run() {
    const c = new Client();
    await new Promise((resolve, reject) => {
        c.on('ready', resolve);
        c.on('error', reject);
        c.connect({host:'147.45.245.133',port:22,username:'root',password:'y38N*dQM.X33k?'});
    });

    console.log('=== DB Users ===');
    const r1 = await sshExec(c, `docker exec skufia-postgres psql -U skufia -d skufia -c "SELECT id, username, display_name FROM users LIMIT 10;"`);
    console.log(r1.out);

    console.log('\n=== Chat Rooms ===');
    const r2 = await sshExec(c, `docker exec skufia-postgres psql -U skufia -d skufia -c "SELECT id, room_name, type FROM chat_rooms LIMIT 10;"`);
    console.log(r2.out);

    console.log('\n=== Recent Messages ===');
    const r3 = await sshExec(c, `docker exec skufia-postgres psql -U skufia -d skufia -c "SELECT id, room_id, sender_id, LEFT(content,50) as content, timestamp FROM chat_messages ORDER BY id DESC LIMIT 5;"`);
    console.log(r3.out);

    console.log('\n=== API Container Logs (last 20 lines) ===');
    const r4 = await sshExec(c, `docker logs skufia-api-blue --tail 20 2>&1`);
    console.log(r4.out);

    c.end();
}

run().catch(e => { console.error(e); process.exit(1); });
