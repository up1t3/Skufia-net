const { execSync } = require('child_process');
const fs = require('fs');

const content = execSync('git show 4afb82d:frontend/app.js', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

const startMarker = "    // --- SKUFIA-NET CHAT HUB ---";
const endMarker = "    // --- USER SETTINGS & PROFILE UX ---";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
    console.error('Markers not found!');
    process.exit(1);
}

const chatContent = content.substring(startIndex, endIndex);

let finalContent = "// Extracted Chat Logic\nwindow.initChatCore = function() {\n" + chatContent + "\n};\n";
fs.writeFileSync('frontend/chat_core.js', finalContent, 'utf8');
console.log('Restored chat_core.js from git history!');
