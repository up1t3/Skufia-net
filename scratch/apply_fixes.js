const fs = require('fs');

const filesToUpdate = [
    'frontend/messenger.html',
    'frontend/index.html'
];

const headerRegex = /<div class="modal-header">[\s\S]*?<h2>Настройки<\/h2>[\s\S]*?<button class="close-btn-svg" onclick="document\.getElementById\('settings-modal'\)\.style\.display='none'">[\s\S]*?<\/button>\s*<\/div>/g;

const newHeader = `<div class="modal-header" style="display: flex; align-items: center; justify-content: flex-start; gap: 15px;">
                <button class="icon-btn" onclick="window.closeSettingsModal()" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 6px; color: var(--text-main); font-size: 14px;">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    Назад
                </button>
                <h2 style="margin: 0;">Настройки</h2>
            </div>`;

const saveBtnHTML = `
                <div class="form-group" style="margin-top: 15px; margin-bottom: 0;">
                    <button type="button" class="cyber-btn" style="width: 100%; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(0, 242, 255, 0.1); border-color: var(--accent-cyan); color: var(--accent-cyan);" onclick="window.saveProfileHandle(this)">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        СОХРАНИТЬ НАСТРОЙКИ
                    </button>
                </div>
`;

for (let file of filesToUpdate) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace Header
    content = content.replace(headerRegex, newHeader);
    
    // Insert Save Button before footer
    if (!content.includes('СОХРАНИТЬ НАСТРОЙКИ')) {
        content = content.replace(/<div style="margin-top: 15px; text-align: center; color: var\(--text-dim\); font-size: 11px;/, saveBtnHTML + '\n                <div style="margin-top: 15px; text-align: center; color: var(--text-dim); font-size: 11px;');
    }
    
    // Replace display='flex'
    content = content.replace(/document\.getElementById\('settings-modal'\)\.style\.display='flex'/g, 'window.openSettingsModal()');
    content = content.replace(/document\.getElementById\('settings-modal'\)\.style\.display='none'/g, 'window.closeSettingsModal()');
    
    fs.writeFileSync(file, content, 'utf8');
}

// Update app.js and messenger_app.js
const jsFiles = ['frontend/app.js', 'frontend/messenger_app.js'];

const injection = `
window.openSettingsModal = function() {
    const m = document.getElementById('settings-modal');
    if (m) m.style.display = 'flex';
    if (!window.location.hash.includes('settings')) {
        history.pushState({ modal: 'settings' }, '', '#settings');
    }
};

window.closeSettingsModal = function() {
    const m = document.getElementById('settings-modal');
    if (m) m.style.display = 'none';
    if (window.location.hash.includes('settings')) {
        history.back();
    }
};

window.addEventListener('popstate', (e) => {
    if (!window.location.hash.includes('settings')) {
        const sm = document.getElementById('settings-modal');
        if (sm && sm.style.display === 'flex') {
            sm.style.display = 'none';
        }
    }
});
`;

for (let file of jsFiles) {
    let content = fs.readFileSync(file, 'utf8');
    
    if (!content.includes('window.openSettingsModal =')) {
        content += '\\n' + injection;
    }
    
    // Add toast to previewAvatar
    if (content.includes('applyAvatarDisplay(dashAvatar, avatarUrl);') && !content.includes('Фотография загружена')) {
        content = content.replace('applyAvatarDisplay(dashAvatar, avatarUrl);', "applyAvatarDisplay(dashAvatar, avatarUrl);\\n        addLog('Фотография загружена. Не забудьте сохранить настройки.', 'success');");
    }
    
    // Add saveProfileHandle
    if (!content.includes('window.saveProfileHandle')) {
        const saveProfileFn = `
window.saveProfileHandle = async function(btn) {
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'СОХРАНЕНИЕ...';
    btn.style.opacity = '0.7';
    
    const handleInput = document.getElementById('settings-handle');
    const newHandle = handleInput ? handleInput.value.trim() : null;
    
    try {
        const payload = {};
        if (newHandle) payload.handle = newHandle;
        
        if (Object.keys(payload).length > 0) {
            const resp = await apiRequest('/me/update', 'POST', payload);
            if (resp && resp.handle) {
                if (window.state && window.state.user) {
                    window.state.user.handle = resp.handle;
                }
            }
        }
        
        btn.innerHTML = 'СОХРАНЕНО ✓';
        btn.style.background = 'rgba(0, 255, 128, 0.1)';
        btn.style.borderColor = '#00ff80';
        btn.style.color = '#00ff80';
        addLog('Настройки успешно сохранены.', 'success');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = 'rgba(0, 242, 255, 0.1)';
            btn.style.borderColor = 'var(--accent-cyan)';
            btn.style.color = 'var(--accent-cyan)';
            btn.style.opacity = '1';
        }, 2000);
        
    } catch (e) {
        console.error('Failed to save profile:', e);
        btn.innerHTML = 'ОШИБКА ✕';
        btn.style.borderColor = '#ff3333';
        btn.style.color = '#ff3333';
        addLog('Ошибка при сохранении настроек.', 'error');
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.borderColor = 'var(--accent-cyan)';
            btn.style.color = 'var(--accent-cyan)';
            btn.style.opacity = '1';
        }, 3000);
    }
};
`;
        content += '\\n' + saveProfileFn;
    }
    
    fs.writeFileSync(file, content, 'utf8');
}
console.log('Update complete');
