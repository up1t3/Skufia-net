const fs = require('fs');

const files = ['frontend/messenger.html', 'frontend/index.html'];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // 1. Better Back Button in settings header
    const oldHeaderRegex = /<div class="modal-header" style="display: flex; align-items: center; justify-content: flex-start; gap: 15px;">[\s\S]*?<button class="icon-btn" onclick="window\.closeSettingsModal\(\)"[^>]*>[\s\S]*?<\/button>\s*<h2 style="margin: 0;">Настройки<\/h2>\s*<\/div>/g;
    
    const newHeader = `<div class="modal-header" style="display: flex; align-items: center; justify-content: flex-start; gap: 15px;">
                <button class="icon-btn" onclick="window.closeSettingsModal()" style="background: rgba(0, 242, 255, 0.1); border: 1px solid var(--accent-cyan); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: var(--accent-cyan); cursor: pointer; transition: all 0.2s ease;">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                </button>
                <h2 style="margin: 0; font-size: 20px;">Настройки</h2>
            </div>`;
    
    content = content.replace(oldHeaderRegex, newHeader);

    // 2. Hide "Синхронизация контактов"
    content = content.replace(/<button id="sync-contacts-btn"[^>]*>[\s\S]*?Синхронизация контактов\s*<\/button>/, '<!-- Sync Contacts Hidden -->');

    // 3. Move "СОХРАНИТЬ НАСТРОЙКИ" under Handle
    // Extract the save button first
    const saveBtnRegex = /<div class="form-group" style="margin-top: 15px; margin-bottom: 0;">\s*<button type="button" class="cyber-btn" [^>]*onclick="window\.saveProfileHandle\(this\)"[^>]*>[\s\S]*?СОХРАНИТЬ НАСТРОЙКИ\s*<\/button>\s*<\/div>/;
    
    const saveBtnMatch = content.match(saveBtnRegex);
    if (saveBtnMatch) {
        // Remove from current position
        content = content.replace(saveBtnRegex, '');
        
        // Find Handle section end to insert
        const handleSectionRegex = /(<small style="color: var\(--text-dim\); font-size: 11px; margin-top: 4px; display: block;">По этой ссылке вас смогут найти другие\.<\/small>\s*<\/div>)/;
        
        // We'll make the save button larger and better
        const enhancedSaveBtn = `
                <div class="form-group" style="margin-top: 15px; margin-bottom: 20px;">
                    <button type="button" class="cyber-btn primary-btn" style="width: 100%; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent-cyan); color: #000; font-weight: bold; font-size: 16px; padding: 14px;" onclick="window.saveProfileHandle(this)">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        СОХРАНИТЬ ПРОФИЛЬ
                    </button>
                </div>`;
        
        content = content.replace(handleSectionRegex, '$1\\n' + enhancedSaveBtn);
    }
    
    // 4. Move PWA install button to bottom
    const pwaBtnRegex = /<div class="form-group" style="margin-bottom: 0;">\s*<button onclick="window\.location\.href='skufenger\.html'" [^>]*>[\s\S]*?Установить приложение \(PWA\)[\s\S]*?<\/button>\s*<\/div>/;
    const pwaBtnMatch = content.match(pwaBtnRegex);
    if (pwaBtnMatch) {
        // Remove from current position
        content = content.replace(pwaBtnRegex, '');
        // Insert right before footer disclaimer
        const footerRegex = /(<div style="margin-top: 15px; text-align: center; color: var\(--text-dim\); font-size: 11px;)/;
        content = content.replace(footerRegex, pwaBtnMatch[0] + '\\n                $1');
    }

    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
});
