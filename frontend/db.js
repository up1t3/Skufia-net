const db = new Dexie("SkufNetDB");

db.version(1).stores({
    rooms: 'id, type, created_at',
    members: '[room_id+user_id], room_id, user_id, role',
    messages: 'id, client_msg_id, room_id, sender_id, [room_id+created_at], created_at'
});

window.db = db;
