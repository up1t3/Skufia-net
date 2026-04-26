const fs = require('fs');
let js = fs.readFileSync('e:/AgentZero/usr/projects/skufia/frontend/chat_core.js', 'utf8');

// Fix selectChatRoom to clear input and load draft
js = js.replace(
    /state\.chat\.receiverId = receiverId;\r?\n/,
    'state.chat.receiverId = receiverId;\r\n\r\n        const chatInput = document.getElementById(\'chat-input\');\r\n        if (chatInput) {\r\n            const draft = localStorage.getItem(skuf_draft_\);\r\n            chatInput.value = draft || \'\';\r\n        }\r\n'
);

fs.writeFileSync('e:/AgentZero/usr/projects/skufia/frontend/chat_core.js', js);
