const fs = require('fs');
let content = fs.readFileSync('frontend/app.js', 'utf8');

const target = `            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: "Private", room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? "Чат уже существует" : "Личный чат создан", 'success');
                    loadChatRooms();
                } catch(e) {
                    addLog('Ошибка создания чата', 'error');
                }
            };`;

const replacement = `            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: "Private", room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? "Чат уже существует" : "Личный чат создан", 'success');
                    await window.loadChatRooms();
                    window.selectChatRoom(room.id, u.username, 'private', u.id, 'member');
                } catch(e) {
                    addLog('Ошибка создания чата', 'error');
                }
            };`;

const targetNormalized = target.replace(/\r\n/g, '\n');
const replacementNormalized = replacement.replace(/\r\n/g, '\n');
const contentNormalized = content.replace(/\r\n/g, '\n');

if (contentNormalized.includes(targetNormalized)) {
    fs.writeFileSync('frontend/app.js', contentNormalized.replace(targetNormalized, replacementNormalized), 'utf8');
    console.log('Patch success');
} else {
    console.log('Target not found in app.js');
}
