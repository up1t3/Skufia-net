const fs = require('fs');
let content = fs.readFileSync('frontend/app.js', 'utf8');

const target = `            const resp = await apiRequest('/chat/folders', 'POST', { name: name, room_ids: roomIds });`;
const replacement = `            const resp = await apiRequest('/chat/folders', 'POST', { name: name, rooms: roomIds });`;

const contentNormalized = content.replace(/\r\n/g, '\n');
if (contentNormalized.includes(target.replace(/\r\n/g, '\n'))) {
    fs.writeFileSync('frontend/app.js', contentNormalized.replace(target.replace(/\r\n/g, '\n'), replacement.replace(/\r\n/g, '\n')), 'utf8');
    console.log('Successfully patched rooms parameter.');
} else {
    console.log('Target not found for rooms parameter');
}
