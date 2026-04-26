const fs = require('fs');
const f = 'frontend/index.html';
let h = fs.readFileSync(f, 'utf8');
// Normalize to LF, patch, keep as-is
const crlf = h.includes('\r\n');
const n = h.replace(/\r\n/g, '\n');
let out = n;

// ── 1. Description field after create-room-input ──────────────────────────
out = out.replace(
`                    <input type="text" id="create-room-input" class="cyber-input" style="width: 100%; margin-top: 5px; border-radius: 8px;" placeholder="Введите название...">
                </div>
                
                <div class="form-group" style="margin-bottom: 0; display: flex; align-items: center; justify-content: space-between; background: var(--bg-accent); border-radius: 8px; padding: 12px; border: 1px solid var(--border-metal);">
                    <div>
                        <label style="margin: 0; font-size: 14px;">Публичный чат</label>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">Любой участник может приглашать</div>
                    </div>
                    <input type="checkbox" id="create-room-public" style="width: 18px; height: 18px; cursor: pointer;">
                </div>
                <input type="hidden" id="create-room-type" value="group">
                <button id="create-room-confirm-btn" class="cyber-btn" style="width: 100%; border-radius: 8px;" onclick="window.confirmCreateRoom()">Создать чат</button>`,
`                    <input type="text" id="create-room-input" class="cyber-input" style="width: 100%; margin-top: 5px; border-radius: 8px;" placeholder="Введите название...">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 12px; color: var(--text-dim);">Описание (необязательно)</label>
                    <input type="text" id="create-room-desc" class="cyber-input" style="width: 100%; margin-top: 5px; border-radius: 8px;" placeholder="О чём эта группа?">
                </div>
                <div class="form-group" style="margin-bottom: 0; display: flex; align-items: center; justify-content: space-between; background: var(--bg-accent); border-radius: 8px; padding: 12px; border: 1px solid var(--border-metal);">
                    <div>
                        <label style="margin: 0; font-size: 14px;">Публичный доступ</label>
                        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">🔒 Выключено — только по инвайту</div>
                    </div>
                    <input type="checkbox" id="create-room-public" style="width: 18px; height: 18px; cursor: pointer;">
                </div>
                <input type="hidden" id="create-room-type" value="group">
                <button id="create-room-confirm-btn" class="cyber-btn" style="width: 100%; border-radius: 8px;" onclick="window.confirmCreateRoom()">🔒 Создать приватную группу</button>`
);

// ── 2. Add btn-group-settings after btn-add-member ────────────────────────
out = out.replace(
`                                            <button id="btn-add-member" onclick="window.openAddMemberModal()" style="display:none; color: var(--accent-cyan);">👥 Добавить участника</button>`,
`                                            <button id="btn-add-member" onclick="window.openAddMemberModal()" style="display:none; color: var(--accent-cyan);">👥 Добавить участника</button>
                                            <button id="btn-group-settings" onclick="window.openGroupSettings()" style="display:none; color: #f0b429;">⚙️ Управление группой</button>`
);

// ── 3. Add "Вступить по ссылке" after "Приватный чат" button ──────────────
const pivotSearch = `                    <span>Приватный чат</span>
                </button>
            </div>`;
const pivotReplace = `                    <span>Приватный чат</span>
                </button>
                <button class="menu-action-btn" onclick="document.getElementById('fab-hub-modal').style.display='none'; window.openJoinByInviteModal()">
                    <div class="icon-circle" style="background: rgba(0, 255, 65, 0.12); color: #00ff41;">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    </div>
                    <span>🔗 Вступить по ссылке</span>
                </button>
            </div>`;
out = out.replace(pivotSearch, pivotReplace);

// Restore CRLF if needed
if (crlf) out = out.replace(/\n/g, '\r\n');
fs.writeFileSync(f, out, 'utf8');

// Verify
const checks = [
    ['create-room-desc', 'Description field'],
    ['btn-group-settings', 'Group settings button'],
    ['openJoinByInviteModal', 'Join by invite button'],
];
checks.forEach(([needle, label]) => {
    console.log(`  ${out.includes(needle) ? '✓' : '✗'} ${label}`);
});
console.log('Done');
