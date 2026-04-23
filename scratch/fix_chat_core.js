const fs = require('fs');

let content = fs.readFileSync('frontend/chat_core.js', 'utf8');
const lines = content.split('\n');

// Find line 147 (0-indexed: 146) - the avatarDiv.style.background line
// and line 267 (0-indexed: 266) - the "/** @param {any} msg */" line
// We need to replace lines 147-266 (0-indexed: 146-265)

// Verify we have the right anchor points
const line147 = lines[146];
const line268 = lines[267];

console.log('Line 147:', line147.trim().substring(0, 80));
console.log('Line 268:', line268.trim().substring(0, 80));

if (!line147.includes('avatarDiv.style.background')) {
    console.error('ERROR: Line 147 does not contain expected content!');
    process.exit(1);
}
if (!line268.includes('@param {any} msg')) {
    console.error('ERROR: Line 268 does not contain expected content!');
    process.exit(1);
}

// The replacement: properly close renderChatRooms + add selectChatRoom as separate function
const replacement = `                avatarDiv.style.background = \`linear-gradient(135deg, hsl(\${hue}, 70%, 50%), hsl(\${hue}, 80%, 30%))\`;
                avatarDiv.style.color = '#fff';
                avatarDiv.style.display = 'flex';
                avatarDiv.style.alignItems = 'center';
                avatarDiv.style.justifyContent = 'center';
                avatarDiv.style.fontSize = '20px';
                avatarDiv.style.fontWeight = 'bold';
                avatarDiv.style.textShadow = '0 1px 3px rgba(0,0,0,0.5)';
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'sidebar-item-info';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'sidebar-item-name';
            nameDiv.textContent = room.name;

            const lastMsgDiv = document.createElement('div');
            lastMsgDiv.className = 'sidebar-item-last-msg';
            lastMsgDiv.textContent = room.last_message || '\u041D\u0435\u0442 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439';

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(lastMsgDiv);

            const statusSpan = document.createElement('span');
            statusSpan.className = \`status-dot \${room.is_online ? 'online' : ''}\`;
            // Show status dot only for private chats
            statusSpan.style.display = room.type === 'private' ? 'inline-block' : 'none';

            // Delete/Leave button (visible on hover)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'room-delete-btn';
            deleteBtn.innerHTML = '\u2715';
            deleteBtn.title = room.type === 'private' ? '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C / \u0443\u0434\u0430\u043B\u0438\u0442\u044C';
            deleteBtn.style.cssText = \`
                display: none; position: absolute; right: 6px; top: 50%;
                transform: translateY(-50%);
                background: rgba(255,50,50,0.15); border: 1px solid rgba(255,50,50,0.4);
                color: #ff5555; border-radius: 50%; width: 22px; height: 22px;
                font-size: 11px; cursor: pointer; line-height: 1;
                transition: background 0.2s;
            \`;
            deleteBtn.onmouseenter = () => deleteBtn.style.background = 'rgba(255,50,50,0.4)';
            deleteBtn.onmouseleave = () => deleteBtn.style.background = 'rgba(255,50,50,0.15)';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const label = room.type === 'private' ? '\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0439 \u0447\u0430\u0442' : '\u043F\u043E\u043A\u0438\u043D\u0443\u0442\u044C/\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0443 \u043A\u043E\u043C\u043D\u0430\u0442\u0443';
                if (!confirm(\`\u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B, \u0447\u0442\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \${label}? \u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E.\`)) return;
                try {
                    await apiRequest(\`/chat/rooms/\${room.id}\`, 'DELETE');
                    state.chat.rooms = state.chat.rooms.filter(r => r.id !== room.id);
                    if (state.chat.currentRoomId === room.id) {
                        state.chat.currentRoomId = null;
                        const chatMain = document.querySelector('.chat-main');
                        if (chatMain) chatMain.classList.remove('active');
                    }
                    renderChatRooms();
                    addLog('\u2705 \u0427\u0430\u0442 \u0443\u0434\u0430\u043B\u0451\u043D', 'success');
                } catch (err) {
                    addLog(\`\u274C \u041E\u0448\u0438\u0431\u043A\u0430: \${err.message}\`, 'error');
                }
            };
            div.style.position = 'relative';
            div.onmouseenter = () => { deleteBtn.style.display = 'block'; };
            div.onmouseleave = () => { deleteBtn.style.display = 'none'; };

            div.appendChild(avatarDiv);
            div.appendChild(infoDiv);
            div.appendChild(statusSpan);
            div.appendChild(deleteBtn);
            div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role);
            list.appendChild(div);
        });

    }

    async function selectChatRoom(roomId, roomName, type, receiverId, myRole) {
        state.chat.currentRoomId = roomId;
        state.chat.currentRoomType = type;
        state.chat.receiverId = receiverId;

        const chatHistoryEl = document.getElementById('chat-history');
        const header = document.querySelector('.chat-header');

        if (header) {
            const headerAvatar = document.getElementById('header-avatar');
            const headerTitle = document.getElementById('chat-header-title');
            
            if (headerAvatar) {
                headerAvatar.innerHTML = \`<img src="https://api.dicebear.com/7.x/identicon/svg?seed=\${roomName}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">\`;
                headerAvatar.style.background = 'transparent';
                headerAvatar.style.color = 'transparent';
            }
            if (headerTitle) {
                headerTitle.textContent = roomName.toUpperCase();
            }

            // Online status in header for private chats
            const headerStatus = document.getElementById('chat-header-status');
            const statusDot = header.querySelector('.status-dot');
            if (type === 'private') {
                const room = (state.chat.rooms || []).find(r => r.id === roomId);
                const isOnline = room && room.is_online;
                if (headerStatus) headerStatus.textContent = isOnline ? '\u0432 \u0441\u0435\u0442\u0438' : '\u043D\u0435 \u0432 \u0441\u0435\u0442\u0438';
                if (statusDot) {
                    statusDot.style.display = 'inline-block';
                    statusDot.className = \`status-dot \${isOnline ? 'online' : ''}\`;
                }
            } else {
                if (headerStatus) headerStatus.textContent = '';
                if (statusDot) statusDot.style.display = 'none';
            }

            let badgeDiv = document.getElementById('chat-encryption-status');
            if (!badgeDiv) {
                badgeDiv = document.createElement('div');
                badgeDiv.className = 'encryption-badge';
                badgeDiv.id = 'chat-encryption-status';
                const span = document.createElement('span');
                badgeDiv.appendChild(span);
                const profile = header.querySelector('.chat-header-profile');
                if (profile) profile.appendChild(badgeDiv);
            }
            badgeDiv.innerHTML = '<span></span>';
        }

        // --- E2EE v2: Use centralized key management ---
        if (type === 'private' && receiverId) {
            const badge = document.getElementById('chat-encryption-status');
            try {
                await ensureKeys();
                const sessionKey = await getOrEstablishSessionKey(roomId, receiverId);
                if (sessionKey) {
                    const myFp = state.chat.keyFingerprint || '';
                    if (badge) {
                        badge.innerHTML = \`\uD83D\uDD12 E2EE ACTIVE\`;
                        badge.title = \`\u0422\u0432\u043E\u0439 \u043E\u0442\u043F\u0435\u0447\u0430\u0442\u043E\u043A: \${myFp.slice(0, 23)}...\`;
                        badge.style.color = '#0f0';
                        badge.style.background = 'rgba(0, 255, 65, 0.1)';
                        badge.style.cursor = 'pointer';
                        badge.onclick = () => {
                            const fp = state.chat.keyFingerprint || '\u043D/\u0434';
                            alert(\`\uD83D\uDD11 \u0422\u0432\u043E\u0439 \u043E\u0442\u043F\u0435\u0447\u0430\u0442\u043E\u043A \u043A\u043B\u044E\u0447\u0430:\\n\${fp}\\n\\n\u041F\u043E\u043F\u0440\u043E\u0441\u0438 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0442\u0435\u0431\u0435 \u0441\u0432\u043E\u0439 \u043E\u0442\u043F\u0435\u0447\u0430\u0442\u043E\u043A \u0432\u0441\u043B\u0443\u0445 \u2014 \u043E\u043D\u0438 \u0434\u043E\u043B\u0436\u043D\u044B \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0442\u044C. \u0415\u0441\u043B\u0438 \u043D\u0435\u0442 \u2014 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u0430 \u0430\u0442\u0430\u043A\u0430 MITM.\`);
                        };
                    }
                } else {
                    if (badge) {
                        badge.innerHTML = '\u26A0\uFE0F E2EE \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D';
                        badge.style.color = '#ffaa00';
                        badge.style.background = 'rgba(255,170,0,0.1)';
                    }
                }
            } catch (e) {
                console.warn('E2EE init error:', e);
                if (badge) {
                    badge.innerHTML = \`\u26A0\uFE0F E2EE \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D\`;
                    badge.style.color = '#ffaa00';
                    badge.style.background = 'rgba(255,170,0,0.1)';
                }
            }
        }

        // Highlight active room in sidebar
        document.querySelectorAll('.sidebar-item').forEach(el => {
            const nameEl = el.querySelector('.sidebar-item-name');
            if (nameEl) {
                el.classList.toggle('active', nameEl.textContent === roomName);
            }
        });

        // Show/hide group management buttons in dropdown
        const isGroupOrChannel = ['group', 'channel'].includes(type);
        const isAdminOrOwner = ['owner', 'admin'].includes(myRole);
        const btnAddMember = document.getElementById('btn-add-member');
        const btnGroupSettings = document.getElementById('btn-group-settings');
        if (btnAddMember) btnAddMember.style.display = (isGroupOrChannel && isAdminOrOwner) ? 'block' : 'none';
        if (btnGroupSettings) btnGroupSettings.style.display = isGroupOrChannel ? 'block' : 'none';

        const chatLayout = document.querySelector('.chat-layout');
        if (chatLayout) chatLayout.classList.add('chat-open');

        if (chatHistoryEl) {
            chatHistoryEl.innerHTML = \`
                <div class="chat-placeholder">
                    <div class="skeleton-msg received"></div>
                    <div class="skeleton-msg sent"></div>
                    <div class="skeleton-msg received" style="width: 40%"></div>
                </div>
            \`;
            try {
                const response = await apiRequest(\`/chat/rooms/\${roomId}/history?limit=50\`);
                chatHistoryEl.innerHTML = '';
                const messages = response.messages || response; // backward compat
                state.chat.hasMore = response.has_more || false;
                state.chat.nextCursor = response.next_cursor || null;
                // @ts-ignore
                for (const m of messages) {
                    // Try decrypting history if we have the key
                    if (m.iv && state.chat.sessionKeys[roomId]) {
                        try {
                            m.text = await CryptoManager.decryptMessage(
                                state.chat.sessionKeys[roomId],
                                m.text,
                                m.iv
                            );
                            m.is_secure = true;
                        } catch(e) { m.text = "[ \u0417\u0410\u0428\u0418\u0424\u0420\u041E\u0412\u0410\u041D\u041E ]"; }
                    }
                    renderChatMessage(m);
                }
                chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
            } catch (e) { chatHistoryEl.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }

        }
    }`;

