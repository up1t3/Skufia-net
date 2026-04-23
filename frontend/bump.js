const fs = require('fs');

function replaceAll(filepath, searchRegex, replacement) {
    let content = fs.readFileSync(filepath, 'utf-8');
    content = content.replace(searchRegex, replacement);
    fs.writeFileSync(filepath, content, 'utf-8');
}

replaceAll('chat-sw.js', /skufia-chat-v39/g, 'skufia-chat-v40');
replaceAll('index.html', /\?v=39/g, '?v=40');

console.log("Cache bumped to v40");
