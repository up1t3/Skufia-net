const fs = require('fs'); 
let content = fs.readFileSync('frontend/api.js', 'utf8'); 
content = content.replace('const res = await fetch(${window.API_BASE_URL}, fetchOptions);', 'const res = await fetch(`${window.API_BASE_URL}${endpoint}`, fetchOptions);'); 
fs.writeFileSync('frontend/api.js', content);
