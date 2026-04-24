// Extracted Chat Logic
window.initChatCore = function() {
    // --- SKUFIA-NET CHAT HUB ---
    // Make it available globally for RTCManager
    window.sendSocketEvent = function(type, payload) {
        if(state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
            state.chat.socket.send(JSON.stringify({ type: type, ...payload }));
        }
    };

    window.connectWebSocket = function() {
        if (state.chat.socket) return;
        
        const token = state.user.token;
        if (!token) {
            console.warn('Cannot connect WebSocket: No token available.');
            return;
        }
        
        state.chat.socket = new WebSocket(`${WS_URL}/ws/chat/${token}`);

        state.chat.socket.onopen = () => {
            const globalInd = document.getElementById('global-status-indicator');
            if (globalInd) globalInd.classList.add('online');
            addLog('WebSocket Connection Established: Skufia-Net Online', 'success');
        };

        state.chat.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'rtc_signal') {
                if(window.RTCManagerInstance) {
                    window.RTCManagerInstance.handleIncomingSignal(data.signal_type, data.payload, data.sender_id);
                }
            } else if (data.type === 'new_message') {
                const msg = data;

                // Skip WS echo for own messages (already rendered optimistically)
                // Use == for type coercion (backend sends int, frontend may store string)
                if (msg.sender_id == state.user.id) {
                    // Just update sidebar snippet for own messages
                    loadChatRooms();
                    return;
                }
                
                // --- E2EE DECRYPTION (graceful) ---
                if (msg.iv && msg.iv.length > 0) {
                    let decrypted = false;
                    let keysArr = [];
                    const keys = state.chat.sessionKeys[msg.room_id];
                    if (keys) {
                        keysArr = Array.isArray(keys) ? keys : [keys];
                        for (let i = keysArr.length - 1; i >= 0; i--) {
                            try {
                                msg.content = await window.CryptoManager.decryptMessage(keysArr[i], msg.content, msg.iv);
                                msg.is_secure = true;
                                decrypted = true;
                                break;
                            } catch (e) {}
                        }
                    }

                    // Auto-healing: If all cached keys fail, fetch new bundle or renegotiate
                    if (!decrypted && typeof window.refreshSessionKey === 'function') {
                        const targetId = msg.sender_id;
                        const newKey = await window.refreshSessionKey(msg.room_id, targetId);
                        if (newKey) {
                            try {
                                msg.content = await window.CryptoManager.decryptMessage(newKey, msg.content, msg.iv);
                                msg.is_secure = true;
                                decrypted = true;
                            } catch (e) {}
                        }
                    }

                    if (!decrypted) {
                        msg.content = '🔒 Зашифрованное сообщение (ключ недоступен)';
                        msg.text = msg.content;
                    }
                }
                // If msg.iv is empty/null, content is plaintext — show as-is

                if (state.chat.currentRoomId === msg.room_id) {
                    renderChatMessage(msg);
                }
                if (msg.sender !== state.user.username) {
                    playSound('alert');
                }
                
                // Update sidebar snippet
                loadChatRooms();
            } else if (data.type === 'edit_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) {
                    let decryptedContent = data.content;
                    if (data.iv && state.chat.sessionKeys[data.room_id]) {
                        const keysArr = Array.isArray(state.chat.sessionKeys[data.room_id]) ? state.chat.sessionKeys[data.room_id] : [state.chat.sessionKeys[data.room_id]];
                        for (let i = keysArr.length - 1; i >= 0; i--) {
                            try {
                                decryptedContent = await window.CryptoManager.decryptMessage(keysArr[i], data.content, data.iv);
                                break;
                            } catch(e) {}
                        }
                    }
                    
                    let txtEl = el.querySelector('.msg-text');
                    if (txtEl) {
                        txtEl.textContent = decryptedContent;
                    } else {
                        txtEl = document.createElement('div');
                        txtEl.className = 'msg-text';
                        txtEl.textContent = decryptedContent;
                        const footer = el.querySelector('.msg-footer');
                        if (footer) {
                            el.insertBefore(txtEl, footer);
                        } else {
                            el.appendChild(txtEl);
                        }
                    }
                    
                    const footerDiv = el.querySelector('.msg-footer');
                    if (footerDiv && !footerDiv.querySelector('.is-edited')) {
                        const editedSpan = document.createElement('span');
                        editedSpan.className = 'is-edited';
                        editedSpan.textContent = 'изм. ';
                        footerDiv.insertBefore(editedSpan, footerDiv.firstChild);
                    }
                }
            } else if (data.type === 'delete_message') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) el.remove();
            } else if (data.type === 'read_ack') {
                const el = document.getElementById(`msg-${data.message_id}`);
                if (el) {
                    const timeSpan = el.querySelector('.msg-time');
                    if (timeSpan) {
                        const existingSvg = timeSpan.querySelector('svg');
                        if (existingSvg) existingSvg.remove();
                        timeSpan.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--accent-cyan); filter: drop-shadow(0px 0px 2px rgba(0,255,255,0.5)); margin-left:3px; vertical-align: middle;"><path d="M7 11.5L10 14.5L17 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M11 11.5L14 14.5L21 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>');
                    }
                }
            } else if (data.type === 'typing_status') {
                if (state.chat.currentRoomId === data.room_id && data.sender_id !== state.user.id) {
                    const typingEl = document.getElementById('typing-indicator');
                    if (typingEl) {
                        typingEl.textContent = `${data.sender} печатает...`;
                        typingEl.style.display = 'block';
                        // @ts-ignore
                        if (window.typingTimeout) clearTimeout(window.typingTimeout);
                        // @ts-ignore
                        window.typingTimeout = setTimeout(() => { typingEl.style.display = 'none'; }, 3000);
                    }
                }
            } else if (data.type === 'status_update') {
                loadChatRooms();
            } else if (data.type === 'room_key_rotated') {
                if (window.refreshSessionKey) {
                    window.refreshSessionKey(data.room_id);
                }
            }
        };

        state.chat.socket.onclose = () => {
            const globalInd = document.getElementById('global-status-indicator');
            if (globalInd) globalInd.classList.remove('online');
            state.chat.socket = null;
            addLog('WebSocket Link Severed. Retrying...', 'error');
            setTimeout(connectWebSocket, 5000);
        };
    }

    async function loadChatRooms() {
        const list = document.getElementById('chat-rooms-list');
        if (!list) return;
        try {
            const rooms = await apiRequest('/chat/rooms');
            state.chat.rooms = rooms;
            renderChatRooms();
        } catch (e) { addLog('Failed to load chat channels', 'error'); }
    }

    function renderChatRooms() {
        const list = document.getElementById('chat-rooms-list');
        if (!list) return;
        list.innerHTML = '';
        
        let roomsToRender = state.chat.rooms || [];
        if (state.chat.currentFolderId !== 'all') {
            const folder = state.chat.folders.find(f => f.id == state.chat.currentFolderId);
            if (folder && folder.rooms) {
                roomsToRender = roomsToRender.filter(r => folder.rooms.includes(r.id));
            }
        }

        // @ts-ignore
        roomsToRender.forEach(room => {
            const div = document.createElement('div');
            div.className = `sidebar-item ${state.chat.currentRoomId === room.id ? 'active' : ''}`;
            div.dataset.name = (room.name || '').toLowerCase();
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'sidebar-item-avatar';
            
            if (room.avatar_url) {
                const img = document.createElement('img');
                const aUrl = room.avatar_url.startsWith('http') ? room.avatar_url : `${BASE_URL}${room.avatar_url}`;
                img.src = aUrl + `?v=${Date.now()}`;
                img.alt = 'AV';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                avatarDiv.appendChild(img);
            } else {
                const initial = room.name ? room.name.charAt(0).toUpperCase() : '?';
                avatarDiv.textContent = initial;
                avatarDiv.classList.add('dynamic-avatar');
                const charCode = initial.charCodeAt(0) || 0;
                const hue = (charCode * 137) % 360;
                avatarDiv.style.background = `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${hue}, 80%, 30%))`;
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
            lastMsgDiv.textContent = room.last_message || 'Нет сообщений';

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(lastMsgDiv);

            const statusSpan = document.createElement('span');
            statusSpan.className = `status-dot ${room.is_online ? 'online' : ''}`;
            // Show status dot only for private chats
            statusSpan.style.display = room.type === 'private' ? 'inline-block' : 'none';

            // Unread badge
            let unreadBadge = null;
            if (room.unread_count && room.unread_count > 0) {
                unreadBadge = document.createElement('div');
                unreadBadge.className = 'unread-badge';
                unreadBadge.textContent = room.unread_count > 99 ? '99+' : room.unread_count;
                unreadBadge.style.cssText = `
                    background: var(--accent-cyan);
                    color: #000;
                    border-radius: 10px;
                    padding: 0 6px;
                    font-size: 11px;
                    font-weight: bold;
                    height: 20px;
                    min-width: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: absolute;
                    right: 15px;
                    top: 50%;
                    transform: translateY(-50%);
                    box-shadow: 0 0 5px var(--accent-cyan);
                `;
            }

            // Delete/Leave button (visible on hover)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'room-delete-btn';
            deleteBtn.innerHTML = '✕';
            deleteBtn.title = room.type === 'private' ? 'Удалить чат' : 'Покинуть / удалить';
            deleteBtn.style.cssText = `
                display: none; position: absolute; right: 6px; top: 50%;
                transform: translateY(-50%);
                background: rgba(255,50,50,0.15); border: 1px solid rgba(255,50,50,0.4);
                color: #ff5555; border-radius: 50%; width: 22px; height: 22px;
                font-size: 11px; cursor: pointer; line-height: 1;
                transition: background 0.2s;
            `;
            deleteBtn.onmouseenter = () => deleteBtn.style.background = 'rgba(255,50,50,0.4)';
            deleteBtn.onmouseleave = () => deleteBtn.style.background = 'rgba(255,50,50,0.15)';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const label = room.type === 'private' ? 'удалить этот приватный чат' : 'покинуть/удалить эту комнату';
                if (!confirm(`Вы уверены, что хотите ${label}? Это действие необратимо.`)) return;
                try {
                    await apiRequest(`/chat/rooms/${room.id}`, 'DELETE');
                    state.chat.rooms = state.chat.rooms.filter(r => r.id !== room.id);
                    if (state.chat.currentRoomId === room.id) {
                        state.chat.currentRoomId = null;
                        const chatMain = document.querySelector('.chat-main');
                        if (chatMain) chatMain.classList.remove('active');
                    }
                    renderChatRooms();
                    addLog('✅ Чат удалён', 'success');
                } catch (err) {
                    addLog(`❌ Ошибка: ${err.message}`, 'error');
                }
            };
            div.style.position = 'relative';
            div.onmouseenter = () => { deleteBtn.style.display = 'block'; };
            div.onmouseleave = () => { deleteBtn.style.display = 'none'; };

            div.appendChild(avatarDiv);
            div.appendChild(infoDiv);
            div.appendChild(statusSpan);
            if (unreadBadge) div.appendChild(unreadBadge);
            div.appendChild(deleteBtn);
            div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role);
            list.appendChild(div);
        });

    }

    function renderFoldersTabs() {
        const tabsContainer = document.getElementById('chat-folders-tabs');
        if (!tabsContainer) return;
        
        tabsContainer.innerHTML = '';
        
        const allTab = document.createElement('div');
        allTab.className = 'folder-tab' + (state.chat.currentFolderId === 'all' ? ' active' : '');
        allTab.setAttribute('onclick', "window.selectFolder('all', this)");
        allTab.innerText = 'Все чаты';
        tabsContainer.appendChild(allTab);
        
        (state.chat.folders || []).forEach(folder => {
             const fTab = document.createElement('div');
             fTab.className = 'folder-tab' + (state.chat.currentFolderId == folder.id ? ' active' : '');
             fTab.setAttribute('onclick', "window.selectFolder(" + folder.id + ", this)");
             fTab.innerText = folder.name;
             tabsContainer.appendChild(fTab);
        });
        
        const addBtn = document.createElement('button');
        addBtn.className = 'add-folder-btn';
        addBtn.setAttribute('onclick', "window.openFolderModal()");
        addBtn.title = "Создать папку";
        addBtn.innerText = "+";
        tabsContainer.appendChild(addBtn);
        
        renderChatRooms();
    }

    async function selectChatRoom(roomId, roomName, type, receiverId, myRole) {
        state.chat.currentRoomId = roomId;
        state.chat.currentRoomType = type;
        state.chat.receiverId = receiverId;

        // Reset local unread count and remove badge visually
        const roomState = (state.chat.rooms || []).find(r => r.id === roomId);
        if (roomState) roomState.unread_count = 0;
        const activeRoomEl = document.querySelector(`.chat-room-item[data-room-id="${roomId}"] .unread-badge`);
        if (activeRoomEl) activeRoomEl.remove();

        const chatHistoryEl = document.getElementById('chat-history');
        const header = document.getElementById('chat-header');

        if (header) {
            const headerAvatar = document.getElementById('header-avatar');
            const headerTitle = document.getElementById('chat-header-title');
            
            if (headerAvatar) {
                const room = (state.chat.rooms || []).find(r => r.id === roomId);
                if (room && room.avatar_url) {
                    const avatarUrl = room.avatar_url.startsWith('http') ? room.avatar_url : `${BASE_URL}${room.avatar_url}`;
                    headerAvatar.innerHTML = `<img src="${avatarUrl}?v=${Date.now()}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                } else {
                    headerAvatar.innerHTML = `<img src="https://api.dicebear.com/7.x/identicon/svg?seed=${roomName}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                }
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
                if (headerStatus) headerStatus.textContent = isOnline ? 'в сети' : 'не в сети';
                if (statusDot) {
                    statusDot.style.display = 'inline-block';
                    statusDot.className = `status-dot ${isOnline ? 'online' : ''}`;
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

        // --- E2EE: INITIALIZATION ---
        if (type === 'private') {
            const badge = document.getElementById('chat-encryption-status');
            if (badge) {
                badge.style.display = 'flex';
                badge.innerHTML = '<span style="color:var(--text-dim)">⏳ Установка E2EE...</span>';
                
                // Trigger Key Exchange!
                if (typeof getOrEstablishSessionKey === 'function') {
                    getOrEstablishSessionKey(roomId, receiverId).then(key => {
                        if (key) {
                            badge.innerHTML = '<span style="color:var(--accent-cyan)">🔒 E2EE Активно</span>';
                        } else {
                            badge.innerHTML = '<span style="color:var(--accent-amber)">⚠️ Собеседник без E2EE</span>';
                        }
                    }).catch(e => {
                        console.error('E2EE Error:', e);
                        badge.innerHTML = '<span style="color:var(--accent-amber)">⚠️ Ошибка E2EE</span>';
                    });
                } else {
                    badge.innerHTML = '<span style="color:var(--accent-amber)">⚠️ E2EE Недоступно</span>';
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
        if (chatLayout && !chatLayout.classList.contains('chat-open')) {
            chatLayout.classList.add('chat-open');
            const isMobile = window.innerWidth <= 768;
            const isFullscreen = document.body.classList.contains('skufenger-fullscreen');
            if (isMobile || isFullscreen) {
                try {
                    history.pushState({ skufia: true, view: 'messages', chat: true }, "Chat", "");
                } catch(e) {}
            }
        }

        if (chatHistoryEl) {
            chatHistoryEl.innerHTML = `
                <div class="chat-placeholder">
                    <div class="skeleton-msg received"></div>
                    <div class="skeleton-msg sent"></div>
                    <div class="skeleton-msg received" style="width: 40%"></div>
                </div>
            `;
            try {
                const response = await apiRequest(`/chat/rooms/${roomId}/history?limit=50`);
                chatHistoryEl.innerHTML = '';
                const messages = response.messages || response; // backward compat
                state.chat.hasMore = response.has_more || false;
                state.chat.nextCursor = response.next_cursor || null;
                let hasAttemptedRefresh = false;
                // @ts-ignore
                for (const m of messages) {
                    // Try decrypting history if we have the key
                    if (m.iv && m.iv.length > 0) {
                        let decrypted = false;
                        const keys = state.chat.sessionKeys[roomId];
                        if (keys) {
                            const keysArr = Array.isArray(keys) ? keys : [keys];
                            for (let i = keysArr.length - 1; i >= 0; i--) {
                                try {
                                    m.text = await window.CryptoManager.decryptMessage(keysArr[i], m.text, m.iv);
                                    m.is_secure = true;
                                    decrypted = true;
                                    break;
                                } catch(e) {}
                            }
                        }

                        // Try to auto-heal ONCE per batch if decryption fails
                        if (!decrypted && typeof window.refreshSessionKey === 'function' && !hasAttemptedRefresh) {
                            hasAttemptedRefresh = true;
                            const targetId = m.sender_id == state.user.id ? state.chat.receiverId : m.sender_id;
                            const newKey = await window.refreshSessionKey(roomId, targetId);
                            if (newKey) {
                                try {
                                    m.text = await window.CryptoManager.decryptMessage(newKey, m.text, m.iv);
                                    m.is_secure = true;
                                    decrypted = true;
                                } catch (e) {}
                            }
                        }

                        if (!decrypted) {
                            m.text = '🔒 Зашифрованное сообщение (ключ недоступен)';
                        }
                    }
                    // If iv is empty/null, m.text is plaintext — render as-is
                    renderChatMessage(m);
                }
                chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
            } catch (e) { chatHistoryEl.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }

        }

        // Scroll to input to ensure it's visible inside embedded viewports on mobile
        setTimeout(() => {
            const chatInput = document.getElementById('msg-input');
            if (chatInput) {
                chatInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        }, 100);
    }

    /** @param {any} msg */
    function renderChatMessage(msg) {
        const history = document.getElementById('chat-history');
        if (!history) return;

        // Prevent duplicates (e.g. from optimistic render + WS echo)
        if (document.getElementById(`msg-${msg.id}`)) return;

        const placeholder = history.querySelector('.chat-placeholder');
        if (placeholder) placeholder.remove();

        const isMe = msg.sender_id === state.user.id || msg.sender === state.user.username;

        const dateObj = new Date(msg.timestamp);
        let timeStr = msg.timestamp || '00:00';
        if (!isNaN(dateObj.getTime())) {
            timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        const fileUrl = msg.file_url || null;
        let fileHtml = '';
        if (fileUrl) {
            let urls = [];
            try {
                urls = fileUrl.startsWith('[') ? JSON.parse(fileUrl) : [fileUrl];
            } catch (e) {
                urls = [fileUrl];
            }
            
            if (urls.length > 1) {
                fileHtml = '<div class="msg-gallery">';
                urls.forEach(url => {
                    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
                    if (isImage) {
                        fileHtml += `<a href="${BASE_URL}${url}" target="_blank" onclick="window.openLightbox(event, '${BASE_URL}${url}')"><img class="msg-gallery-img" src="${BASE_URL}${url}" alt="attachment"></a>`;
                    } else {
                        const fname = url.split('/').pop() || 'file';
                        fileHtml += `<a class="msg-file-attachment" href="${BASE_URL}${url}" target="_blank" download><span class="file-icon">📁</span> СКАЧАТЬ: ${fname}</a>`;
                    }
                });
                fileHtml += '</div>';
            } else if (urls.length === 1) {
                const url = urls[0];
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
                if (isImage) {
                    fileHtml = `<a href="${BASE_URL}${url}" target="_blank" onclick="window.openLightbox(event, '${BASE_URL}${url}')"><img class="msg-file-img-preview" src="${BASE_URL}${url}" alt="attachment"></a>`;
                } else {
                    const fname = url.split('/').pop() || 'file';
                    fileHtml = `<a class="msg-file-attachment" href="${BASE_URL}${url}" target="_blank" download><span class="file-icon">📁</span> СКАЧАТЬ: ${fname}</a>`;
                }
            }
        }

        // ── Telegram-style: wrap bubble in a row ──────────────────────
        const row = document.createElement('div');
        row.className = `msg-row ${isMe ? 'msg-row-sent' : 'msg-row-received'}`;

        // Avatar (incoming only)
        if (!isMe) {
            const senderName = msg.sender || '?';
            const initial = senderName.charAt(0).toUpperCase();
            const charCode = initial.charCodeAt(0) || 65;
            const hue = (charCode * 137) % 360;

            const avatarEl = document.createElement('div');
            avatarEl.className = 'msg-avatar';

            const rawAvatarUrl = msg.avatar_url || null;
            const avatarUrl = rawAvatarUrl
                ? (rawAvatarUrl.startsWith('http') ? rawAvatarUrl : `${BASE_URL}${rawAvatarUrl}`)
                : null;

            if (avatarUrl) {
                const img = document.createElement('img');
                img.src = `${avatarUrl}?v=${Date.now()}`;
                img.alt = senderName;
                img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
                avatarEl.appendChild(img);
            } else {
                avatarEl.style.background = `linear-gradient(135deg,hsl(${hue},65%,55%),hsl(${hue},75%,35%))`;
                avatarEl.style.color = '#fff';
                avatarEl.style.display = 'flex';
                avatarEl.style.alignItems = 'center';
                avatarEl.style.justifyContent = 'center';
                avatarEl.style.fontWeight = 'bold';
                avatarEl.style.fontSize = '14px';
                avatarEl.textContent = initial;
            }
            row.appendChild(avatarEl);
        }

        // Bubble
        const div = document.createElement('div');
        div.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
        div.id = `msg-${msg.id}`;

        // Sender name (inside bubble, top — incoming only, groups/channels)
        if (!isMe) {
            const senderSpan = document.createElement('div');
            senderSpan.className = 'msg-sender-name';
            senderSpan.textContent = msg.sender || '';
            div.appendChild(senderSpan);
        }

        // Reply badge
        if (msg.reply_to_id) {
            const replyEl = document.createElement('div');
            replyEl.className = 'reply-badge';
            
            // Try to find original message in DOM for context
            const origMsgEl = document.getElementById(`msg-${msg.reply_to_id}`);
            let quotedText = 'Перейти к сообщению...';
            let quotedSender = '';
            
            if (origMsgEl) {
                const textEl = origMsgEl.querySelector('.msg-text');
                if (textEl) {
                    quotedText = textEl.innerText.substring(0, 40);
                    if (textEl.innerText.length > 40) quotedText += '...';
                }
                const senderEl = origMsgEl.querySelector('.msg-sender-name');
                if (senderEl) {
                    quotedSender = senderEl.innerText;
                } else if (origMsgEl.classList.contains('msg-sent')) {
                    quotedSender = state.user.username || 'Я';
                }
            }
            
            if (quotedSender) {
                replyEl.innerHTML = `<div style="font-weight:bold; color:var(--accent-cyan); font-size:11px; margin-bottom:2px;">${quotedSender}</div><div>${quotedText}</div>`;
            } else {
                replyEl.innerHTML = `<div>${quotedText}</div>`;
            }

            replyEl.onclick = () => {
                const target = document.getElementById(`msg-${msg.reply_to_id}`);
                if (target) {
                    target.scrollIntoView({behavior:'smooth', block: 'center'});
                    target.style.transition = 'background 0.5s';
                    const oldBg = target.style.background;
                    target.style.background = 'rgba(0, 242, 255, 0.3)';
                    setTimeout(() => target.style.background = oldBg, 1500);
                }
            };
            div.appendChild(replyEl);
        }

        const textDiv = document.createElement('div');
        textDiv.className = 'msg-text';
        textDiv.textContent = msg.text || msg.content || '';
        div.appendChild(textDiv);

        if (fileHtml) {
            const fileContainer = document.createElement('div');
            fileContainer.innerHTML = fileHtml;
            while (fileContainer.firstChild) div.appendChild(fileContainer.firstChild);
        }

        const footerDiv = document.createElement('div');
        footerDiv.className = 'msg-footer';
        
        if (msg.is_secure || msg.iv) {
            const secureSpan = document.createElement('span');
            secureSpan.className = 'msg-secure-icon';
            secureSpan.textContent = '🔒 ';
            footerDiv.appendChild(secureSpan);
        }
        if (msg.is_edited) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'is-edited';
            editedSpan.textContent = 'изм. ';
            footerDiv.appendChild(editedSpan);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        timeSpan.textContent = timeStr;
        if (isMe) {
            const isRead = msg.is_read;
            const checkSvg = isRead 
                ? '<svg viewBox="0 0 24 24" width="18" height="18" style="color:#00ffaa; margin-left:4px; vertical-align: middle;"><path d="M2 12l4 4 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 12l4 4 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
                : '<svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--text-dim); margin-left:3px; vertical-align: middle;"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
            timeSpan.insertAdjacentHTML('beforeend', checkSvg);
        } else if (!msg.is_read && state.chat.socket && state.chat.socket.readyState === 1) {
            state.chat.socket.send(JSON.stringify({
                type: 'read_ack',
                room_id: state.chat.currentRoomId,
                message_id: msg.id
            }));
        }
        footerDiv.appendChild(timeSpan);
        div.appendChild(footerDiv);
        
        // Action Button for Discoverable Context Menu
        const actionBtn = document.createElement('div');
        actionBtn.className = 'msg-action-btn';
        actionBtn.innerHTML = '&#8942;'; // vertical ellipsis
        actionBtn.title = 'Меню сообщения';
        div.appendChild(actionBtn);

        const showContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
            const menu = document.createElement('div');
            menu.className = 'msg-context-menu';
            
            // @ts-ignore
            let cleanText = (msg.text || msg.content || '').replace(/[`]/g, '');
            menu.innerHTML = '';
            const replyDiv = document.createElement('div');
            replyDiv.textContent = 'Ответить';
            replyDiv.onclick = (ev) => { ev.stopPropagation(); setReply(msg.id, cleanText); menu.remove(); };
            menu.appendChild(replyDiv);

            if (isMe) {
                const editDiv = document.createElement('div');
                editDiv.textContent = 'Редактировать';
                editDiv.onclick = (ev) => { ev.stopPropagation(); setEdit(msg.id, cleanText); menu.remove(); };
                menu.appendChild(editDiv);

                const deleteDiv = document.createElement('div');
                deleteDiv.className = 'delete-ctx';
                deleteDiv.textContent = 'Удалить';
                deleteDiv.onclick = (ev) => { ev.stopPropagation(); deleteMessage(msg.id); menu.remove(); };
                menu.appendChild(deleteDiv);
            }
            document.body.appendChild(menu);
            
            // Adjust position to keep within viewport
            const rect = menu.getBoundingClientRect();
            let left = e.pageX;
            let top = e.pageY;
            
            if (left + rect.width > window.innerWidth) {
                left = window.innerWidth - rect.width - 10;
            }
            if (top + rect.height > window.innerHeight) {
                top = window.innerHeight - rect.height - 10;
            }
            
            menu.style.left = `${Math.max(10, left)}px`;
            menu.style.top = `${Math.max(10, top)}px`;

            setTimeout(() => { document.addEventListener('click', () => menu.remove(), {once: true}); }, 0);
        };

        // Context menu bindings
        div.oncontextmenu = showContextMenu;
        actionBtn.onclick = showContextMenu;
        
        // Touch support for long press
        let touchTimer;
        div.addEventListener('touchstart', (e) => {
            touchTimer = setTimeout(() => {
                showContextMenu(e.touches[0]);
            }, 600); // 600ms long press
        }, {passive: true});
        div.addEventListener('touchend', () => clearTimeout(touchTimer));
        div.addEventListener('touchmove', () => clearTimeout(touchTimer));

        row.appendChild(div);
        history.appendChild(row);
        history.scrollTop = history.scrollHeight;
    }

    async function sendChatMsg() {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('chat-input'));
        if (!input || !input.value.trim() || !state.chat.currentRoomId) return;

        // Prevent double sending
        if (input.disabled) return;
        input.disabled = true;
        const originalPlaceholder = input.placeholder;
        input.placeholder = 'Отправка...';
        
        let content = input.value.trim();

        const roomId = state.chat.currentRoomId;
        const receiverId = state.chat.receiverId;

        let fileUrlPayload = null;
        if (state.pendingFiles && state.pendingFiles.length > 0) {
            if (state.pendingFiles.length === 1) {
                fileUrlPayload = state.pendingFiles[0].url;
            } else {
                fileUrlPayload = JSON.stringify(state.pendingFiles.map(f => f.url));
            }
        } else if (state.pendingFile) { // Fallback for old code
            fileUrlPayload = state.pendingFile.url;
        }

        let payload = {
            content,
            encryption_iv: '',
            file_url: fileUrlPayload,
            reply_to_id: state.chat.replyToId
        };

        try {
            // --- E2EE: ENCRYPTION ---
            let isEncrypted = false;
            if (state.chat.currentRoomType === 'private' && typeof getOrEstablishSessionKey === 'function') {
                const sessionKey = await getOrEstablishSessionKey(roomId, receiverId);
                if (sessionKey) {
                    const encrypted = await window.CryptoManager.encryptMessage(sessionKey, content);
                    payload.content = encrypted.content;
                    payload.encryption_iv = encrypted.iv;
                    isEncrypted = true;
                }
            }

            // At this point encryption succeeded or we fell back intentionally.
            // Clear input AFTER successful encryption, BEFORE network
            const savedContent = content;
            const savedFile = state.pendingFile ? { ...state.pendingFile } : null;
            const savedReplyId = state.chat.replyToId;
            const savedEditingId = state.chat.editingId;
            
            input.value = '';
            localStorage.removeItem(`skuf_draft_${roomId}`);
            // @ts-ignore
            if (window.cancelReply) window.cancelReply(); // this clears editingId!
            clearChatFile();

            let response;
            if (savedEditingId) {
                response = await apiRequest(`/chat/messages/${savedEditingId}`, 'PUT', payload);
                // Optimistic UI update for edit
                const el = document.getElementById(`msg-${savedEditingId}`);
                if (el) {
                    let textDiv = el.querySelector('.msg-text');
                    if (textDiv) {
                        textDiv.textContent = savedContent;
                    } else {
                        textDiv = document.createElement('div');
                        textDiv.className = 'msg-text';
                        textDiv.textContent = savedContent;
                        const footer = el.querySelector('.msg-footer');
                        if (footer) {
                            el.insertBefore(textDiv, footer);
                        } else {
                            el.appendChild(textDiv);
                        }
                    }
                    
                    const footerDiv = el.querySelector('.msg-footer');
                    if (footerDiv && !footerDiv.querySelector('.is-edited')) {
                        const editedSpan = document.createElement('span');
                        editedSpan.className = 'is-edited';
                        editedSpan.textContent = 'изм. ';
                        footerDiv.insertBefore(editedSpan, footerDiv.firstChild);
                    }
                }
            } else {
                response = await apiRequest(`/chat/rooms/${roomId}/send`, 'POST', payload);
                // Optimistic render — show message immediately, don't wait for WS echo
                const optimisticMsg = {
                    id: response?.id || Date.now(),
                    sender: state.user?.username || state.user?.display_name || 'Я',
                    sender_id: state.user?.id,
                    text: savedContent,
                    content: savedContent,
                    iv: isEncrypted ? payload.encryption_iv : null,
                    is_secure: isEncrypted,
                    file_url: savedFile ? savedFile.url : null,
                    reply_to_id: savedReplyId,
                    is_edited: false,
                    is_read: false,
                    timestamp: new Date().toISOString()
                };
                renderChatMessage(optimisticMsg);
            }
            const editBanner = document.getElementById('edit-banner');
            if (editBanner) editBanner.style.display = 'none';
            playSound('click');
        } catch (e) {
            console.error('sendChatMsg error:', e);
            addLog(`⚠️ Ошибка отправки: ${e.message}`, 'error');
            // Restore input on failure so user can retry
            input.value = content;
        } finally {
            input.disabled = false;
            input.placeholder = originalPlaceholder;
            input.focus();
        }
    }


    /** Upload a file to the server and store the URL in pendingFile */
    async function compressImage(file) {
        if (!file.type.startsWith('image/')) return file;
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const max_size = 1920; // max dimension
                    
                    if (width > height && width > max_size) {
                        height *= max_size / width;
                        width = max_size;
                    } else if (height > max_size) {
                        width *= max_size / height;
                        height = max_size;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Compress as JPEG (0.8 quality)
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            // Use the compressed file only if it's actually smaller
                            resolve(newFile.size < file.size ? newFile : file);
                        } else {
                            resolve(file);
                        }
                    }, 'image/jpeg', 0.8);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /** Upload multiple files to the server and store the URLs in pendingFiles */
    async function uploadChatFiles(/** @type {FileList | File[]} */ files) {
        const formData = new FormData();
        let totalSize = 0;
        let validFilesCount = 0;
        
        // Wait for all potential image compressions
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            
            if (file.type.startsWith('image/')) {
                file = await compressImage(file);
            }
            
            if (file.size > 5 * 1024 * 1024) {
                addLog(`Файл ${file.name} превышает лимит 5 МБ`, 'error');
                continue;
            }
            formData.append('files', file);
            totalSize += file.size;
            validFilesCount++;
        }
        if (validFilesCount === 0) return;

        try {
            const token = state.user.token;
            /** @type {Record<string, string>} */
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const resp = await fetch(`${API_BASE_URL}/chat/upload_multiple`, {
                method: 'POST',
                headers,
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                throw new Error(err.detail || 'Upload failed');
            }
            const data = await resp.json();
            
            if (!state.pendingFiles) state.pendingFiles = [];
            for (let i = 0; i < data.file_urls.length; i++) {
                // We use Array.from if it's FileList just to be safe
                const fileList = Array.from(files);
                state.pendingFiles.push({ url: data.file_urls[i], name: fileList[i] ? fileList[i].name : `file_${i}` });
            }
            
            // Show preview strip
            const preview = document.getElementById('chat-file-preview');
            const nameEl = document.getElementById('chat-file-name');
            if (preview) preview.style.display = 'flex';
            if (nameEl) nameEl.textContent = `📎 ${state.pendingFiles.length} файл(ов) (${(totalSize / 1024).toFixed(1)} KB)`;
            addLog(`Загружено ${validFilesCount} файл(ов)`, 'success');
        } catch (e) {
            addLog(`Ошибка загрузки: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
        }
    }

    function clearChatFile() {
        state.pendingFile = null;
        state.pendingFiles = [];
        const preview = document.getElementById('chat-file-preview');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
        if (preview) preview.style.display = 'none';
        if (fileInput) fileInput.value = '';
    }
    // @ts-ignore
    window.clearChatFile = clearChatFile;

    // @ts-ignore
    window.openFabHub = function() {
        document.getElementById('fab-hub-modal').style.display = 'flex';
        const contactList = document.getElementById('fab-contacts-list');
        contactList.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</div>';
        
        // Load all users initially
        apiRequest('/users/list').then(users => {
            state.contacts = users.filter(u => u.id !== state.user.id);
            window['filterFabContacts']();
        }).catch(e => {
            contactList.innerHTML = '<div style="text-align:center; padding:15px; color:red;">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438</div>';
        });
    };

    // Debounced server search
    let _fabSearchTimer = null;

    // @ts-ignore
    window.filterFabContacts = function() {
        const query = (document.getElementById('fab-contact-search')?.value || '').trim();
        const contactList = document.getElementById('fab-contacts-list');

        // If query long enough — search server (by phone or nickname)
        if (query.length >= 2) {
            clearTimeout(_fabSearchTimer);
            _fabSearchTimer = setTimeout(async () => {
                contactList.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-dim);">\u041f\u043e\u0438\u0441\u043a...</div>';
                try {
                    const results = await apiRequest(`/users/search/${encodeURIComponent(query)}`);
                    renderFabContacts(results, contactList);
                } catch(e) {
                    contactList.innerHTML = '<div style="text-align:center; padding:10px; color:red;">\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0438\u0441\u043a\u0430</div>';
                }
            }, 350);
            return;
        }

        // Otherwise filter local cache
        const filtered = (state.contacts || []).filter(u =>
            (u.username || '').toLowerCase().includes(query.toLowerCase())
        );
        renderFabContacts(filtered, contactList);
    };

    function renderFabContacts(users, contactList) {
        contactList.innerHTML = '';

        // --- Invite button always at top ---
        const inviteDiv = document.createElement('div');
        inviteDiv.style.cssText = 'padding: 10px 12px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-metal); cursor: pointer; border-radius: 8px; transition: background 0.15s;';
        inviteDiv.onmouseover = () => inviteDiv.style.background = 'rgba(0,242,255,0.07)';
        inviteDiv.onmouseout = () => inviteDiv.style.background = 'transparent';
        inviteDiv.innerHTML = `
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(0,242,255,0.12);border:1px dashed var(--accent-cyan);display:flex;align-items:center;justify-content:center;color:var(--accent-cyan);flex-shrink:0;">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </div>
            <div>
                <div style="font-size:14px;font-weight:600;color:var(--accent-cyan);">Пригласить друга</div>
                <div style="font-size:11px;color:var(--text-dim);">Отправить ссылку для регистрации в Skufia-Net</div>
            </div>
        `;
        inviteDiv.onclick = async () => {
            try {
                const resp = await apiRequest('/invite/generate', 'POST');
                const fullUrl = `${window.location.origin}${resp.invite_url}`;
                if (navigator.share) {
                    await navigator.share({
                        title: 'Skufia-Net — приглашение',
                        text: 'Присоединяйся ко мне в Skufia-Net — защищённом мессенджере для своих.',
                        url: fullUrl
                    });
                } else {
                    await navigator.clipboard.writeText(fullUrl);
                    addLog('Ссылка-приглашение скопирована в буфер — вставьте в WhatsApp, Telegram или SMS', 'success');
                }
            } catch(e) {
                addLog('Ошибка генерации ссылки', 'error');
            }
        };
        contactList.appendChild(inviteDiv);

        if (!users || users.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center; padding:20px; color:var(--text-dim); font-size:13px;';
            empty.textContent = 'Пользователи не найдены. Пригласите друзей!';
            contactList.appendChild(empty);
            return;
        }
        
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.cursor = 'pointer';
            
            const initial = (u.username || '?').charAt(0).toUpperCase();
            const charCode = initial.charCodeAt(0) || 65;
            const hue = (charCode * 137) % 360;
            const avatarUrl = u.avatar_url ? (u.avatar_url.startsWith('http') ? u.avatar_url : `${BASE_URL}${u.avatar_url}`) : null;
            const avatarHtml = avatarUrl 
                ? `<img src="${avatarUrl}?v=${Date.now()}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">` 
                : `<div class="sidebar-item-avatar dynamic-avatar" style="background:linear-gradient(135deg,hsl(${hue},70%,50%),hsl(${hue},80%,30%));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;">${initial}</div>`;
            const onlineDot = u.is_online ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00f2ff;margin-left:5px;vertical-align:middle;"></span>` : '';
            const handleText = u.handle ? `<span style="color:var(--text-dim);font-size:11px;">${u.handle}</span>` : '';
            
            div.innerHTML = `
                ${avatarHtml}
                <div class="sidebar-item-info">
                    <div class="sidebar-item-name">${u.username}${onlineDot}</div>
                    <div class="sidebar-item-last-msg">${handleText || 'Skufia-Net'}</div>
                </div>
            `;
            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: 'Private', room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? 'Чат уже существует' : 'Личный чат создан', 'success');
                    await window.loadChatRooms();
                    window.selectChatRoom(room.id, u.username, 'private', u.id, 'member');
                } catch(e) {
                    addLog('Ошибка создания чата', 'error');
                }
            };
            contactList.appendChild(div);
        });
    }

    // @ts-ignore
    window.openCreateRoomModal = function(type) {
        const modal = document.getElementById('create-room-modal');
        const title = document.getElementById('create-room-title');
        const label = document.getElementById('create-room-label');
        const typeInput = document.getElementById('create-room-type');
        const input = document.getElementById('create-room-input');
        const descInput = document.getElementById('create-room-desc');

        title.textContent = type === 'channel' ? 'СОЗДАТЬ КАНАЛ' : 'СОЗДАТЬ ГРУППУ';
        label.textContent = type === 'channel' ? 'Название канала' : 'Название группы';
        if (typeInput) typeInput.value = type;
        if (input) input.value = '';
        if (descInput) descInput.value = '';

        modal.style.display = 'flex';
        if (input) input.focus();
    };

    // @ts-ignore
    window.confirmCreateRoom = async function() {
        const input = document.getElementById('create-room-input');
        const typeInput = document.getElementById('create-room-type');
        const pubToggle = document.getElementById('create-room-public');
        const descInput = document.getElementById('create-room-desc');
        const name = input ? input.value.trim() : '';
        const rType = typeInput ? typeInput.value : 'group';
        const isPublic = pubToggle ? pubToggle.checked : false;
        const description = descInput ? descInput.value.trim() : '';

        if (!name) return;

        try {
            document.getElementById('create-room-modal').style.display = 'none';
            // Use new /chat/groups endpoint which sets owner_id and invite_code
            const payload = { name, room_type: rType, is_public: isPublic, description, initial_members: [] };
            const room = await apiRequest('/chat/groups', 'POST', payload);
            addLog(`✅ Создано: ${name}`, 'success');
            await loadChatRooms();
            // Auto-open the new room
            if (room && room.id) {
                selectChatRoom(room.id, name, rType, null, 'owner');
            }
        } catch (e) { addLog('Ошибка создания', 'error'); }
    };

    // ─── GROUP SETTINGS MODAL ───────────────────────────────────────────────

    /**
     * Opens the group/channel settings modal for the current room.
     * Shows member list, role management, invite links, and danger zone.
     */
    // @ts-ignore
    window.openGroupSettings = async function() {
        const roomId = state.chat.currentRoomId;
        const myRole = state.chat.currentMyRole;
        if (!roomId) return;
        if (window.toggleChatOptions) window.toggleChatOptions();

        // Fetch room info and members in parallel
        let roomInfo = null, members = [];
        try {
            [roomInfo, members] = await Promise.all([
                apiRequest(`/chat/rooms/${roomId}/info`),
                apiRequest(`/chat/rooms/${roomId}/members`)
            ]);
        } catch (e) {
            addLog('Не удалось загрузить информацию о группе', 'error');
            return;
        }

        const isAdmin = ['owner', 'admin'].includes(myRole);
        const isOwner = myRole === 'owner';

        // ── Build modal ──
        const existing = document.getElementById('group-settings-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'group-settings-modal';
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);
            display:flex; align-items:center; justify-content:center; z-index:9999;
            animation: fadeIn 0.2s ease;
        `;
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        const roleBadgeColor = { owner: '#f0b429', admin: '#00ff41', member: '#888', banned: '#f00' };
        const roleLabel = { owner: '👑 Владелец', admin: '⚡ Администратор', member: '👤 Участник', banned: '🚫 Заблокирован' };

        const membersHTML = members.map(m => {
            const canKick = isAdmin && m.role !== 'owner' && !(m.role === 'admin' && !isOwner) && m.user_id !== state.user.id;
            const canChangeRole = isOwner && m.role !== 'owner' && m.user_id !== state.user.id;
            const avatarUrl = m.avatar_url ? (m.avatar_url.startsWith('http') ? m.avatar_url : `${BASE_URL}${m.avatar_url}`) : null;
            const avatar = avatarUrl
                ? `<img src="${avatarUrl}?v=${Date.now()}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
                : `<img src="https://api.dicebear.com/7.x/identicon/svg?seed=${m.username}" style="width:36px;height:36px;border-radius:50%;">`;

            return `
            <div class="member-row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
                ${avatar}
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;">${m.username}</div>
                    <div style="font-size:11px;color:${roleBadgeColor[m.role] || '#888'};">${roleLabel[m.role] || m.role}</div>
                </div>
                <div style="display:flex;gap:6px;">
                    ${canChangeRole ? `
                        <select onchange="window.updateMemberRole(${roomId}, ${m.user_id}, this.value)"
                            style="background:var(--bg-panel);border:1px solid var(--border-metal);color:var(--text-primary);padding:3px 6px;border-radius:4px;font-size:11px;cursor:pointer;">
                            <option value="admin" ${m.role==='admin'?'selected':''}>⚡ Адмін</option>
                            <option value="member" ${m.role==='member'?'selected':''}>👤 Участник</option>
                            <option value="banned" ${m.role==='banned'?'selected':''}>🚫 Бан</option>
                        </select>
                    ` : ''}
                    ${canKick ? `
                        <button onclick="window.kickMember(${roomId}, ${m.user_id}, '${m.username}')"
                            style="background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.3);color:#ff5555;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">
                            Исключить
                        </button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');

        overlay.innerHTML = `
        <div style="background:var(--bg-panel);border:1px solid var(--border-metal);border-radius:16px;width:min(520px,95vw);max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
            <!-- Header -->
            <div style="padding:20px;border-bottom:1px solid var(--border-metal);display:flex;align-items:center;gap:14px;">
                <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#0f0,#0af);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">
                    ${roomInfo.type === 'channel' ? '📢' : '👥'}
                </div>
                <div style="flex:1;">
                    <div style="font-size:16px;font-weight:700;">${roomInfo.name}</div>
                    <div style="font-size:12px;color:var(--text-dim);">${roomInfo.type === 'channel' ? 'Канал' : 'Группа'} · ${roomInfo.member_count} участников · ${roomInfo.is_public ? '🌍 Публичный' : '🔒 Приватный'}</div>
                    ${roomInfo.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${roomInfo.description}</div>` : ''}
                </div>
                <button onclick="document.getElementById('group-settings-modal').remove()"
                    style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;padding:4px;">✕</button>
            </div>

            <!-- Invite section (admin only) -->
            ${isAdmin ? `
            <div style="padding:16px 20px;border-bottom:1px solid var(--border-metal);">
                <div style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:8px;">🔗 ПРИГЛАСИТЬ</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <div style="flex:1;background:rgba(0,255,65,0.07);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;color:#0f0;word-break:break-all;" id="invite-link-display">
                        ${window.location.origin}/join/${roomInfo.invite_code}
                    </div>
                    <button onclick="window.copyInviteLink('${roomInfo.invite_code}')"
                        style="background:rgba(0,255,65,0.1);border:1px solid rgba(0,255,65,0.3);color:#0f0;padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:12px;">
                        📋 Копировать
                    </button>
                </div>
                <button onclick="window.generateNewInvite(${roomId})"
                    style="margin-top:8px;background:none;border:1px solid var(--border-metal);color:var(--text-dim);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;">
                    ↻ Создать новую ссылку
                </button>
            </div>` : ''}

            <!-- Add member button (admin only) -->
            ${isAdmin ? `
            <div style="padding:12px 20px;border-bottom:1px solid var(--border-metal);">
                <button onclick="document.getElementById('group-settings-modal').remove(); window.openAddMemberModal();"
                    style="width:100%;background:rgba(0,175,255,0.1);border:1px solid rgba(0,175,255,0.3);color:#0af;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;">
                    ➕ Добавить участников
                </button>
            </div>` : ''}

            <!-- Members list -->
            <div>
                <div style="padding:12px 20px 8px;font-size:11px;letter-spacing:0.1em;color:var(--text-dim);">
                    👥 УЧАСТНИКИ (${members.length})
                </div>
                <div id="group-members-list">
                    ${membersHTML}
                </div>
            </div>

            <!-- Settings (admin only) -->
            ${isAdmin ? `
            <div style="padding:16px 20px;border-top:1px solid var(--border-metal);">
                <div style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:10px;">⚙️ НАСТРОЙКИ</div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-size:13px;">Публичный доступ</span>
                    <label style="position:relative;display:inline-block;width:44px;height:22px;">
                        <input type="checkbox" id="group-public-toggle" ${roomInfo.is_public ? 'checked' : ''}
                            onchange="window.toggleGroupPublic(${roomId}, this.checked)"
                            style="opacity:0;width:0;height:0;">
                        <span style="position:absolute;cursor:pointer;inset:0;background:${roomInfo.is_public ? '#0f0' : '#333'};border-radius:22px;transition:.3s;"></span>
                        <span style="position:absolute;content:'';height:16px;width:16px;left:3px;bottom:3px;background:white;border-radius:50%;transition:.3s;transform:${roomInfo.is_public ? 'translateX(22px)' : 'none'};"></span>
                    </label>
                </div>
            </div>` : ''}

            <!-- Danger zone / Leave -->
            <div style="padding:16px 20px;border-top:1px solid rgba(255,50,50,0.2);">
                ${isOwner ? `
                <button onclick="window.confirmDeleteRoom(${roomId}, '${roomInfo.name}')"
                    style="width:100%;background:rgba(255,50,50,0.1);border:1px solid rgba(255,50,50,0.4);color:#ff5555;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">
                    🗑️ Удалить группу навсегда
                </button>` : ''}
                <button onclick="window.leaveCurrentRoom(${roomId})"
                    style="width:100%;background:rgba(255,150,0,0.08);border:1px solid rgba(255,150,0,0.3);color:#ffaa00;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;">
                    🚪 Покинуть группу
                </button>
            </div>
        </div>`;

        document.body.appendChild(overlay);
    };

    // ─── Group management helper functions ──────────────────────────────────

    window.copyInviteLink = function(code) {
        const url = `${window.location.origin}/join/${code}`;
        navigator.clipboard.writeText(url).then(() => addLog('✅ Ссылка скопирована', 'success'));
    };

    window.generateNewInvite = async function(roomId) {
        try {
            const inv = await apiRequest(`/chat/rooms/${roomId}/invite`, 'POST', { max_uses: null, expires_hours: null });
            const el = document.getElementById('invite-link-display');
            if (el) el.textContent = `${window.location.origin}/join/${inv.invite_code}`;
            addLog('✅ Новая инвайт-ссылка создана', 'success');
        } catch (e) { addLog('Ошибка создания инвайта', 'error'); }
    };

    window.kickMember = async function(roomId, userId, username) {
        if (!confirm(`Исключить ${username} из группы?`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}/members/${userId}`, 'DELETE');
            addLog(`✅ ${username} исключён`, 'success');
            // Refresh modal
            window.openGroupSettings();
        } catch (e) { addLog('Ошибка исключения', 'error'); }
    };

    window.updateMemberRole = async function(roomId, userId, newRole) {
        try {
            await apiRequest(`/chat/rooms/${roomId}/members/${userId}/role`, 'PUT', { role: newRole });
            addLog(`✅ Роль обновлена`, 'success');
        } catch (e) {
            addLog('Ошибка изменения роли', 'error');
            window.openGroupSettings(); // revert UI
        }
    };

    window.toggleGroupPublic = async function(roomId, isPublic) {
        try {
            await apiRequest(`/chat/rooms/${roomId}/settings`, 'PUT', { is_public: isPublic });
            addLog(`✅ Доступ: ${isPublic ? 'публичный' : 'приватный'}`, 'success');
        } catch (e) { addLog('Ошибка изменения настроек', 'error'); }
    };

    window.confirmDeleteRoom = async function(roomId, name) {
        if (!confirm(`Удалить группу «${name}» навсегда? Это действие нельзя отменить.`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}`, 'DELETE');
            const modal = document.getElementById('group-settings-modal');
            if (modal) modal.remove();
            addLog('✅ Группа удалена', 'success');
            // Return to sidebar
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) chatMain.classList.remove('active');
            state.chat.currentRoomId = null;
            await loadChatRooms();
        } catch (e) { addLog('Ошибка удаления', 'error'); }
    };

    window.leaveCurrentRoom = async function(roomId) {
        const name = state.chat.currentRoomName || 'группу';
        if (!confirm(`Покинуть ${name}?`)) return;
        try {
            await apiRequest(`/chat/rooms/${roomId}/leave`, 'POST');
            const modal = document.getElementById('group-settings-modal');
            if (modal) modal.remove();
            addLog('✅ Вы покинули группу', 'info');
            const chatMain = document.querySelector('.chat-main');
            if (chatMain) chatMain.classList.remove('active');
            state.chat.currentRoomId = null;
            await loadChatRooms();
        } catch (e) { addLog('Ошибка выхода из группы', 'error'); }
    };

    // ─── Join by invite code ────────────────────────────────────────────────

    window.openJoinByInviteModal = function() {
        const existing = document.getElementById('join-invite-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'join-invite-modal';
        overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;`;
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
        <div style="background:var(--bg-panel);border:1px solid var(--border-metal);border-radius:16px;width:min(420px,92vw);padding:24px;">
            <div style="font-size:15px;font-weight:700;margin-bottom:16px;">🔗 ВСТУПИТЬ ПО ССЫЛКЕ</div>
            <input id="join-invite-input" type="text" placeholder="Вставьте инвайт-ссылку или код..."
                style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);border-radius:8px;padding:10px 12px;color:var(--text-primary);font-size:14px;box-sizing:border-box;margin-bottom:12px;">
            <div style="display:flex;gap:8px;">
                <button onclick="document.getElementById('join-invite-modal').remove()"
                    style="flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);color:var(--text-secondary);padding:10px;border-radius:8px;cursor:pointer;">
                    Отмена
                </button>
                <button onclick="window.submitJoinInvite()"
                    style="flex:1;background:linear-gradient(135deg,#0f0,#0af);border:none;color:#000;padding:10px;border-radius:8px;cursor:pointer;font-weight:700;">
                    Вступить
                </button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        setTimeout(() => document.getElementById('join-invite-input')?.focus(), 50);
    };

    window.submitJoinInvite = async function() {
        const input = document.getElementById('join-invite-input');
        if (!input) return;
        let code = input.value.trim();
        // Extract code from full URL if pasted
        const match = code.match(/\/join\/([A-Za-z0-9_-]+)/);
        if (match) code = match[1];
        if (!code) { addLog('Введите инвайт-код', 'error'); return; }

        try {
            const res = await apiRequest(`/chat/join/${code}`, 'POST');
            document.getElementById('join-invite-modal')?.remove();
            addLog(`✅ ${res.status}: ${res.room_name}`, 'success');
            await loadChatRooms();
            if (res.room_id) selectChatRoom(res.room_id, res.room_name, res.room_type, null, 'member');
        } catch (e) {
            addLog(e.message || 'Неверная или устаревшая ссылка', 'error');
        }
    };



    // --- ADD MEMBER LOGIC ---
    let addMemberSelectedIds = new Set();
    window.openAddMemberModal = function() {
        const modal = document.getElementById('add-member-modal');
        if (!modal || !state.chat.currentRoomId) return;
        addMemberSelectedIds.clear();
        document.getElementById('add-member-search').value = '';
        window.filterAddMemberContacts(); // Will render un-filtered
        modal.style.display = 'flex';
        if(window.toggleChatOptions) window.toggleChatOptions(); // close dropdown
    };

    window.filterAddMemberContacts = function() {
        const query = (document.getElementById('add-member-search').value || '').toLowerCase();
        const list = document.getElementById('add-member-list');
        if (!list) return;
        
        list.innerHTML = '';
        const contacts = state.contacts || [];
        const filtered = contacts.filter(c => 
            (c.name && c.name.toLowerCase().includes(query)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.username && c.username.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dim);">Ничего не найдено</div>`;
            return;
        }

        filtered.forEach(c => {
            const div = document.createElement('div');
            div.className = 'sidebar-item contact-item';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '8px';
            div.style.borderBottom = '1px solid var(--border-metal)';
            
            const isSelected = addMemberSelectedIds.has(c.id);
            
            div.innerHTML = `
                <div style="display:flex; alignItems:center; gap:10px;">
                    <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${c.name || 'User'}" style="width:30px; height:30px; border-radius:50%; background:var(--bg-panel);">
                    <div>
                        <div style="font-size:13px; font-weight:500;">${c.name || c.username || 'Unknown'}</div>
                        <div style="font-size:11px; color:var(--text-dim);">${c.phone || ''}</div>
                    </div>
                </div>
                <input type="checkbox" ${isSelected ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;">
            `;
            
            div.onclick = () => {
                const cb = div.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                if(cb.checked) addMemberSelectedIds.add(c.id);
                else addMemberSelectedIds.delete(c.id);
            };
            
            list.appendChild(div);
        });
    };

    window.submitAddMembers = async function() {
        if (!state.chat.currentRoomId || addMemberSelectedIds.size === 0) return;
        
        const userIds = Array.from(addMemberSelectedIds);
        try {
            await apiRequest(`/chat/rooms/${state.chat.currentRoomId}/members`, 'POST', { user_ids: userIds });
            addLog(`Добавлено участников: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
        } catch (e) {
            addLog('Ошибка при добавлении участников', 'error');
        }
    };
    // -------------------------

    // Expose selectChatRoom to global if needed by inline scripts
    window['selectChatRoom'] = selectChatRoom;

    window['setReply'] = function(id, text) {
        state.chat.replyToId = id;
        state.chat.editingId = null;
        const container = document.getElementById('reply-preview-container');
        const previewText = document.getElementById('reply-preview-text');
        if (container && previewText) {
            container.style.display = 'flex';
            previewText.textContent = `Ответ на: ${text.substring(0, 25)}...`;
        }
        document.getElementById('chat-input')?.focus();
    }

    window['setEdit'] = function(id, text) {
        state.chat.editingId = id;
        state.chat.replyToId = null;
        const container = document.getElementById('reply-preview-container');
        const previewText = document.getElementById('reply-preview-text');
        const input = document.getElementById('chat-input');
        if (container && previewText && input) {
            container.style.display = 'flex';
            previewText.textContent = `Редактирование...`;
            // @ts-ignore
            input.value = text;
            input.focus();
        }
    }

    window['cancelReply'] = function() {
        state.chat.replyToId = null;
        state.chat.editingId = null;
        const container = document.getElementById('reply-preview-container');
        const input = document.getElementById('chat-input');
        if (container) container.style.display = 'none';
        if (input) {
            // @ts-ignore
            if (input.value === 'Редактирование...') input.value = '';
        }
    }

    window['deleteMessage'] = async function(id) {
        if (!confirm('Удалить сообщение?')) return;
        try {
            // @ts-ignore
            await apiRequest(`/chat/messages/${id}`, 'DELETE');
        } catch(e) { 
            // @ts-ignore
            addLog('Удаление не удалось', 'error'); 
        }
    }

    // closeChatMobile is defined in messenger_app.js (removes 'chat-open' from .chat-layout)

    // Attach local listeners
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    if (chatInput) {
        let typingTimer;
        chatInput.addEventListener('input', (e) => {
            if (state.chat.currentRoomId) {
                localStorage.setItem(`skuf_draft_${state.chat.currentRoomId}`, e.target.value);
            }
            if (state.chat.socket && state.chat.socket.readyState === 1) {
                state.chat.socket.send(JSON.stringify({
                    type: 'typing_status',
                    status: true,
                    room_id: state.chat.currentRoomId,
                    sender: state.user.username,
                    sender_id: state.user.id
                }));
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    state.chat.socket.send(JSON.stringify({
                        type: 'typing_status',
                        status: false,
                        room_id: state.chat.currentRoomId,
                        sender: state.user.username,
                        sender_id: state.user.id
                    }));
                }, 2000);
            }
        });
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
        });
    }
    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendChatMsg);
    }
    const chatFileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
    if (chatFileInput) {
        chatFileInput.addEventListener('change', () => {
            if (chatFileInput.files && chatFileInput.files.length > 0) {
                uploadChatFiles(chatFileInput.files);
            }
        });
    }

    // [PERF-204] Local Debounced Contact Search
    const searchInput = document.getElementById('contact-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const term = e.target.value.toLowerCase().trim();
                const items = document.querySelectorAll('#chat-rooms-list .sidebar-item');
                items.forEach(item => {
                    const name = item.dataset.name || '';
                    item.style.display = name.includes(term) ? 'flex' : 'none';
                });
            }, 300); // 300ms debounce
        });
    }

    // [AUDIO-202] Voice Recorder Service
    class VoiceRecorderService {
        constructor() {
            this.btn = document.getElementById('voice-record-btn');
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.isRecording = false;
            if(this.btn) {
                this.btn.addEventListener('mousedown', () => this.start());
                this.btn.addEventListener('mouseup', () => this.stop());
                this.btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.start(); }, {passive: false});
                this.btn.addEventListener('touchend', (e) => { e.preventDefault(); this.stop(); });
                this.btn.addEventListener('mouseleave', () => { if(this.isRecording) this.stop(); });
            }
        }
        
        async start() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // FIX: iOS Safari doesn't support audio/webm — pick compatible mimeType
                const mimeType = [
                    'audio/webm;codecs=opus',
                    'audio/webm',
                    'audio/mp4',
                    'audio/ogg;codecs=opus',
                    ''
                ].find(t => t === '' || MediaRecorder.isTypeSupported(t));
                this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
                this.audioChunks = [];
                this.mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) this.audioChunks.push(event.data);
                };
                this.mediaRecorder.onstop = async () => {
                    const type = this.mediaRecorder.mimeType || 'audio/webm';
                    const audioBlob = new Blob(this.audioChunks, { type });
                    this.audioChunks = [];
                    stream.getTracks().forEach(t => t.stop());
                    this.btn.style.color = '';
                    this.btn.classList.remove('recording');
                    if (audioBlob.size > 1000) { // check minimum size
                        this.uploadAudio(audioBlob);
                    }
                };
                this.mediaRecorder.start();
                this.isRecording = true;
                this.btn.classList.add('recording');
                this.btn.style.color = 'var(--accent-color)';
                addLog('Запись голосового сообщения...', 'info');
            } catch(e) {
                addLog('Микрофон недоступен: ' + e.message, 'error');
            }
        }
        
        stop() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }
        
        async uploadAudio(blob) {
            const formData = new FormData();
            formData.append('file', blob, 'voice_msg.webm');
            try {
                const headers = {};
                if (state.user.token) headers['Authorization'] = `Bearer ${state.user.token}`;
                const resp = await fetch(`${API_BASE_URL}/chat/upload_audio`, {
                    method: 'POST',
                    headers,
                    body: formData
                });
                if (!resp.ok) throw new Error('Upload failed');
                const data = await resp.json();
                
                const msgInput = document.getElementById('chat-input');
                const originalVal = msgInput.value;
                state.pendingFile = { url: data.audio_url, name: 'Voice Message' };
                msgInput.value = '🎤 Голосовое сообщение';
                await sendChatMsg();
                msgInput.value = originalVal;
            } catch(e) {
                addLog('Ошибка отправки голосового сообщения', 'error');
            }
        }
    }

    // [UX-201] Emoji Picker Engine
    class EmojiPickerEngine {
        constructor() {
            this.btn = document.querySelector('.emoji-btn');
            this.input = document.getElementById('chat-input');
            if(!this.btn || !this.input) return;
            
            this.picker = document.createElement('div');
            this.picker.className = 'emoji-picker premium-scroll';
            this.picker.style.display = 'none';
            
            const emojis = ['😀','😂','🥰','😎','🤔','😡','👍','👎','❤️','🔥','🎉','👀','💯','🤡','🥺','💀','🤓','🧠','🍺','🍕'];
            emojis.forEach(emo => {
                const span = document.createElement('span');
                span.textContent = emo;
                span.onclick = () => {
                    this.input.value += emo;
                    this.picker.style.display = 'none';
                    this.input.focus();
                };
                this.picker.appendChild(span);
            });
            
            // Append relative to the input row
            const row = document.querySelector('.chat-input-row');
            if(row) row.appendChild(this.picker);
            
            this.btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.picker.style.display = this.picker.style.display === 'none' ? 'flex' : 'none';
            });
            
            document.addEventListener('click', () => {
                if(this.picker) this.picker.style.display = 'none';
            });
            this.picker.addEventListener('click', e => e.stopPropagation());
        }
    }



    // Expose functions to window
    window.connectWebSocket = connectWebSocket;
    window.loadChatRooms = loadChatRooms;
    window.renderChatRooms = renderChatRooms;
    window.renderFoldersTabs = renderFoldersTabs;
    window.selectChatRoom = selectChatRoom;
    window.renderChatMessage = renderChatMessage;
    window.sendChatMsg = sendChatMsg;
    window.uploadChatFile = uploadChatFile;
    window.clearChatFile = clearChatFile;
    window.renderFabContacts = renderFabContacts;
    window.VoiceRecorderService = VoiceRecorderService;
    window.EmojiPickerEngine = EmojiPickerEngine;

};
