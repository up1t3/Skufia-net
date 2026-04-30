const fs = require('fs');
const code = fs.readFileSync('messenger_app.js', 'utf8');
['system-header', 'side-panel', 'system-footer'].forEach(s => {
    const regex = new RegExp(`querySelector\\(['"]\\.${s}['"]\\)`, 'g');
    let m;
    while ((m = regex.exec(code)) !== null) {
        console.log('Found ' + s + ' at index ' + m.index);
    }
});
