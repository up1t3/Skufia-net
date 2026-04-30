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

let passed = 0, failed = 0, total = 0;
function assert(cond, name) {
    total++;
    if (cond) { passed++; console.log(`  ✅ PASS: ${name}`); }
    else { failed++; console.log(`  ❌ FAIL: ${name}`); }
}

async function run() {
    const c = new Client();
    await new Promise((resolve, reject) => {
        c.on('ready', resolve);
        c.on('error', reject);
        c.connect({host:'147.45.245.133',port:22,username:'root',password:'y38N*dQM.X33k?'});
    });

    console.log('\n🧪 Full E2E Pipeline Test (SSH)\n');
    console.log('════════════════════════════════════════');

    // Find a user and their password hash to understand auth
    console.log('\n--- Setup: Find test credentials ---');
    const usersR = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -t -c "SELECT id, username FROM users LIMIT 3;" 2>&1`);
    console.log('  Users:', usersR.out.trim());
    
    // Get rooms
    const roomsR = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -t -c "SELECT id, name, room_type FROM chat_rooms LIMIT 5;" 2>&1`);
    console.log('  Rooms:', roomsR.out.trim());

    // Get recent messages
    const msgsR = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -c "SELECT m.id, m.room_id, m.sender_id, u.username, LEFT(m.content, 40) as content, m.created_at FROM messages m LEFT JOIN users u ON m.sender_id = u.id ORDER BY m.id DESC LIMIT 10;" 2>&1`);
    console.log('\n  Recent messages:');
    console.log(msgsR.out);

    // Try to register a test user for E2E
    console.log('\n--- T1: Register test user ---');
    const regR = await sshExec(c, `curl -s -X POST http://localhost:8007/api/auth/register -H "Content-Type: application/json" -d '{"username":"e2e_pipeline_bot","email":"e2e@test.local","password":"TestPass123!"}'`);
    console.log('  Register:', regR.out.substring(0, 200));
    
    // Login with test user
    console.log('\n--- T2: Login test user ---');
    const loginR = await sshExec(c, `curl -s -X POST http://localhost:8007/api/auth/login -H "Content-Type: application/json" -d '{"username":"e2e_pipeline_bot","password":"TestPass123!"}'`);
    let loginData;
    try { loginData = JSON.parse(loginR.out); } catch(e) { loginData = null; }
    console.log('  Login:', loginR.out.substring(0, 200));
    
    let token = null;
    if (loginData && loginData.access_token) {
        token = loginData.access_token;
        assert(true, 'Login successful');
    } else {
        assert(false, `Login failed: ${loginR.out.substring(0, 100)}`);
    }

    if (token) {
        // Get rooms
        console.log('\n--- T3: Get rooms ---');
        const roomsApiR = await sshExec(c, `curl -s http://localhost:8007/api/chat/rooms -H "Authorization: Bearer ${token}"`);
        let rooms;
        try { rooms = JSON.parse(roomsApiR.out); } catch(e) { rooms = null; }
        assert(Array.isArray(rooms), `Rooms is array (${typeof rooms})`);
        console.log(`  Found ${Array.isArray(rooms) ? rooms.length : 0} rooms`);

        // If no rooms, try to find a public one or create one
        let testRoomId = null;
        if (Array.isArray(rooms) && rooms.length > 0) {
            testRoomId = rooms[0].id;
            console.log(`  Using room: ${rooms[0].id} - ${rooms[0].name || rooms[0].room_name}`);
        } else {
            // Try joining a public room
            console.log('  No rooms - trying to find public rooms...');
            const pubR = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -t -c "SELECT id FROM chat_rooms WHERE is_public=true LIMIT 1;" 2>&1`);
            const pubId = pubR.out.trim();
            if (pubId) {
                // Join the room
                const joinR = await sshExec(c, `curl -s -X POST http://localhost:8007/api/chat/rooms/${pubId}/join -H "Authorization: Bearer ${token}"`);
                console.log(`  Join result: ${joinR.out.substring(0, 100)}`);
                testRoomId = parseInt(pubId);
            }
        }

        if (testRoomId) {
            // T4: Send message
            console.log('\n--- T4: Send message via API ---');
            const ts = new Date().toISOString();
            const sendR = await sshExec(c, `curl -s -w "\\nHTTP_STATUS:%{http_code}" -X POST http://localhost:8007/api/chat/rooms/${testRoomId}/send -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"content":"[E2E_TEST] ${ts}","encryption_iv":"","file_url":null,"reply_to_id":null}'`);
            const lines = sendR.out.split('\n');
            const statusLine = lines.find(l => l.startsWith('HTTP_STATUS:'));
            const status = statusLine ? statusLine.replace('HTTP_STATUS:', '') : 'unknown';
            const body = lines.filter(l => !l.startsWith('HTTP_STATUS:')).join('\n');
            console.log(`  Status: ${status}`);
            console.log(`  Body: ${body.substring(0, 200)}`);
            assert(status === '200' || status === '201', `Send returns 200/201 (got: ${status})`);

            let sendData;
            try { sendData = JSON.parse(body); } catch(e) { sendData = null; }
            if (sendData && sendData.id) {
                assert(true, `Message ID returned: ${sendData.id}`);
            } else if (sendData) {
                console.log(`  Full response: ${JSON.stringify(sendData)}`);
                assert(false, 'No message ID in response');
            }

            // T5: Verify in DB
            console.log('\n--- T5: Verify message in DB ---');
            const verifyR = await sshExec(c, `docker exec skufia-postgres psql -U postgres -d skufia -t -c "SELECT COUNT(*) FROM messages WHERE content LIKE '%E2E_TEST%' AND room_id=${testRoomId};" 2>&1`);
            const count = parseInt(verifyR.out.trim());
            console.log(`  E2E messages in DB: ${count}`);
            assert(count > 0, 'Test message found in DB');
        } else {
            console.log('  ⚠️ No room available for testing');
        }
    }

    // T6: Frontend code verification
    console.log('\n--- T6: Frontend sendChatMsg integrity ---');
    const r6a = await sshExec(c, `grep -c "window.sendChatMsg = sendChatMsg" /opt/skufia/frontend/chat_core.js`);
    assert(r6a.out.trim() === '1', 'sendChatMsg exported once');

    const r6b = await sshExec(c, `grep -c "sendChatBtn.addEventListener" /opt/skufia/frontend/chat_core.js`);
    assert(r6b.out.trim() === '0', 'No duplicate addEventListener');

    const r6c = await sshExec(c, `grep -c "typeof directCaption === .string." /opt/skufia/frontend/chat_core.js`);
    assert(parseInt(r6c.out.trim()) >= 1, 'MouseEvent guard present');

    const r6d = await sshExec(c, `grep -c "dataset.sending" /opt/skufia/frontend/chat_core.js`);
    assert(parseInt(r6d.out.trim()) >= 2, 'Double-send guard present');

    // T7: SW version
    console.log('\n--- T7: Service Worker ---');
    const r7 = await sshExec(c, `grep "CACHE_NAME" /opt/skufia/frontend/chat-sw.js | head -1`);
    console.log(`  ${r7.out}`);
    assert(r7.out.includes('skufia-chat-v'), 'SW cache versioned');

    // T8: Docker status
    console.log('\n--- T8: Docker containers ---');
    const r8 = await sshExec(c, `docker ps --format "{{.Names}} {{.Status}}" | grep skufia`);
    console.log(`  ${r8.out}`);
    const allUp = r8.out.includes('skufia-api-blue') && r8.out.includes('Up');
    assert(allUp, 'API container is running');

    // SUMMARY
    console.log('\n════════════════════════════════════════');
    console.log(`ИТОГО: ${total} тестов | ✅ ${passed} | ❌ ${failed}`);
    console.log('════════════════════════════════════════\n');

    c.end();
    process.exit(failed > 0 ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