// Lines are 0-indexed. We want to replace lines 146 through 265 (inclusive).
// Line 146 = avatarDiv.style.background line (the start of corruption)
// Line 265 = closing "}" of the orphaned function
// Line 267 = "/** @param {any} msg */" which should remain

const newLines = [
    ...lines.slice(0, 146),       // Lines 1-146 (0-145)
    ...replacement.split('\n'),    // Our replacement
    '',                            // Blank line separator
    ...lines.slice(267)            // From "/** @param {any} msg */" onward
];

const result = newLines.join('\n');
fs.writeFileSync('frontend/chat_core.js', result, 'utf8');

console.log('✅ chat_core.js patched successfully!');
console.log('Old lines:', lines.length);
console.log('New lines:', newLines.length);

// Verify
const verify = fs.readFileSync('frontend/chat_core.js', 'utf8');
const checks = [
    ['function renderChatRooms()', 'renderChatRooms declaration'],
    ['async function selectChatRoom(', 'selectChatRoom declaration'],
    ['div.appendChild(avatarDiv)', 'sidebar appendChild'],
    ['div.appendChild(infoDiv)', 'info appendChild'],
    ['div.appendChild(statusSpan)', 'statusSpan appendChild'],
    ['function renderChatMessage(msg)', 'renderChatMessage declaration'],
    ['window.selectChatRoom', 'selectChatRoom export'],
];
checks.forEach(([needle, label]) => {
    console.log(`  ${verify.includes(needle) ? '✓' : '✗'} ${label}`);
});
