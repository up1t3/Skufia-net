const fs = require('fs');

const filepath = 'index.html';
let content = fs.readFileSync(filepath, 'utf-8');

content = content.replace(/style\.css\?v=36/g, "style.css?v=37");
content = content.replace(/style-modal\.css\?v=36/g, "style-modal.css?v=37");
content = content.replace(/app\.js\?v=36/g, "app.js?v=37");
content = content.replace(/ui\.js\?v=36/g, "ui.js?v=37");
content = content.replace(/features\.js\?v=36/g, "features.js?v=37");
content = content.replace(/chat_core\.js\?v=36/g, "chat_core.js?v=37");

fs.writeFileSync(filepath, content, 'utf-8');
console.log("index.html patched to v37");
