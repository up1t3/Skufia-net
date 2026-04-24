
const fs = require('fs');
const path = 'e:/AgentZero/usr/projects/skufia/frontend/messenger_app.js';

try {
    const content = fs.readFileSync(path, 'utf8');
    const lines = content.split('\n');

    // Find the last '});'
    let lastBraceIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === '});') {
            lastBraceIndex = i;
            break;
        }
    }

    if (lastBraceIndex !== -1) {
        const newFooter = `
    // --- SYSTEM INITIALIZATION ---
    if (state.user.token) {
        bootSystem();
    }
    syncGlobalAlerts();
    setInterval(syncGlobalAlerts, 60000); 

});
`;
        const newLines = [
            ...lines.slice(0, lastBraceIndex),
            newFooter
        ];
        fs.writeFileSync(path, newLines.join('\n'), 'utf8');
        console.log("Successfully restored boot logic in messenger_app.js");
    } else {
        console.error("Could not find closing brace });");
        process.exit(1);
    }
} catch (err) {
    console.error("Error fixing file:", err);
    process.exit(1);
}
