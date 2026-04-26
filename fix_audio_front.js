const fs = require('fs');
let js = fs.readFileSync('e:/AgentZero/usr/projects/skufia/frontend/chat_core.js', 'utf8');

js = js.replace(
    /const isAudio = \/\\\.([a-zA-Z0-9|]+)\\\$\/i\.test\(fileUrl\);/,
    'const isAudio = /\\\\.(mp3|ogg|wav|webm|flac|m4a|opus|aac|mp4)(?:\\\\?.*)?$/i.test(fileUrl);'
);

fs.writeFileSync('e:/AgentZero/usr/projects/skufia/frontend/chat_core.js', js);
