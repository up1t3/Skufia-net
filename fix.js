const fs = require('fs');

let content = fs.readFileSync('frontend/style.css', 'utf8');

const targetStr = `.sidebar-header {
    padding: 16px;
    background: rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid var(--border-metal);
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 70px;
    box-sizing: border-box;
    flex-shrink: 0;
}`;

const replaceStr = `.sidebar-header {
    padding: 16px;
    background: transparent;
    border-top: none;
    border-bottom: 1px solid var(--border-metal);
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 70px;
    box-sizing: border-box;
    flex-shrink: 0;
}`;

content = content.replace(targetStr, replaceStr);

fs.writeFileSync('frontend/style.css', content, 'utf8');
console.log('done CSS');
