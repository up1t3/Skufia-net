const fs = require('fs');
let py = fs.readFileSync('e:/AgentZero/usr/projects/skufia/backend/routers/chat.py', 'utf8');

py = py.replace(
    /if ext\.lower\(\) not in \[\'\.webm\', \'\.ogg\', \'\.mp3\', \'\.wav\', \'\.flac\'\]:/,
    'if ext.lower() not in [\'.webm\', \'.ogg\', \'.mp3\', \'.wav\', \'.flac\', \'.m4a\', \'.mp4\', \'.aac\']:'
);

fs.writeFileSync('e:/AgentZero/usr/projects/skufia/backend/routers/chat.py', py);
