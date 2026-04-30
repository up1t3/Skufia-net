const {Client} = require('ssh2');
function sshExec(client, cmd) {
    return new Promise((resolve, reject) => {
        client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let out = '', stderr = '';
            stream.on('data', d => out += d.toString());
            stream.stderr.on('data', d => stderr += d.toString());
            stream.on('close', (code) => resolve({ out, stderr, code }));
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
    
    // Schema
    console.log('=== Tables ===');
    const r0 = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "\\dt" 2>&1`);
    console.log(r0.out);

    console.log('\n=== Users schema ===');
    const r1 = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "\\d users" 2>&1`);
    console.log(r1.out);

    console.log('\n=== Chat rooms schema ===');
    const r2 = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "\\d chat_rooms" 2>&1`);
    console.log(r2.out);

    // Find messages table
    console.log('\n=== Messages table ===');
    const r3 = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "\\dt *message*" 2>&1`);
    console.log(r3.out);

    // Users data
    console.log('\n=== Users (first 5) ===');
    const r4 = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "SELECT id, username FROM users LIMIT 5;" 2>&1`);
    console.log(r4.out);

    c.end();
}
run().catch(e => { console.error(e); process.exit(1); });
