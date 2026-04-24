const fs = require('fs');
let c = fs.readFileSync('frontend/messenger_app.js', 'utf8');

// Find the corrupted section boundaries
const corruptionStart = c.indexOf('};d`');
const oldDuplicateEnd = c.indexOf('addLog(`❌ Ошибка загрузки аватарки: ${e.message}`, \'error\');\n    }\n};\n', corruptionStart);

if (corruptionStart !== -1) {
    console.log('Found corruption at char:', corruptionStart);
    
    // Find the end of the old duplicate block
    const endOfDuplicate = c.indexOf('\n};\n', corruptionStart) + 4; // after the final };
    console.log('End of duplicate block at:', endOfDuplicate);
    
    // Replace everything from '};d`' to end of old duplicate with just '};\n'
    const before = c.slice(0, corruptionStart);
    const after = c.slice(endOfDuplicate);
    c = before + '};\n' + after;
    console.log('Removed duplicate previewAvatar block');
} else {
    console.log('No corruption (};d`) found');
}

// Also fix the broken encryption case line
// Find the truncated line with garbage char
const garbageIdx = c.indexOf('\u003F \u2018\uD83D\uDD12');
if (garbageIdx === -1) {
    // Try finding it differently - look for the broken context
    const brokenLine = c.indexOf("? '🔒 Этот чат защищён сквозным шифрованием (E2EE).\\nКлючи сессии ге");
    if (brokenLine !== -1) {
        console.log('Found broken encryption line at:', brokenLine);
        // Find end of that line
        const lineEnd = c.indexOf('\n', brokenLine);
        const fullBrokenLine = c.slice(brokenLine, lineEnd);
        console.log('Broken line:', JSON.stringify(fullBrokenLine));
        
        // Replace with correct full content
        const correctContent = `? '🔒 Этот чат защищён сквозным шифрованием (E2EE).\\nКлючи сессии генерируются локально и не передаются на сервер.'
                    : '⚠️ Шифрование не активно.\\nВыберите приватный чат для активации E2EE.');
                break;
            }
        }
    };
});

// Telegram-like Sidebar Search Toggle
function toggleSidebarSearch(show) {
    const defaultHeader = document.getElementById("sidebar-default-header");
    const searchHeader = document.getElementById("sidebar-active-search");
    const searchInput = document.getElementById("contact-search");

    if (show) {
        defaultHeader.style.display = "none";
        searchHeader.style.display = "flex";
        if (searchInput) {
            searchInput.focus();
        }
    } else {
        defaultHeader.style.display = "flex";
        searchHeader.style.display = "none";
        if (searchInput) {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));
        }
    }
}`;
        
        c = c.slice(0, brokenLine) + correctContent + c.slice(lineEnd);
        console.log('Fixed broken encryption line');
    } else {
        console.log('Broken encryption line not found');
        // Show context around previewAvatar
        const pvIdx = c.indexOf('window.previewAvatar');
        if (pvIdx !== -1) {
            console.log('Context before previewAvatar:', JSON.stringify(c.slice(pvIdx - 100, pvIdx + 50)));
        }
    }
}

fs.writeFileSync('frontend/messenger_app.js', c);
console.log('Done. File saved.');

// Verify: check if file has syntax issues by looking for remaining corruption
if (c.includes('};d`')) {
    console.log('WARNING: Still contains };d`');
}
const lines = c.split('\n');
console.log('Total lines:', lines.length);
