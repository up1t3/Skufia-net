const fs = require('fs');

function fixFile(path) {
    let content = fs.readFileSync(path, 'utf8');

    // Fix document.getElementById(...)
    content = content.replace(/document\.getElementById\('settings-modal'\)\.style\.display='none'/g, "window.closeSettingsModal()");
    content = content.replace(/document\.getElementById\('settings-modal'\)\.style\.display='flex'/g, "window.openSettingsModal()");

    // Fix modal header for settings
    const oldHeaderRegex = /<div class="modal-header">\s*<h2>Настройки<\/h2>\s*<button class="close-btn-svg" onclick="window\.closeSettingsModal\(\)">\s*<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"><\/line><line x1="6" y1="6" x2="18" y2="18"><\/line><\/svg>\s*<\/button>\s*<\/div>/g;

    const newHeader = `<div class="modal-header" style="display: flex; align-items: center; justify-content: flex-start; gap: 15px;">
                <button class="icon-btn" onclick="window.closeSettingsModal()" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 6px; color: var(--text-main); font-size: 14px;">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    Назад
                </button>
                <h2 style="margin: 0;">Настройки</h2>
            </div>`;

    content = content.replace(oldHeaderRegex, newHeader);

    fs.writeFileSync(path, content, 'utf8');
}

fixFile('e:/AgentZero/usr/projects/skufia/frontend/messenger.html');
fixFile('e:/AgentZero/usr/projects/skufia/frontend/index.html');
