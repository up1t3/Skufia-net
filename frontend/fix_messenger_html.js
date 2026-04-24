
const fs = require('fs');
const path = 'e:/AgentZero/usr/projects/skufia/frontend/messenger.html';

try {
    const content = fs.readFileSync(path, 'utf8');
    const lines = content.split('\n');

    // Find the range of the settings modal
    // It starts with <!-- Settings Modal --> or around line 89
    // It ends with the next modal or around line 179
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('<!-- Settings Modal -->')) {
            startIndex = i;
        }
        if (startIndex !== -1 && lines[i].includes('<!-- Contact Profile Modal -->')) {
            endIndex = i;
            break;
        }
    }

    if (startIndex === -1 || endIndex === -1) {
        // Fallback to line numbers if comments not found
        startIndex = 88; // 0-indexed 88 is line 89
        endIndex = 179;
    }

    const newModal = `    <!-- Settings Modal -->
    <div id="settings-modal" class="modal" style="display: none;">
        <div class="modal-content glass-panel" style="max-width: 420px; padding: 0; border-radius: 20px; overflow: hidden; border: 1px solid var(--border-metal); box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
            <!-- Header -->
            <div class="modal-header" style="display: flex; align-items: center; padding: 15px 20px; background: rgba(0,242,255,0.03); border-bottom: 1px solid var(--border-metal);">
                <button class="back-btn-premium" onclick="window.closeSettingsModal()" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-metal); color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 12px; border-radius: 10px; transition: all 0.2s; font-weight: 500;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    Назад
                </button>
                <h2 style="margin: 0; font-size: 17px; flex-grow: 1; text-align: center; font-weight: 700; letter-spacing: 0.5px; color: var(--text-main);">НАСТРОЙКИ</h2>
                <div style="width: 75px;"></div> <!-- Balance for centering -->
            </div>
            
            <div class="settings-scroll-area premium-scroll" style="max-height: 80vh; overflow-y: auto; padding: 25px; display: flex; flex-direction: column; gap: 20px;">
                
                <!-- Profile Section Group -->
                <div style="display: flex; flex-direction: column; gap: 20px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);">
                    <!-- Avatar Upload Section -->
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div class="avatar-upload-container" style="position: relative; cursor: pointer; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);" onclick="document.getElementById('settings-avatar-upload').click()" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                            <img id="settings-avatar-preview" src="https://ui-avatars.com/api/?name=User&background=1f2937&color=00f2ff" alt="Avatar" style="width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent-cyan); box-shadow: 0 0 20px rgba(0,242,255,0.2);">
                            <div class="avatar-overlay" style="position: absolute; bottom: 2px; right: 2px; background: var(--accent-cyan); width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.4); border: 2px solid var(--bg-surface);">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="#000" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                            </div>
                        </div>
                        <input type="file" id="settings-avatar-upload" accept="image/*" style="display: none;" onchange="window.previewAvatar(this)">
                        <span style="font-size: 11px; color: var(--text-dim); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Изменить фото профиля</span>
                    </div>

                    <!-- Handle Input -->
                    <div class="form-group" style="margin-bottom: 0;">
                        <label for="settings-handle" style="font-size: 13px; margin-bottom: 8px; display: block; color: var(--text-dim); font-weight: 500;">Ваш уникальный никнейм</label>
                        <div style="display: flex; gap: 0; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                            <span style="display: flex; align-items: center; justify-content: center; background: rgba(0,242,255,0.05); border: 1px solid var(--border-metal); border-right: none; border-radius: 10px 0 0 10px; padding: 0 15px; color: var(--accent-cyan); font-weight: bold; font-size: 16px;">@</span>
                            <input type="text" id="settings-handle" class="cyber-input" style="width: 100%; border-radius: 0 10px 10px 0; padding: 12px 15px; font-size: 15px;" placeholder="username">
                        </div>
                    </div>

                    <!-- SAVE SETTINGS — Prominent Primary Action -->
                    <button id="btn-save-profile" onclick="window.saveProfileHandle()" class="cyber-btn primary-btn" style="width: 100%; border-radius: 12px; font-size: 15px; padding: 15px; font-weight: 800; letter-spacing: 1px; display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, #00f2ff, #0078ff); border: none; color: #000; box-shadow: 0 10px 25px rgba(0,242,255,0.25); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); margin-top: 5px;">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        СОХРАНИТЬ ПРОФИЛЬ
                    </button>
                </div>

                <!-- Appearance Section -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <h3 style="margin: 0; font-size: 13px; color: var(--accent-cyan); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Интерфейс</h3>
                    
                    <button onclick="document.getElementById('theme-switcher-modal').style.display='flex'" class="cyber-btn" style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-radius: 12px; font-size: 14px; background: var(--bg-accent); border: 1px solid var(--border-metal); color: var(--text-main); transition: all 0.2s;">
                        <span style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center;">
                                <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--accent-cyan)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10"></path></svg>
                            </div>
                            Цветовая схема
                        </span>
                        <div style="display: flex; align-items: center; gap: 8px; color: var(--text-dim);">
                            <span id="current-theme-label" style="font-size: 12px;">Cyber Dark</span>
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </button>

                    <button id="sync-contacts-btn" class="cyber-btn" style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-radius: 12px; font-size: 14px; background: var(--bg-accent); border: 1px solid var(--border-metal); color: var(--text-main); transition: all 0.2s;">
                        <span style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(0,255,65,0.05); display: flex; align-items: center; justify-content: center;">
                                <svg viewBox="0 0 24 24" width="18" height="18" stroke="#00ff41" stroke-width="2" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
                            </div>
                            Синхронизация контактов
                        </span>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </button>
                </div>

                <!-- Preferences Section -->
                <div style="background: rgba(0,0,0,0.2); border-radius: 16px; padding: 5px; border: 1px solid var(--border-metal);">
                    <div style="padding: 12px 15px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <label style="margin: 0; font-size: 14px; color: var(--text-main);">Звуковые уведомления</label>
                        <input type="checkbox" id="settings-sound-toggle" checked style="width: 18px; height: 18px; cursor: pointer;">
                    </div>
                    <div style="padding: 12px 15px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <label style="margin: 0; font-size: 14px; color: var(--text-main);">Push-уведомления</label>
                        <input type="checkbox" id="settings-push-toggle" checked style="width: 18px; height: 18px; cursor: pointer;">
                    </div>
                    <div style="padding: 12px 15px; display: flex; align-items: center; justify-content: space-between;">
                        <label style="margin: 0; font-size: 14px; color: var(--text-main);">Отправка по Enter</label>
                        <input type="checkbox" id="settings-enter-toggle" checked style="width: 18px; height: 18px; cursor: pointer;">
                    </div>
                </div>

                <!-- PWA Install & Footer -->
                <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 20px;">
                    <button onclick="window.location.href='skufenger.html'" class="pwa-install-btn" style="width: 100%; background: rgba(0,242,255,0.05); border: 1px dashed var(--accent-cyan); color: var(--accent-cyan); padding: 12px; border-radius: 12px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; transition: all 0.2s;">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        УСТАНОВИТЬ ПРИЛОЖЕНИЕ (PWA)
                    </button>

                    <div style="text-align: center; color: var(--text-dim); font-size: 11px; line-height: 1.6; opacity: 0.6; padding-bottom: 10px;">
                        <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 4px; font-size: 12px;">SKUFIA-NET // ENTERPRISE</div>
                        © 2026 Vladimir Popov. Все права защищены.<br>
                        Безопасное соединение E2EE активно.
                    </div>
                </div>
            </div>
        </div>
    </div>
`;

    const newLines = [
        ...lines.slice(0, startIndex),
        newModal,
        ...lines.slice(endIndex)
    ];

    fs.writeFileSync(path, newLines.join('\n'), 'utf8');
    console.log("Successfully redesigned Settings Modal in messenger.html");
} catch (err) {
    console.error("Error fixing file:", err);
    process.exit(1);
}
