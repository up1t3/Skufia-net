const fs = require('fs');
const html = fs.readFileSync('e:/Skufia-net/frontend/index.html', 'utf8');
const lines = html.split('\n');

let startIdx = lines.findIndex(l => l.includes('id="settings-modal"'));
let endIdx = -1;
let depth = 0;

for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const openMatches = line.match(/<div[^>]*>/g) || [];
    const closeMatches = line.match(/<\/div>/g) || [];
    
    // Some div tags might be self closing? No, div is not self closing.
    depth += openMatches.length;
    depth -= closeMatches.length;
    
    console.log(`Line ${i + 1} | Depth: ${depth} | ${line.trim()}`);
    
    if (depth === 0) {
        endIdx = i;
        break;
    }
}
