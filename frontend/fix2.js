const fs = require('fs');

const filepath = 'app.js';
let content = fs.readFileSync(filepath, 'utf-8');

// Use regex for precise multiline replacements
content = content.replace(/window\.loadChatRooms = loadChatRooms;\s*window\.loadFolders = loadFolders;\s*window\.renderChatRooms = renderChatRooms;/g, "");
content = content.replace(/window\.selectChatRoom = selectChatRoom;\s*\/\/\s*\[FIX-06\][^\n]*\s*window\.sendChatMessage = sendChatMsg;/g, "// Removed undefined exports");

fs.writeFileSync(filepath, content, 'utf-8');
console.log("Regex replacements done.");
