const fs = require('fs');
let css = fs.readFileSync('e:/AgentZero/usr/projects/skufia/frontend/style.css', 'utf8');
css = css.replace(/height: var\(--app-height\);/g, 'height: var(--app-height, 100dvh);')
         .replace(/max-height: var\(--app-height\);/g, 'max-height: var(--app-height, 100dvh);')
         .replace(/width: 100%; height: 100%;\s*z-index: 50;/g, 'right: 0; bottom: 0;\r\n        z-index: 50;');
if (!css.includes('.chat-messages::before')) {
    css = css.replace(/\.chat-messages \{\s*flex-grow: 1;/g, '.chat-messages::before {\r\n    content: \'\';\r\n    margin-top: auto;\r\n}\r\n\r\n.chat-messages {\r\n    flex-grow: 1;');
}
fs.writeFileSync('e:/AgentZero/usr/projects/skufia/frontend/style.css', css);
