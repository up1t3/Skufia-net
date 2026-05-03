// Extracted Chat Logic
window.initChatCore = function() {
    // --- SKUFIA-NET CHAT HUB ---
    // Make it available globally for RTCManager
    window.sendSocketEvent = function(type, payload) {
        if(state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
            state.chat.socket.send(JSON.stringify({ type: type, ...payload }));
        }
    };

    function connectWebSocket() {
        if (state.chat.socket) return;
        
        const token = state.user.token;
        state.chat.socket = new WebSocket(`${WS_URL}/ws/chat/${token}`);

        state.chat.socket.onopen = () => {
            const globalInd = document.getElementById('global-status-indicator');
            if (globalInd) globalInd.classList.add('online');
            addLog('WebSocket Connection Established: Skufia-Net Online', 'success');
            
            // Setup WebSocket Keep-Alive Ping
            if (window.wsPingInterval) clearInterval(window.wsPingInterval);
            window.wsPingInterval = setInterval(() => {
                if (state.chat.socket && state.chat.socket.readyState === WebSocket.OPEN) {
                    state.chat.socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 20000); // 20 seconds
        };

        state.chat.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'rtc_signal') {
                console.log('[WS] rtc_signal received:', data.signal_type, 'from:', data.sender_id, 'RTCManagerInstance:', !!window.RTCManagerInstance);
                if(window.RTCManagerInstance) {
                    window.RTCManagerInstance.handleIncomingSignal(data.signal_type, data.payload, data.sender_id, data.caller_name, data.caller_avatar);
                } else {
                    // RTCManager not yet initialized — retry for up to 5 seconds
                    console.warn('[WS] RTCManagerInstance not ready, queuing rtc_signal...');
                    let retries = 0;
                    const retryInterval = setInterval(() => {
                        if (window.RTCManagerInstance) {
                            clearInterval(retryInterval);
                            console.log('[WS] RTCManagerInstance became available, delivering queued signal');
                            window.RTCManagerInstance.handleIncomingSignal(data.signal_type, data.payload, data.sender_id, data.caller_name, data.caller_avatar);
                        } else if (++retries >= 10) {
                            clearInterval(retryInterval);
                            console.error('[WS] RTCManagerInstance never initialized — rtc_signal LOST');
                        }
                    }, 500);
                }
            } else if (data.type === 'new_message') {
                const msg = data;
                if (msg.message_id && !msg.id) msg.id = msg.message_id;

                // --- E2EE DECRYPTION (graceful) ---
                if (msg.iv && msg.iv.length > 0) {
                    // Try to get or fetch the session key if not cached
                    if (!state.chat.sessionKeys[msg.room_id] && typeof getOrEstablishSessionKey === 'function') {
                        try {
                            await getOrEstablishSessionKey(msg.room_id, msg.sender_id);
                        } catch(e) {
                            console.warn('WS: Could not establish session key:', e);
                        }
                    }
                    if (state.chat.sessionKeys[msg.room_id]) {
                        try {
                            msg.content = await window.CryptoManager.decryptWithKeyHistory(
                                state.chat.sessionKeys[msg.room_id],
                                msg.content,
                                msg.iv,
                                msg.key_version
                            );
                            msg.text = msg.content;
                            msg.is_secure = true;
                        } catch(e) {
                            try {
                                const newKey = await getOrEstablishSessionKey(msg.room_id, msg.sender_id, true);
                                msg.content = await window.CryptoManager.decryptWithKeyHistory(
                                    newKey,
                                    msg.content,
                                    msg.iv,
                                    msg.key_version
                                );
                                msg.text = msg.content;
                                msg.is_secure = true;
                            } catch (e2) {
                                console.error("Decryption failed for incoming msg even after key refresh:", e2);
                                msg.content = '🔒 [Не удалось расшифровать сообщение]';
                                msg.text = msg.content;
                                msg.is_secure = false;
                            }
                        }
                    } else {
                        // No session key at all — show as encrypted
                        msg.content = '🔒 Зашифрованное сообщение';
                        msg.text = msg.content;
                        msg.is_secure = false;
                    }
                } else {
                    msg.is_secure = false;
                }
                // If msg.iv is empty/null, content is plaintext — show as-is
                if (!msg.text) msg.text = msg.content;

                if (msg.sender_id == state.user.id) {
                    loadChatRooms();
                    // [FIX] Robust optimistic confirmation: match by data-optimistic-ts attribute (ID-based, not text-based)
                    // This works reliably with E2EE chats where text content is encrypted
                    if (state.chat.currentRoomId == msg.room_id) {
                        // Strategy 1: Find optimistic message by client_id OR data-optimistic-ts attribute
                        let matchedEl = null;
                        
                        // First check for a direct ID match using msg.client_id
                        if (msg.client_id) {
                            matchedEl = document.getElementById(`msg-${msg.client_id}`);
                        }
                        
                        // Fallback to data-optimistic-ts if client_id match isn't found
                        if (!matchedEl && msg.client_id) {
                            matchedEl = document.querySelector(`#chat-history .msg-row.msg-optimistic[data-optimistic-ts="${msg.client_id}"]:not([id^="msg-circle-uploading-"])`);
                        }
                        
                        if (matchedEl) {
                            // Optimistic message confirmed — update its ID to the real DB ID
                            matchedEl.id = `msg-${msg.id}`;
                            matchedEl.classList.remove('msg-optimistic');
                            matchedEl.removeAttribute('data-optimistic-ts');
                            console.log('[WS] Optimistic confirmed: msg-' + msg.id);
                        } else if (!document.getElementById(`msg-${msg.id}`)) {
                            // No optimistic element found, and real element not in DOM either
                            // This happens on iOS background fetch abort or if optimistic render failed
                            console.warn('[WS] Own message missing from DOM, rendering from WS fallback.');
                            renderChatMessage(msg);
                            
                            // Clear the input field since the message actually reached the server
                            const input = document.getElementById('chat-input');
                            if (input && input.value.trim() === (msg.text || msg.content || '').trim()) {
                                input.value = '';
                                localStorage.removeItem(`skuf_draft_${state.chat.currentRoomId}`);
                            }
                        }
                        // else: msg-{id} already in DOM — dedup, do nothing
                    }
                    return;
                }
                


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
                    const txtEl = el.querySelector('.msg-text');
                    if (txtEl) {
                        let decryptedContent = data.content;
                        if (data.iv && state.chat.sessionKeys[data.room_id]) {
                            try { 
                                decryptedContent = await window.CryptoManager.decryptWithKeyHistory(state.chat.sessionKeys[data.room_id], data.content, data.iv, data.key_version); 
                            } 
                            catch(e) {
                                try {
                                    const newKey = await getOrEstablishSessionKey(data.room_id, data.sender_id, true);
                                    decryptedContent = await window.CryptoManager.decryptWithKeyHistory(newKey, data.content, data.iv, data.key_version);
                                } catch (e2) {
                                    // Leave as is if we still can't decrypt
                                }
                            }
                        }
                        txtEl.innerText = decryptedContent; 
                    }
                    if (!el.querySelector('.is-edited')) {
                        const mheader = el.querySelector('.msg-header');
                        if (mheader) mheader.insertAdjacentHTML('beforeend', '<span class="is-edited">(изменено)</span>');
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
            }
        };

        state.chat.socket.onclose = () => {
            if (window.wsPingInterval) clearInterval(window.wsPingInterval);
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
            
            // Also load folders
            await loadChatFolders();
            
            renderChatRooms();
        } catch (e) { addLog('Failed to load chat channels', 'error'); }
    }

    async function loadChatFolders() {
        try {
            const folders = await apiRequest('/chat/folders');
            state.chat.folders = folders || [];
            renderChatFolders();
        } catch (e) { console.error('Failed to load folders:', e); }
    }

    function renderChatFolders() {
        const tabsContainer = document.getElementById('chat-folders-tabs');
        if (!tabsContainer) return;

        // Keep the 'All chats' tab and the '+' button
        tabsContainer.innerHTML = '<div class="folder-tab ' + (state.chat.currentFolderId === 'all' ? 'active' : '') + '" onclick="window.selectFolder(\'all\', this)">Все чаты</div>';

        if (state.chat.folders) {
            state.chat.folders.forEach(f => {
                const tab = document.createElement('div');
                tab.className = 'folder-tab ' + (state.chat.currentFolderId == f.id ? 'active' : '');
                tab.textContent = f.icon ? `${f.icon} ${f.name}` : f.name;
                tab.onclick = function() { window.selectFolder(f.id, this); };
                tabsContainer.appendChild(tab);
            });
        }

        tabsContainer.insertAdjacentHTML('beforeend', '<button class="add-folder-btn" onclick="window.openFolderModal()" title="Создать папку">+</button>');
    }
    // Temporary state for folder creation
    window._tempFolderRooms = new Set();

    window.selectFolder = function(id, el) {
        state.chat.currentFolderId = id;
        document.querySelectorAll('.folder-tab').forEach(t => t.classList.remove('active'));
        if (el) el.classList.add('active');
        renderChatRooms();
    };

    window.openFolderModal = function() {
        const modal = document.getElementById('folder-modal');
        if (!modal) return;
        
        const nameInput = document.getElementById('folder-name-input');
        if (nameInput) nameInput.value = '';
        
        window._tempFolderRooms.clear();
        window.renderFolderSelectedChats();
        
        modal.style.display = 'flex';
    };

    window.renderFolderSelectedChats = function() {
        const container = document.getElementById('folder-selected-chats-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (window._tempFolderRooms.size === 0) {
            container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-dim); font-size:13px; border: 1px dashed var(--border-metal); border-radius: 8px;">Нет выбранных чатов</div>';
            return;
        }

        window._tempFolderRooms.forEach(roomId => {
            const room = state.chat.rooms.find(r => r.id === roomId);
            if (!room) return;

            const chip = document.createElement('div');
            chip.className = 'folder-selected-chip';
            chip.style.cssText = 'display:flex;align-items:center;padding:6px 12px;background:rgba(0,242,255,0.05);border:1px solid rgba(0,242,255,0.2);border-radius:20px;gap:10px;justify-content:space-between;';
            
            const leftDiv = document.createElement('div');
            leftDiv.style.cssText = 'display:flex;align-items:center;gap:10px;';
            
            // Avatar
            const avatarDiv = document.createElement('div');
            const initial = (room.name || room.room_name || '?').charAt(0).toUpperCase();
            avatarDiv.style.cssText = 'width:24px;height:24px;border-radius:50%;background:var(--accent-cyan);color:#000;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;';
            avatarDiv.textContent = initial;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = room.name || room.room_name || 'Chat';
            nameSpan.style.color = 'var(--text-main)';
            nameSpan.style.fontWeight = '500';
            nameSpan.style.fontSize = '13px';
            nameSpan.style.whiteSpace = 'nowrap';
            nameSpan.style.overflow = 'hidden';
            nameSpan.style.textOverflow = 'ellipsis';
            nameSpan.style.maxWidth = '250px';
            
            leftDiv.appendChild(avatarDiv);
            leftDiv.appendChild(nameSpan);
            
            const removeBtn = document.createElement('div');
            removeBtn.className = 'folder-selected-chip-remove';
            removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--text-dim)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            removeBtn.style.cursor = 'pointer';
            removeBtn.onclick = () => {
                window._tempFolderRooms.delete(roomId);
                window.renderFolderSelectedChats();
            };

            chip.appendChild(leftDiv);
            chip.appendChild(removeBtn);
            container.appendChild(chip);
        });
    };

    window.openFolderAddChatsModal = function() {
        const modal = document.getElementById('folder-add-chats-modal');
        if (!modal) return;
        
        const searchInput = document.getElementById('folder-chats-search');
        if (searchInput) searchInput.value = '';
        
        window.renderFolderAllChatsList();
        modal.style.display = 'flex';
    };

    window.filterFolderChats = function(query) {
        window.renderFolderAllChatsList(query.toLowerCase());
    };

    window.renderFolderAllChatsList = function(query = '') {
        const container = document.getElementById('folder-all-chats-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        let availableRooms = state.chat.rooms || [];
        if (query) {
            availableRooms = availableRooms.filter(r => (r.name || r.room_name || '').toLowerCase().includes(query));
        }

        if (availableRooms.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim); font-size:14px;">Чаты не найдены</div>';
            return;
        }

        availableRooms.forEach(room => {
            const row = document.createElement('div');
            row.className = 'folder-chat-select-row';
            row.style.cssText = 'display:flex;align-items:center;padding:10px 20px;gap:15px;cursor:pointer;transition:background 0.2s;';
            row.onmouseover = () => row.style.background = 'rgba(255,255,255,0.03)';
            row.onmouseout = () => row.style.background = 'transparent';
            
            // Toggle logic when clicking the row
            row.onclick = (e) => {
                if (e.target.tagName === 'INPUT') return; // let checkbox handle itself
                const cb = row.querySelector('.folder-room-checkbox-modal');
                cb.checked = !cb.checked;
            };

            const avatarDiv = document.createElement('div');
            const initial = (room.name || room.room_name || '?').charAt(0).toUpperCase();
            avatarDiv.style.cssText = 'width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg, var(--accent-cyan), #00a2ff);color:#000;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;flex-shrink:0;';
            avatarDiv.textContent = initial;
            
            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;';
            
            const nameSpan = document.createElement('div');
            nameSpan.textContent = room.name || room.room_name || 'Chat';
            nameSpan.style.color = 'var(--text-main)';
            nameSpan.style.fontSize = '15px';
            nameSpan.style.fontWeight = '500';
            nameSpan.style.whiteSpace = 'nowrap';
            nameSpan.style.overflow = 'hidden';
            nameSpan.style.textOverflow = 'ellipsis';
            
            const subSpan = document.createElement('div');
            subSpan.textContent = room.type === 'private' ? 'Личный чат' : 'Группа';
            subSpan.style.color = 'var(--text-dim)';
            subSpan.style.fontSize = '13px';
            
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(subSpan);
            
            const checkWrapper = document.createElement('div');
            checkWrapper.className = 'cyber-checkbox-wrapper';
            checkWrapper.style.margin = '0';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = room.id;
            checkbox.className = 'cyber-checkbox folder-room-checkbox-modal';
            // Check if it's already selected
            if (window._tempFolderRooms.has(room.id)) {
                checkbox.checked = true;
            }
            
            checkWrapper.appendChild(checkbox);
            
            row.appendChild(avatarDiv);
            row.appendChild(infoDiv);
            row.appendChild(checkWrapper);
            container.appendChild(row);
        });
    };

    window.confirmFolderChatsSelection = function() {
        const checkboxes = document.querySelectorAll('.folder-room-checkbox-modal');
        
        checkboxes.forEach(cb => {
            const roomId = parseInt(cb.value);
            if (cb.checked) {
                window._tempFolderRooms.add(roomId);
            } else {
                window._tempFolderRooms.delete(roomId);
            }
        });
        
        window.renderFolderSelectedChats();
        document.getElementById('folder-add-chats-modal').style.display = 'none';
    };

    window.submitFolderCreate = async function() {
        const nameInput = document.getElementById('folder-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            if (window.addLog) window.addLog('Введите название папки', 'error');
            return;
        }
        
        const roomIds = Array.from(window._tempFolderRooms);
        
        const btn = document.querySelector('#folder-modal .primary-btn');
        if (btn) btn.textContent = 'СОХРАНЕНИЕ...';
        
        try {
            const resp = await apiRequest('/chat/folders', 'POST', { name: name, icon: '📁', rooms: roomIds });
            if (window.addLog) window.addLog('Папка создана', 'success');
            document.getElementById('folder-modal').style.display = 'none';
            await loadChatFolders();
            if (window.selectFolder && resp.id) window.selectFolder(resp.id);
        } catch (e) {
            if (window.addLog) window.addLog('Ошибка при создании папки: ' + (e.message || ''), 'error');
        } finally {
            if (btn) btn.textContent = 'СОХРАНИТЬ ПАПКУ';
        }
    };



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
                window.applyAvatarDisplay(avatarDiv, room.avatar_url);
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
            div.appendChild(deleteBtn);
            div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role, room.avatar_url);
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

    async function selectChatRoom(roomId, roomName, type, receiverId, myRole, avatarUrl) {
        const chatInput = document.getElementById('chat-input');
        if (chatInput && state.chat.currentRoomId && state.chat.currentRoomId !== roomId) {
            const currentVal = chatInput.value;
            if (currentVal.trim()) {
                localStorage.setItem(`skuf_draft_${state.chat.currentRoomId}`, currentVal);
            } else {
                localStorage.removeItem(`skuf_draft_${state.chat.currentRoomId}`);
            }
        }
        
        state.chat.currentRoomId = roomId;
        state.chat.currentRoomType = type;
        state.chat.receiverId = receiverId;
        state.chat.currentMyRole = myRole;

        if (chatInput) {
            const draft = localStorage.getItem(`skuf_draft_${roomId}`);
            chatInput.value = draft || '';
        }


        const chatHistoryEl = document.getElementById('chat-history');
        const header = document.getElementById('chat-header');

        if (header) {
            const headerAvatar = document.getElementById('header-avatar');
            const headerTitle = document.getElementById('chat-header-title');
            
            if (headerAvatar) {
                headerAvatar.innerHTML = '';
                if (avatarUrl) {
                    window.applyAvatarDisplay(headerAvatar, avatarUrl);
                } else {
                    window.applyAvatarDisplay(headerAvatar, `https://api.dicebear.com/7.x/identicon/svg?seed=${roomName}`);
                }
                headerAvatar.style.backgroundColor = 'transparent';
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

            const e2eIndicator = document.getElementById('e2ee-indicator');
            if (e2eIndicator) {
                e2eIndicator.style.display = 'none';
            }
        }

        // --- E2EE: INITIALIZATION ---
        const e2eIndicator = document.getElementById('e2ee-indicator');
        const badge = document.getElementById('chat-encryption-status');
        
        if (type === 'private') {
            const prefs = JSON.parse(localStorage.getItem('skuf_e2ee_prefs') || '{}');
            const isE2EEnabled = !!prefs[roomId];
            
            if (e2eIndicator) {
                e2eIndicator.style.display = 'inline-flex';
                
                // Clear old inline styles if they exist
                e2eIndicator.style.background = '';
                e2eIndicator.style.color = '';
                e2eIndicator.style.borderColor = '';
                
                if (!e2eIndicator.classList.contains('e2ee-compatibility-indicator')) {
                    e2eIndicator.classList.add('e2ee-compatibility-indicator');
                }
                
                if (isE2EEnabled) {
                    e2eIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                    e2eIndicator.classList.add('enabled');
                    e2eIndicator.classList.remove('disabled', 'warning');
                    if (badge) badge.textContent = '🔒 E2E';
                } else {
                    e2eIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
                    e2eIndicator.classList.add('disabled');
                    e2eIndicator.classList.remove('enabled', 'warning');
                    if (badge) badge.textContent = '🔓 Нет E2E';
                }
            }
            
            // Still exchange keys if E2EE is enabled
            if (isE2EEnabled && typeof getOrEstablishSessionKey === 'function') {
                try {
                    await getOrEstablishSessionKey(roomId, receiverId);
                } catch(e) {
                    console.error('E2EE Error:', e);
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

                // Phase 1: Batch-decrypt all messages BEFORE rendering
                // This prevents the visual "scrolling staircase" effect
                await Promise.all(messages.map(async (m) => {
                    if (m.iv && m.iv.length > 0) {
                        if (state.chat.sessionKeys[roomId]) {
                            try {
                                m.text = await window.CryptoManager.decryptWithKeyHistory(
                                    state.chat.sessionKeys[roomId],
                                    m.text,
                                    m.iv,
                                    m.key_version
                                );
                                m.is_secure = true;
                            } catch(e) {
                                try {
                                    const newKey = await getOrEstablishSessionKey(roomId, m.sender_id, true);
                                    m.text = await window.CryptoManager.decryptWithKeyHistory(
                                        newKey,
                                        m.text,
                                        m.iv,
                                        m.key_version
                                    );
                                    m.is_secure = true;
                                } catch(e2) {
                                    m.text = '🔒 [Не удалось расшифровать сообщение]';
                                    m.is_secure = false;
                                }
                            }
                        } else {
                            m.text = '🔒 Зашифрованное сообщение';
                            m.is_secure = false;
                        }
                    } else {
                        m.is_secure = false;
                    }
                }));

                // Phase 2: Render all messages synchronously in one pass
                for (const m of messages) {
                    renderChatMessage(m);
                }
                chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;

                // Attach scroll listener for infinite loading
                chatHistoryEl.onscroll = async () => {
                    if (chatHistoryEl.scrollTop === 0 && state.chat.hasMore && state.chat.nextCursor) {
                        // Show loading indicator
                        const loader = document.createElement('div');
                        loader.id = 'history-loader';
                        loader.style.textAlign = 'center';
                        loader.style.padding = '10px';
                        loader.style.color = 'var(--text-dim)';
                        loader.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_P7sC{transform-origin:center;animation:spinner_svv2 .75s infinite linear}@keyframes spinner_svv2{100%{transform:rotate(360deg)}}</style><path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" class="spinner_P7sC" fill="currentColor"/></svg>';
                        chatHistoryEl.insertBefore(loader, chatHistoryEl.firstChild);

                        const previousScrollHeight = chatHistoryEl.scrollHeight;

                        try {
                            const res = await apiRequest(`/chat/rooms/${roomId}/history?limit=30&before_id=${state.chat.nextCursor}`);
                            const moreMessages = res.messages || res;
                            state.chat.hasMore = res.has_more || false;
                            state.chat.nextCursor = res.next_cursor || null;

                            if (loader.parentNode) loader.remove();

                            // Reverse to prepend in correct order (since API returns chronologically)
                            // Wait, API returns chronologically, meaning oldest is first.
                            // We need to prepend from last to first so that the oldest is at the top.
                            for (let i = moreMessages.length - 1; i >= 0; i--) {
                                const m = moreMessages[i];
                                if (m.iv && m.iv.length > 0) {
                                    if (state.chat.sessionKeys[roomId]) {
                                        try {
                                            m.text = await window.CryptoManager.decryptWithKeyHistory(state.chat.sessionKeys[roomId], m.text, m.iv, m.key_version);
                                            m.is_secure = true;
                                        } catch(e) {
                                            try {
                                                const newKey = await getOrEstablishSessionKey(roomId, m.sender_id, true);
                                                m.text = await window.CryptoManager.decryptWithKeyHistory(newKey, m.text, m.iv, m.key_version);
                                                m.is_secure = true;
                                            } catch(e2) {
                                                m.text = '🔒 [Не удалось расшифровать сообщение]';
                                                m.is_secure = false;
                                            }
                                        }
                                    } else {
                                        m.text = '🔒 Зашифрованное сообщение';
                                        m.is_secure = false;
                                    }
                                } else {
                                    m.is_secure = false;
                                }
                                renderChatMessage(m, true);
                            }

                            // Restore scroll position so it doesn't jump
                            chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight - previousScrollHeight;
                        } catch (e) {
                            console.error('[InfiniteScroll] Error loading history:', e);
                            if (loader.parentNode) loader.remove();
                        }
                    }
                };

            } catch (e) { chatHistoryEl.innerHTML = '<div class="chat-placeholder">ERROR: HISTORY UNAVAILABLE</div>'; }

        }
    }

    /** @param {any} msg 
     *  @param {boolean} prepend */
    function renderChatMessage(msg, prepend = false, skipScroll = false) {
        const history = document.getElementById('chat-history');
        if (!history) {
            console.error('[renderChatMessage] #chat-history NOT FOUND in DOM!');
            return;
        }

        // [DEDUP] Prevent rendering a message that is already in the DOM
        if (msg.id && document.getElementById(`msg-${msg.id}`)) {
            console.warn('[renderChatMessage] DEDUP: msg-' + msg.id + ' already in DOM, skipping.');
            return;
        }

        // [DEDUP] Check if we have an optimistic element for this exact client_id
        if (msg.client_id && document.getElementById(`msg-${msg.client_id}`)) {
            const tempMsgEl = document.getElementById(`msg-${msg.client_id}`);
            if (tempMsgEl) {
                // The WS arrived before API response! Rename the optimistic element to the real ID.
                tempMsgEl.id = `msg-${msg.id}`;
                tempMsgEl.classList.remove('msg-optimistic');
                console.warn('[renderChatMessage] DEDUP: Renamed optimistic msg-' + msg.client_id + ' to msg-' + msg.id + ' via WS');
                return; // Element is already in the DOM and updated, no need to render again
            }
        }

        const placeholder = history.querySelector('.chat-placeholder');
        if (placeholder) placeholder.remove();

        const currentUserId = state.user ? state.user.id : null;
        const currentUsername = state.user ? state.user.username : null;
        const isMe = (msg.sender_id && msg.sender_id === currentUserId) || (msg.sender && msg.sender === currentUsername);

        if (msg.message_type === 'missed_call') {
            const rowDiv = document.createElement('div');
            rowDiv.className = `msg-row`;
            rowDiv.id = `msg-${msg.id}`;
            rowDiv.style.justifyContent = 'center';

            const bubble = document.createElement('div');
            bubble.className = `msg-bubble`;
            bubble.style.cssText = 'background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.2); color:var(--text-main); font-size:13px; font-weight:500; display:flex; align-items:center; gap:8px; padding:6px 12px; border-radius:12px; margin: 5px auto;';

            // Phone down / missed call icon
            const svgIcon = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#ef4444" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 13.5l-2.6-2.6a1.5 1.5 0 0 1 0-2.1l2.8-2.8a1.5 1.5 0 0 1 2.1 0l2.3 2.3c.4.4 1 .5 1.5.3A12.9 12.9 0 0 0 20 5.4a1.5 1.5 0 0 1 .3-1.5l-2.3-2.3a1.5 1.5 0 0 1 0-2.1L20.8 -3.3a1.5 1.5 0 0 1 2.1 0l2.6 2.6c1 1 1 2.6.2 3.8A17.9 17.9 0 0 1 14.4 14.2c-1.2.8-2.8.8-3.8-.2z"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>`;
            
            const textSpan = document.createElement('span');
            textSpan.textContent = isMe ? 'Исходящий вызов (нет ответа)' : 'Пропущенный вызов';
            
            bubble.innerHTML = svgIcon;
            bubble.appendChild(textSpan);
            rowDiv.appendChild(bubble);
            if (prepend) {
                history.insertBefore(rowDiv, history.firstChild);
            } else {
                history.appendChild(rowDiv);
            if (!skipScroll) history.scrollTop = history.scrollHeight;
            }
            return;
        }

        const dateObj = new Date(msg.timestamp);
        let timeStr = msg.timestamp || '00:00';
        if (!isNaN(dateObj.getTime())) {
            timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        const fileUrlRaw = msg.file_url || null;
        let fileHtml = '';
        if (fileUrlRaw) {
            const urls = fileUrlRaw.split(',');
            const BASE_URL = window.API_BASE_URL ? window.API_BASE_URL.replace('/api', '') : '';
            
            if (urls.length > 1) {
                // Gallery Mode
                let gridHtml = '';
                urls.forEach(url => {
                    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
                    const isVideo = /\.(mp4|webm)$/i.test(url);
                    if (isImage) {
                        gridHtml += `<a href="javascript:void(0)" onclick="window.openChatLightbox('${BASE_URL}${url}', [${urls.map(u => `'${BASE_URL}${u}'`).join(', ')}], ${urls.indexOf(url)})" class="gallery-item-image" style="display:block;width:100%;height:100%;"><img src="${BASE_URL}${url}" alt="attachment" style="width:100%; height:100%; object-fit:cover;"></a>`;
                    } else if (isVideo) {
                        gridHtml += `<div class="gallery-video-wrapper" style="width:100%;height:100%;">
                            <video src="${BASE_URL}${url}" controls style="width:100%; height:100%; object-fit:cover;"></video>
                        </div>`;
                    } else {
                         const fname = url.split('/').pop() || 'file';
                         gridHtml += `<a class="gallery-file-link" href="${BASE_URL}${url}" target="_blank" download style="display:flex; align-items:center; justify-content:center; flex-direction:column; padding:10px; background:rgba(255,255,255,0.05); text-decoration:none; color:inherit;"><span class="file-icon">📁</span><span style="font-size:10px; word-break:break-all;">${fname}</span></a>`;
                    }
                });
                
                fileHtml = `<div class="msg-media-gallery" data-count="${urls.length}">
                    ${gridHtml}
                </div>`;
            } else {
                // Single File Mode
                const fileUrl = urls[0];
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fileUrl);
                const isAudio = /\.(mp3|ogg|wav|webm|flac|m4a|aac|opus)(\?.*)?$/i.test(fileUrl);
                const isVideo = /\.(mp4)$/i.test(fileUrl) || msg.file_type === 'video_circle' || (msg.file_url && msg.file_url.includes('/video/'));
                
                if (isImage) {
                    fileHtml = `<a href="javascript:void(0)" onclick="window.openChatLightbox('${BASE_URL}${fileUrl}', ['${BASE_URL}${fileUrl}'], 0)"><img class="msg-file-img-preview" src="${BASE_URL}${fileUrl}" alt="attachment"></a>`;
                } else if (isVideo && (msg.file_type === 'video_circle' || fileUrl.includes('/video/'))) {
                    // Circle video ("кружочки")
                    fileHtml = `<div class="msg-video-circle" style="position: relative; width: 240px; height: 240px; border-radius: 50%; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 2px solid var(--accent-cyan); cursor: pointer;" onclick="const v = this.querySelector('video'); if(v.paused){v.play();}else{v.pause();}">
                        <video loop playsinline style="width: 100%; height: 100%; object-fit: cover;">
                            <source src="${BASE_URL}${fileUrl}" type="video/webm">
                            <source src="${BASE_URL}${fileUrl}" type="video/mp4">
                        </video>
                        <div style="position: absolute; bottom: 15px; right: 15px; background: rgba(0,0,0,0.5); border-radius: 50%; padding: 4px; display: flex;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>
                    </div>`;
                } else if (isAudio) {
                    const audioId = `audio-${msg.id || Date.now()}`;
                    fileHtml = `<div class="msg-audio-player">
                        <audio id="${audioId}" controls preload="metadata" style="width:100%;max-width:280px;border-radius:8px;outline:none;accent-color:var(--accent-cyan);">
                            <source src="${BASE_URL}${fileUrl}" type="audio/${fileUrl.split('.').pop()}">
                            <source src="${BASE_URL}${fileUrl}" type="audio/webm">
                        </audio>
                    </div>`;
                    // IndexedDB cache: store audio blob locally for offline playback
                    setTimeout(() => window._cacheAudioLocally && window._cacheAudioLocally(fileUrl, BASE_URL + fileUrl), 100);
                } else {
                    const fname = fileUrl.split('/').pop() || 'file';
                    fileHtml = `<a class="msg-file-attachment" href="${BASE_URL}${fileUrl}" target="_blank" download><span class="file-icon">📁</span> СКАЧАТЬ: ${fname}</a>`;
                }
            }
        }

        // ── Build Telegram-style msg-row ─────────────────────────────────────
        const rowDiv = document.createElement('div');
        rowDiv.className = `msg-row ${isMe ? 'msg-row-sent' : 'msg-row-received'}`;
        rowDiv.id = `msg-${msg.id}`;

        // Avatar (only for received messages)
        if (!isMe) {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'msg-avatar';
            const senderProfile = (state.chat.rooms || []).find(r => r.other_user_id === msg.sender_id);
            const avatarUrl = msg.avatar_url || msg.sender_avatar || (senderProfile && senderProfile.avatar_url) || null;
            if (avatarUrl) {
                window.applyAvatarDisplay(avatarDiv, avatarUrl);
            } else {
                const initial = (msg.sender || '?').charAt(0).toUpperCase();
                const hue = (initial.charCodeAt(0) * 137) % 360;
                avatarDiv.style.background = `linear-gradient(135deg,hsl(${hue},70%,50%),hsl(${hue},80%,30%))`;
                avatarDiv.style.color = '#fff';
                avatarDiv.style.display = 'flex';
                avatarDiv.style.alignItems = 'center';
                avatarDiv.style.justifyContent = 'center';
                avatarDiv.style.fontSize = '14px';
                avatarDiv.style.fontWeight = 'bold';
                avatarDiv.textContent = initial;
            }
            rowDiv.appendChild(avatarDiv);
        }

        // Check for missed call system message
        let rawText = msg.text || msg.content || '';
        const isMissedCall = rawText.includes('Пропущенный') && (rawText.includes('аудиозвонок') || rawText.includes('видеозвонок'));
        const isVideoCircle = msg.file_type === 'video_circle' || (fileUrlRaw && fileUrlRaw.includes('/video/'));

        // Bubble
        const bubble = document.createElement('div');
        if (isMissedCall) {
            bubble.className = 'msg-bubble system-msg missed-call-msg';
            // Hide avatar for system messages
            if (rowDiv.querySelector('.msg-avatar')) {
                rowDiv.querySelector('.msg-avatar').style.display = 'none';
            }
        } else if (isVideoCircle) {
            // Чистый кружочек — без прямоугольной обёртки bubble
            bubble.className = `msg-bubble msg-bubble-circle ${isMe ? 'msg-sent' : 'msg-received'}`;
        } else {
            bubble.className = `msg-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
        }

        // Sender name (for received only)
        if (!isMe && !isMissedCall) {
            const senderNameDiv = document.createElement('div');
            senderNameDiv.className = 'msg-sender-name';
            senderNameDiv.textContent = msg.sender || '';
            bubble.appendChild(senderNameDiv);
        }

        // Reply badge
        if (msg.reply_to_id) {
            const replyBadge = document.createElement('div');
            replyBadge.className = 'reply-badge';
            replyBadge.textContent = 'Ответ на сообщение';
            replyBadge.onclick = () => document.getElementById(`msg-${msg.reply_to_id}`)?.scrollIntoView({behavior:'smooth'});
            bubble.appendChild(replyBadge);
        }

        // Text (skip for pure circle videos — no text bubble needed)
        const isCircleOnly = isVideoCircle && (!rawText.trim() || rawText.trim() === '📹');
        if (!isCircleOnly) {
            const textDiv = document.createElement('div');
            textDiv.className = 'msg-text';
            
            if (isMissedCall) {
                const icon = rawText.includes('📹') ? '📹' : '📞';
                const callType = rawText.includes('видеозвонок') ? 'видеозвонок' : 'аудиозвонок';
                const name = isMe ? 'вас' : (msg.sender || 'пользователя');
                textDiv.innerHTML = `
                    <span class="missed-call-icon">${icon}</span>
                    <span class="missed-call-text">Пропущенный ${callType} от <b>${name}</b></span>
                `;
            } else if (rawText === '🔒 [Не удалось расшифровать сообщение]') {
                textDiv.innerHTML = `
                    <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; margin-top: 2px;">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-dim)" stroke-width="2" fill="none" style="opacity: 0.7"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        <span style="font-style: italic; color: var(--text-dim); font-size: 12px; opacity: 0.7;">Сообщение зашифровано и недоступно.</span>
                    </div>
                `;
            } else if (rawText === '🔒 Зашифрованное сообщение') {
                textDiv.innerHTML = `
                    <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; margin-top: 2px; cursor: pointer;" onclick="document.getElementById('settings-modal').style.display='flex';">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-dim)" stroke-width="2" fill="none" style="opacity: 0.7"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        <span style="font-style: italic; color: var(--text-dim); font-size: 12px; opacity: 0.7;">Ожидание ключей шифрования...</span>
                    </div>
                `;
            } else {
                // Safe escaping then linkify
                const tempDiv = document.createElement('div');
                tempDiv.textContent = rawText;
                let safeText = tempDiv.innerHTML;
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                safeText = safeText.replace(urlRegex, function(url) {
                    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan); text-decoration:underline;">${url}</a>`;
                });
                textDiv.innerHTML = safeText;
            }
            bubble.appendChild(textDiv);
        }

        // File attachment
        if (fileHtml) {
            const fileContainer = document.createElement('div');
            fileContainer.innerHTML = fileHtml;
            while (fileContainer.firstChild) bubble.appendChild(fileContainer.firstChild);
        }

        // Footer: time + lock icon (only when ACTUALLY decrypted) + read ticks
        const footerDiv = document.createElement('div');
        footerDiv.className = 'msg-footer';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        // Only show 🔒 if the message was successfully decrypted (is_secure: true)
        // NOT when it failed decryption (text === placeholder string)
        const lockHtml = msg.is_secure ? ' <span style="font-size:10px;opacity:0.7;" title="End-to-End Encrypted (E2EE)">🔒</span>' : ' <span style="font-size:10px;opacity:0.7;color:var(--error-red);" title="Message is unencrypted (Plaintext)">🔓</span>';
        if (msg.is_edited) {
            timeSpan.innerHTML = `${timeStr}${lockHtml} <span class="is-edited">(изм.)</span> `;
        } else {
            timeSpan.innerHTML = `${timeStr}${lockHtml} `;
        }
        if (isMe) {
            const isRead = msg.is_read;
            const checkSvg = isRead 
                ? '<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--accent-cyan);filter:drop-shadow(0 0 2px rgba(0,255,255,0.5));margin-left:2px;vertical-align:middle;"><path d="M7 11.5L10 14.5L17 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M11 11.5L14 14.5L21 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'
                : '<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--text-dim);margin-left:2px;vertical-align:middle;"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
            timeSpan.insertAdjacentHTML('beforeend', checkSvg);
        } else if (!msg.is_read && state.chat.socket && state.chat.socket.readyState === 1) {
            state.chat.socket.send(JSON.stringify({
                type: 'read_ack',
                room_id: state.chat.currentRoomId,
                message_id: msg.id
            }));
        }
        footerDiv.appendChild(timeSpan);
        bubble.appendChild(footerDiv);

        // Context menu logic — single tap opens menu (no text selection)
        // Long-press = native copy (handled by browser)
        bubble.addEventListener('click', (e) => {
            // Don't trigger on links, videos, audio controls
            if (e.target.closest('a, video, audio, button, .msg-video-circle')) return;
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
            const menu = document.createElement('div');
            menu.className = 'msg-context-menu';
            
            // Position menu near the tap point
            const chatHistory = document.getElementById('chat-history');
            const histRect = chatHistory ? chatHistory.getBoundingClientRect() : { top: 0, left: 0 };
            let menuTop = e.clientY - histRect.top + (chatHistory ? chatHistory.scrollTop : 0);
            let menuLeft = e.clientX;
            
            // Keep menu within viewport
            menu.style.position = 'fixed';
            menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
            menu.style.left = `${Math.min(Math.max(menuLeft - 70, 10), window.innerWidth - 160)}px`;

            const cleanText = (msg.text || msg.content || '').replace(/[`]/g, '');
            
            // Переслать
            const forwardDiv = document.createElement('div');
            forwardDiv.innerHTML = '<span style="margin-right:8px">↗️</span>Переслать';
            forwardDiv.onclick = (ev) => { ev.stopPropagation(); window.showForwardModal(cleanText); menu.remove(); };
            menu.appendChild(forwardDiv);

            // Ответить
            const replyDiv = document.createElement('div');
            replyDiv.innerHTML = '<span style="margin-right:8px">↩️</span>Ответить';
            replyDiv.onclick = (ev) => { ev.stopPropagation(); setReply(msg.id, cleanText); menu.remove(); };
            menu.appendChild(replyDiv);

            if (isMe) {
                // Редактировать
                const editDiv = document.createElement('div');
                editDiv.innerHTML = '<span style="margin-right:8px">✏️</span>Редактировать';
                editDiv.onclick = (ev) => { ev.stopPropagation(); setEdit(msg.id, cleanText); menu.remove(); };
                menu.appendChild(editDiv);
                // Удалить
                const deleteDiv = document.createElement('div');
                deleteDiv.className = 'delete-ctx';
                deleteDiv.innerHTML = '<span style="margin-right:8px">🗑️</span>Удалить';
                deleteDiv.onclick = (ev) => { ev.stopPropagation(); deleteMessage(msg.id); menu.remove(); };
                menu.appendChild(deleteDiv);
            }
            document.body.appendChild(menu);
            // Animate in
            requestAnimationFrame(() => menu.classList.add('visible'));
            // Close on outside tap
            setTimeout(() => {
                document.addEventListener('click', () => menu.remove(), { once: true });
            }, 10);
        });
        // Prevent context menu (long-press) from showing our custom menu — let native copy work
        bubble.addEventListener('contextmenu', (e) => e.preventDefault());

        rowDiv.appendChild(bubble);

        // [UX] Fade-in animation for new messages so user sees them appear
        if (!prepend && !skipScroll) {
            rowDiv.style.opacity = '0';
            rowDiv.style.transform = 'translateY(10px)';
            rowDiv.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        }

        if (prepend) {
            history.insertBefore(rowDiv, history.firstChild);
        } else {
            history.appendChild(rowDiv);
            if (!skipScroll) {
                history.scrollTop = history.scrollHeight;
                // Trigger fade-in after DOM insertion
                requestAnimationFrame(() => {
                    rowDiv.style.opacity = '1';
                    rowDiv.style.transform = 'translateY(0)';
                });
            }
        }
    }

    let _lastSendTime = 0;
    window.sendChatMsg = async function(directCaption = null) {
        if (Date.now() - _lastSendTime < 500) {
            console.warn('[sendChatMsg] SKIP: debounce guard (500ms)');
            return;
        }
        
        console.log('[sendChatMsg] >>> ENTER, directCaption type:', typeof directCaption, 'val:', typeof directCaption === 'string' ? directCaption.substring(0,20) : String(directCaption).substring(0,20));
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('chat-input'));
        
        let content = (typeof directCaption === 'string') ? directCaption : (input ? input.value.trim() : '');
        const hasContent = !!content.trim();
        const hasFile = !!state.pendingFile;
        
        if (state.chat.currentRoomId == null || (!hasContent && !hasFile)) {
            console.warn('[sendChatMsg] SKIP: no content. roomId=', state.chat.currentRoomId, 'content="'+content+'"', 'hasFile=', hasFile);
            return;
        }

        // Prevent double sending
        if (input && input.dataset.sending === 'true' && typeof directCaption !== 'string') {
            console.warn('[sendChatMsg] SKIP: double-send guard. sending=', input.dataset.sending);
            return;
        }
        if (typeof directCaption === 'object' && directCaption instanceof Event) {
             directCaption = null; // ignore event objects passed via inline onclick
        }
        
        _lastSendTime = Date.now();
        if (input) {
            input.dataset.sending = 'true';
            // Safety: force-reset sending after 15s in case of stuck state
            setTimeout(() => { if (input && input.dataset.sending === 'true') { input.dataset.sending = 'false'; console.warn('[sendChatMsg] Safety reset of sending flag after 15s'); } }, 15000);
        }
        console.log('[sendChatMsg] Proceeding: roomId=', state.chat.currentRoomId, 'content=', content.substring(0,30));

        const roomId = state.chat.currentRoomId;
        const receiverId = state.chat.receiverId;

        // Declare outside try so catch can restore them on failure
        let savedContent = content;
        let savedFile = state.pendingFile ? { ...state.pendingFile } : null;
        let savedReplyId = state.chat.replyToId;
        let optimisticId = Date.now();

        let payload = {
            content: content || (state.pendingFile ? '📹' : ''),
            encryption_iv: '',
            file_url: state.pendingFile ? state.pendingFile.url : null,
            reply_to_id: state.chat.replyToId,
            client_id: null
        };

        let sendSucceeded = false;
        try {
            // --- E2EE: ENCRYPTION ---
            let isEncrypted = false;
            const prefs = JSON.parse(localStorage.getItem('skuf_e2ee_prefs') || '{}');
            const isE2EEnabled = !!prefs[roomId];
            
            if (isE2EEnabled && state.chat.currentRoomType === 'private' && typeof getOrEstablishSessionKey === 'function') {
                const sessionKeyMap = await getOrEstablishSessionKey(roomId, receiverId);
                if (sessionKeyMap) {
                    let activeKey;
                    if (sessionKeyMap.keys && sessionKeyMap.active_version) {
                        activeKey = sessionKeyMap.keys[sessionKeyMap.active_version];
                    } else {
                        activeKey = sessionKeyMap; // fallback for legacy structure
                    }
                    if (activeKey) {
                        try {
                            const encrypted = await window.CryptoManager.encryptMessage(activeKey, content);
                            payload.content = encrypted.content;
                            payload.encryption_iv = encrypted.iv;
                            isEncrypted = true;
                        } catch (encryptErr) {
                            console.error("Encryption failed, cached key might be corrupt:", encryptErr);
                            delete state.chat.sessionKeys[roomId];
                            if (typeof window.vaultDelete === 'function') {
                                await window.vaultDelete('session_keys', `room_${roomId}`).catch(() => {});
                            }
                            throw new Error("Локальный ключ шифрования был поврежден и очищен. Пожалуйста, нажмите 'Отправить' еще раз для создания нового ключа.");
                        }
                    }
                }
            }

            // At this point encryption succeeded or we fell back intentionally.
            savedContent = content;
            savedFile = state.pendingFile ? { ...state.pendingFile } : null;
            savedReplyId = state.chat.replyToId;
            // [FIX] Save editingId to use in API call
            const currentEditingId = state.chat.editingId;
            // --- OPTIMISTIC RENDER ---
            // Clear input immediately (optimistic) before API call
            if (input) input.value = '';
            localStorage.removeItem(`skuf_draft_${roomId}`);
            clearChatFile();

            optimisticId = Date.now();
            payload.client_id = optimisticId; // Add client_id for WS deduplication
            if (!currentEditingId) {
                const optimisticMsg = {
                    id: optimisticId,
                    sender: state.user?.username || state.user?.display_name || 'Я',
                    sender_id: state.user?.id,
                    text: payload.content,
                    content: payload.content,
                    iv: isEncrypted ? payload.encryption_iv : null,
                    is_secure: isEncrypted,
                    file_url: savedFile ? savedFile.url : null,
                    file_type: savedFile ? savedFile.file_type : null,
                    reply_to_id: savedReplyId,
                    is_edited: false,
                    is_read: false,
                    timestamp: new Date().toISOString()
                };
                console.log('[sendChatMsg] Optimistic render, id:', optimisticId, 'text:', savedContent.substring(0, 30));
                renderChatMessage(optimisticMsg);
                // Verify element was added and tag it
                const rendered = document.getElementById(`msg-${optimisticId}`);
                if (rendered) rendered.classList.add('msg-optimistic');
                console.log('[sendChatMsg] Optimistic element in DOM:', !!rendered);
            }

            // --- API REQUEST ---
            console.log('[sendChatMsg] Calling API, roomId:', roomId, 'editing:', currentEditingId, 'encrypted:', !!payload.encryption_iv);
            let response;
            if (currentEditingId) {
                response = await apiRequest(`/chat/messages/${currentEditingId}`, 'PUT', payload);
                // Update existing message in DOM immediately
                const existingMsgEl = document.getElementById(`msg-${currentEditingId}`);
                if (existingMsgEl) {
                    const txtEl = existingMsgEl.querySelector('.msg-text');
                    if (txtEl) txtEl.innerText = savedContent;
                    if (!existingMsgEl.querySelector('.is-edited')) {
                        const mheader = existingMsgEl.querySelector('.msg-header');
                        if (mheader) mheader.insertAdjacentHTML('beforeend', '<span class="is-edited">(изм.)</span>');
                    }
                }
            } else {
                response = await apiRequest(`/chat/rooms/${roomId}/send`, 'POST', payload);
                console.log('[sendChatMsg] API response:', response ? 'ok, id='+response.id : 'null/empty');
                // Update the optimistic element ID to the real DB ID
                const tempMsgEl = document.getElementById(`msg-${optimisticId}`);
                if (tempMsgEl && response && response.id) {
                    tempMsgEl.id = `msg-${response.id}`;
                    tempMsgEl.classList.remove('msg-optimistic');
                }
            }
            
            sendSucceeded = true;
            console.log('[sendChatMsg] ✅ SUCCESS');
            const editBanner = document.getElementById('edit-banner');
            if (editBanner) editBanner.style.display = 'none';
            try { playSound('click'); } catch(e) {}
        } catch (e) {
            console.error('[sendChatMsg] ❌ ERROR:', e.message, e);
            if (window.addLog) addLog(`⚠️ Ошибка отправки: ${e.message}`, 'error');
            
            let wasConfirmed = false;
            // Remove the optimistic message if it failed
            if (!state.chat.editingId) {
                const tempMsgEl = document.getElementById(`msg-${optimisticId}`);
                if (!tempMsgEl) {
                    // Message element is gone, which means WS handler renamed its ID to the real DB ID!
                    wasConfirmed = true;
                } else {
                    tempMsgEl.remove();
                }
            }
            
            if (!wasConfirmed) {
                // Restore input value on error so user can retry
                if (input) input.value = savedContent;
                if (savedFile) {
                    state.pendingFile = savedFile;
                }
            } else {
                // The WS handler confirmed the message, so it actually succeeded despite the fetch error
                sendSucceeded = true;
            }
        } finally {
            if (input) {
                input.dataset.sending = 'false';
                // On success input was already cleared optimistically above.
                // On failure catch block restored savedContent (if not confirmed).
                if (sendSucceeded) {
                    input.value = '';
                    localStorage.removeItem(`skuf_draft_${state.chat.currentRoomId}`);
                    if (window.cancelReply) window.cancelReply();
                }
                input.focus();
            }
        }
    }


    /** Intercept file selection and open preview modal */
    function uploadChatFiles(/** @type {FileList | File[]} */ fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        const totalSize = files.reduce((acc, f) => acc + f.size, 0);
        if (totalSize > 50 * 1024 * 1024) {
            if (window.showToast) window.showToast('Суммарный размер файлов превышает лимит 50 МБ');
            addLog('Суммарный размер файлов превышает лимит 50 МБ', 'error');
            clearChatFile();
            return;
        }

        // Save files to state for modal
        state.modalFiles = files;
        
        const previewContainer = document.getElementById('media-preview-container');
        if (previewContainer) {
            // Preserve the cancel button, clear only media content
            const cancelBtn = previewContainer.querySelector('.media-cancel-btn');
            previewContainer.innerHTML = '';
            if (cancelBtn) previewContainer.appendChild(cancelBtn);
            
            // Create a wrapper for multiple files
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexWrap = 'wrap';
            wrapper.style.gap = '10px';
            wrapper.style.justifyContent = 'center';
            wrapper.style.maxHeight = '50vh';
            wrapper.style.overflowY = 'auto';

            files.forEach(file => {
                const item = document.createElement('div');
                item.style.position = 'relative';
                item.style.width = files.length > 1 ? '100px' : 'auto';
                item.style.height = files.length > 1 ? '100px' : 'auto';
                item.style.maxWidth = '100%';
                
                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'contain';
                    img.style.borderRadius = '8px';
                    item.appendChild(img);
                } else if (file.type.startsWith('video/')) {
                    const vid = document.createElement('video');
                    vid.src = URL.createObjectURL(file);
                    vid.controls = true;
                    vid.style.width = '100%';
                    vid.style.height = '100%';
                    vid.style.borderRadius = '8px';
                    item.appendChild(vid);
                } else if (file.type.startsWith('audio/')) {
                    const aud = document.createElement('audio');
                    aud.src = URL.createObjectURL(file);
                    aud.controls = true;
                    aud.style.width = '100%';
                    item.appendChild(aud);
                } else {
                    const card = document.createElement('div');
                    card.className = 'media-file-card';
                    card.innerHTML = `
                        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                        <div class="file-name" style="font-size:10px; word-break:break-all; text-align:center;">${file.name}</div>
                        <div class="file-size" style="font-size:10px;">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    `;
                    card.style.width = '100%';
                    card.style.height = '100%';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.alignItems = 'center';
                    card.style.justifyContent = 'center';
                    card.style.background = 'rgba(255,255,255,0.05)';
                    card.style.borderRadius = '8px';
                    item.appendChild(card);
                }
                wrapper.appendChild(item);
            });
            previewContainer.appendChild(wrapper);
        }

        const captionInput = document.getElementById('media-preview-caption');
        if (captionInput) /** @type {HTMLInputElement} */ (captionInput).value = '';
        
        const modal = document.getElementById('media-preview-modal');
        if (modal) modal.style.display = 'flex';
    }


    // @ts-ignore
    window.closeMediaPreview = function() {
        const modal = document.getElementById('media-preview-modal');
        if (modal) modal.style.display = 'none';
        state.modalFiles = [];
        clearChatFile();
    };

    // @ts-ignore
    window.sendMediaPreview = async function() {
        const files = state.modalFiles;
        if (!files || files.length === 0) return;

        const captionInput = /** @type {HTMLInputElement | null} */ (document.getElementById('media-preview-caption'));
        const caption = captionInput ? captionInput.value.trim() : '';
        const sendBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('media-preview-send-btn'));
        const originalBtnHTML = sendBtn ? sendBtn.innerHTML : '';
        
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="40" stroke-dashoffset="10"/></svg>';
        }

        try {
            // 1. Upload files
            const formData = new FormData();
            files.forEach(f => formData.append('files', f)); // Expects 'files' array in backend
            
            const token = state.user.token;
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            headers['X-Idempotency-Key'] = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
            const apiBase = window.API_BASE_URL || '/api';
            const resp = await fetch(`${apiBase}/chat/upload_multiple`, {
                method: 'POST',
                headers,
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                throw new Error(err.detail || 'Upload failed');
            }
            const data = await resp.json();
            
            // 2. Set pendingFile so sendChatMsg can use it
            const joinedUrls = data.file_urls.join(',');
            state.pendingFile = { url: joinedUrls, name: files.length > 1 ? `${files.length} files` : files[0].name };
            
            // 3. Send message passing the caption directly
            await window.sendChatMsg(caption);
            
            window.closeMediaPreview();
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'unknown';
            if (window.showToast) window.showToast(`Ошибка: ${errorMsg}`);
            addLog(`Ошибка отправки медиа: ${errorMsg}`, 'error');
        } finally {
            if (sendBtn) {
                sendBtn.disabled = false;
                if (originalBtnHTML) sendBtn.innerHTML = originalBtnHTML;
            }
        }
    };

    function clearChatFile() {
        state.pendingFile = null;
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
        const mediaInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-media-input'));
        if (fileInput) fileInput.value = '';
        if (mediaInput) mediaInput.value = '';
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
            const onlineDot = u.is_online ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00f2ff;margin-left:5px;vertical-align:middle;"></span>` : '';
            const handleText = u.handle ? `<span style="color:var(--text-dim);font-size:11px;">${u.handle}</span>` : '';
            div.innerHTML = `
                <div class="sidebar-item-avatar dynamic-avatar" style="background:linear-gradient(135deg,hsl(${hue},70%,50%),hsl(${hue},80%,30%));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;overflow:hidden;">
                    ${u.avatar_url ? '' : initial}
                </div>
                <div class="sidebar-item-info">
                    <div class="sidebar-item-name">${u.username}${onlineDot}</div>
                    <div class="sidebar-item-last-msg">${handleText || 'Skufia-Net'}</div>
                </div>
            `;
            if (u.avatar_url) {
                window.applyAvatarDisplay(div.querySelector('.sidebar-item-avatar'), u.avatar_url);
            }
            div.onclick = async () => {
                document.getElementById('fab-hub-modal').style.display = 'none';
                try {
                    const room = await apiRequest('/chat/rooms', 'POST', { name: 'Private', room_type: 'private', target_user_id: u.id });
                    addLog(room.is_existing ? 'Чат уже существует' : 'Личный чат создан', 'success');
                    await window.loadChatRooms();
                    window.selectChatRoom(room.id, u.username, 'private', u.id, 'member', u.avatar_url);
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
            const avatar = m.avatar_url
                ? `<img src="${m.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
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
                
                <div style="margin-bottom: 10px;">
                    <label style="font-size:11px;color:var(--text-dim);">Название</label>
                    <input type="text" id="group-edit-name" value="${roomInfo.name}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);border-radius:6px;padding:6px 10px;color:var(--text-primary);font-size:13px;margin-top:4px;">
                </div>
                
                <div style="margin-bottom: 12px;">
                    <label style="font-size:11px;color:var(--text-dim);">Описание</label>
                    <textarea id="group-edit-desc" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border-metal);border-radius:6px;padding:6px 10px;color:var(--text-primary);font-size:13px;margin-top:4px;resize:vertical;min-height:40px;">${roomInfo.description || ''}</textarea>
                </div>

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
                
                <button onclick="window.updateGroupSettings(${roomId})" style="width:100%;background:var(--accent-cyan);color:#000;border:none;border-radius:6px;padding:8px;font-weight:bold;cursor:pointer;">
                    Сохранить изменения
                </button>
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

    window.updateGroupSettings = async function(roomId) {
        const nameInput = document.getElementById('group-edit-name');
        const descInput = document.getElementById('group-edit-desc');
        
        const name = nameInput ? nameInput.value.trim() : null;
        const desc = descInput ? descInput.value.trim() : null;
        
        if (!name) {
            addLog('Имя группы не может быть пустым', 'error');
            return;
        }

        try {
            await apiRequest(`/chat/rooms/${roomId}`, 'PUT', { name: name, description: desc });
            addLog('✅ Настройки группы сохранены', 'success');
            
            // Update the room name in the header if it changed
            if (state.chat.currentRoomId === roomId) {
                const headerTitle = document.getElementById('chat-header-title');
                if (headerTitle) headerTitle.textContent = name;
            }
            
            // Refresh modal
            window.openGroupSettings();
        } catch (e) {
            console.error('Update group error:', e);
            addLog('Ошибка сохранения настроек', 'error');
        }
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
    window.openAddMemberModal = async function() {
        const modal = document.getElementById('add-member-modal');
        if (!modal || state.chat.currentRoomId == null) return;
        addMemberSelectedIds.clear();
        document.getElementById('add-member-search').value = '';
        
        modal.style.display = 'flex';
        const list = document.getElementById('add-member-list');
        list.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Загрузка контактов...</div>';

        try {
            if (!state.contacts || state.contacts.length === 0) {
                const users = await apiRequest('/users/list');
                state.contacts = users.filter(u => u.id !== state.user.id);
            }
        } catch (e) {
            console.error('Add member contacts loading error:', e);
            list.innerHTML = '<div style="text-align:center; padding:15px; color:red;">Ошибка загрузки</div>';
            return;
        }

        window.filterAddMemberContacts(); // Will render un-filtered
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
            div.style.cursor = 'pointer';
            
            const isSelected = addMemberSelectedIds.has(c.id);
            
            const initial = (c.username || c.name || '?').charAt(0).toUpperCase();
            const charCode = initial.charCodeAt(0) || 65;
            const hue = (charCode * 137) % 360;
            const onlineDot = c.is_online ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00f2ff;margin-left:5px;vertical-align:middle;"></span>` : '';
            const handleText = c.handle ? `<span style="color:var(--text-dim);font-size:11px;">${c.handle}</span>` : '';

            div.innerHTML = `
                <div style="display:flex; alignItems:center; gap:10px;">
                    <div class="sidebar-item-avatar dynamic-avatar" style="background:linear-gradient(135deg,hsl(${hue},70%,50%),hsl(${hue},80%,30%));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;overflow:hidden;width:40px;height:40px;border-radius:50%;flex-shrink:0;">
                        ${c.avatar_url ? '' : initial}
                    </div>
                    <div class="sidebar-item-info">
                        <div class="sidebar-item-name" style="font-weight:600;">${c.name || c.username || 'Unknown'}${onlineDot}</div>
                        <div class="sidebar-item-last-msg">${handleText || c.phone || ''}</div>
                    </div>
                </div>
                <input type="checkbox" ${isSelected ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color: var(--accent-cyan);">
            `;
            
            if (c.avatar_url) {
                window.applyAvatarDisplay(div.querySelector('.sidebar-item-avatar'), c.avatar_url);
            }
            
            div.onclick = (e) => {
                if(e.target.tagName !== 'INPUT') {
                    const cb = div.querySelector('input[type="checkbox"]');
                    cb.checked = !cb.checked;
                }
                const cb = div.querySelector('input[type="checkbox"]');
                if(cb.checked) addMemberSelectedIds.add(c.id);
                else addMemberSelectedIds.delete(c.id);
            };
            
            list.appendChild(div);
        });
    };

    window.submitAddMembers = async function() {
        if (state.chat.currentRoomId == null || addMemberSelectedIds.size === 0) return;
        
        const userIds = Array.from(addMemberSelectedIds);
        try {
            await apiRequest(`/chat/rooms/${state.chat.currentRoomId}/members`, 'POST', { user_ids: userIds });
            addLog(`Добавлено участников: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
            
            // Update UI dynamically
            state.chat.membersCount += userIds.length;
            const statusEl = document.getElementById('chat-header-status');
            if (statusEl && ['group', 'channel'].includes(state.chat.currentRoomType)) {
                statusEl.textContent = `${state.chat.membersCount} участник(ов)`;
            }
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

    window['closeChatMobile'] = function() {
        const chatMain = document.querySelector('.chat-main');
        if (chatMain) chatMain.classList.remove('active');
    }

    // Attach local listeners
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    if (chatInput) {
        let typingTimer;
        chatInput.addEventListener('input', (e) => {
            if (state.chat.currentRoomId != null) {
                localStorage.setItem(`skuf_draft_${state.chat.currentRoomId}`, e.target.value);
            }
            if (state.chat.socket && state.chat.socket.readyState === 1) {
                state.chat.socket.send(JSON.stringify({
                    type: 'typing_status',
                    status: true,
                    room_id: state.chat.currentRoomId,
                    sender: state.user.display_name || state.user.username || 'Пользователь',
                    sender_id: state.user.id
                }));
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    state.chat.socket.send(JSON.stringify({
                        type: 'typing_status',
                        status: false,
                        room_id: state.chat.currentRoomId,
                        sender: state.user.display_name || state.user.username || 'Пользователь',
                        sender_id: state.user.id
                    }));
                }, 2000);
            }
        });
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendChatMsg(); }
        });
    }
    if (sendChatBtn) {
        // NOTE: send-chat-btn already has onclick in index.html — do NOT add duplicate listener.
        // addEventListener('click', sendChatMsg) passes MouseEvent as directCaption → breaks.
    }
    const chatFileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-file-input'));
    if (chatFileInput) {
        chatFileInput.addEventListener('change', () => {
            if (chatFileInput.files && chatFileInput.files.length > 0) {
                uploadChatFiles(chatFileInput.files);
            }
        });
    }

    const chatMediaInput = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-media-input'));
    if (chatMediaInput) {
        chatMediaInput.addEventListener('change', () => {
            if (chatMediaInput.files && chatMediaInput.files.length > 0) {
                uploadChatFiles(chatMediaInput.files);
            }
        });
    }

    // Attachment menu logic
    window.toggleAttachMenu = function(event) {
        if (event) event.stopPropagation();
        const popup = document.getElementById('attach-menu-popup');
        if (popup) {
            popup.style.display = (popup.style.display === 'none' || !popup.style.display) ? 'flex' : 'none';
        }
    };

    window.attachMedia = function() {
        const popup = document.getElementById('attach-menu-popup');
        if (popup) popup.style.display = 'none';
        if (chatMediaInput) chatMediaInput.click();
    };

    window.attachDocument = function() {
        const popup = document.getElementById('attach-menu-popup');
        if (popup) popup.style.display = 'none';
        if (chatFileInput) chatFileInput.click();
    };

    window.attachLocation = function() {
        const popup = document.getElementById('attach-menu-popup');
        if (popup) popup.style.display = 'none';
        
        if (!navigator.geolocation) {
            addLog('Геопозиция не поддерживается браузером', 'error');
            return;
        }
        
        addLog('Получение геопозиции...', 'info');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const locationUrl = `https://www.google.com/maps?q=${lat},${lon}`;
                
                const chatInput = document.getElementById('chat-input');
                if (chatInput) {
                    chatInput.value = locationUrl;
                    if (window.sendChatMsg) window.sendChatMsg();
                }
            },
            (error) => {
                addLog(`Ошибка получения геопозиции: ${error.message}`, 'error');
            }
        );
    };

    // Close attach menu when clicking outside
    document.addEventListener('click', function(event) {
        const popup = document.getElementById('attach-menu-popup');
        const attachBtn = document.getElementById('chat-attach-btn');
        if (popup && popup.style.display !== 'none') {
            if (!popup.contains(event.target) && (!attachBtn || !attachBtn.contains(event.target))) {
                popup.style.display = 'none';
            }
        }
    });

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
            
            this.audioContext = null;
            this.analyser = null;
            this.animationId = null;
            this.timerInterval = null;
            this.startTime = null;
            this.isCancelled = false;
            
            if(this.btn) {
                // Remove old event listeners by replacing the button with its clone
                const newBtn = this.btn.cloneNode(true);
                this.btn.parentNode.replaceChild(newBtn, this.btn);
                this.btn = newBtn;
                
                this.btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if(this.isRecording) {
                        this.stopAndSend();
                    } else {
                        this.start();
                    }
                });
            }
            
            // Dynamic event delegation for the cancel and send buttons in the overlay
            document.addEventListener('click', (e) => {
                const cancelBtn = e.target.closest('#cancel-record-btn');
                const sendBtn = e.target.closest('#send-record-btn');
                if (cancelBtn && this.isRecording) {
                    e.preventDefault();
                    this.cancel();
                }
                if (sendBtn && this.isRecording) {
                    e.preventDefault();
                    this.stopAndSend();
                }
            });
        }
        
        async start() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                this.audioChunks = [];
                this.isCancelled = false;
                
                this.mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) this.audioChunks.push(event.data);
                };
                
                this.mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
                    this.audioChunks = [];
                    stream.getTracks().forEach(t => t.stop());
                    
                    this.cleanupUI();
                    
                    if (!this.isCancelled && audioBlob.size > 1000) { 
                        this.uploadAudio(audioBlob);
                    }
                };
                
                this.mediaRecorder.start();
                this.isRecording = true;
                
                this.setupUIAndVisualizer(stream);
                
                addLog('Запись голосового сообщения...', 'info');
            } catch(e) {
                addLog('Микрофон недоступен: ' + e.message, 'error');
            }
        }
        
        stopAndSend() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.isCancelled = false;
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }
        
        cancel() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.isCancelled = true;
                this.mediaRecorder.stop();
                this.isRecording = false;
                addLog('Запись отменена', 'info');
            }
        }
        
        setupUIAndVisualizer(stream) {
            const overlay = document.getElementById('recording-overlay');
            if(overlay) overlay.style.display = 'flex';
            
            if(this.btn) {
                this.btn.classList.add('recording');
                this.btn.style.color = 'var(--accent-cyan, #00f2ff)';
            }
            
            this.startTime = Date.now();
            const timerEl = document.getElementById('recording-timer');
            if(timerEl) timerEl.textContent = '0:00';
            
            this.timerInterval = setInterval(() => {
                if(!timerEl) return;
                const diff = Math.floor((Date.now() - this.startTime) / 1000);
                const m = Math.floor(diff / 60);
                const s = diff % 60;
                timerEl.textContent = `${m}:${s < 10 ? '0' + s : s}`;
            }, 1000);
            
            // Audio Visualizer
            const canvas = document.getElementById('recording-visualizer');
            if(!canvas) return;
            const ctx = canvas.getContext('2d');
            
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.audioContext.createMediaStreamSource(stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 64;
                source.connect(this.analyser);
                
                const bufferLength = this.analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                
                const draw = () => {
                    if(!this.isRecording) return;
                    this.animationId = requestAnimationFrame(draw);
                    
                    this.analyser.getByteFrequencyData(dataArray);
                    
                    const rect = canvas.getBoundingClientRect();
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    const barWidth = 3;
                    const gap = 2;
                    const bars = Math.floor(canvas.width / (barWidth + gap));
                    const step = Math.max(1, Math.floor(bufferLength / bars));
                    
                    let x = 0;
                    for(let i = 0; i < bars; i++) {
                        const value = dataArray[i * step] || 0;
                        const percent = value / 255;
                        const minHeight = 2;
                        const barHeight = Math.max(minHeight, canvas.height * percent);
                        
                        ctx.fillStyle = '#00f2ff';
                        const y = (canvas.height - barHeight) / 2;
                        ctx.beginPath();
                        ctx.roundRect(x, y, barWidth, barHeight, 2);
                        ctx.fill();
                        
                        x += barWidth + gap;
                    }
                };
                draw();
            } catch(e) {
                console.error("Audio visualizer error", e);
            }
        }
        
        cleanupUI() {
            if(this.timerInterval) clearInterval(this.timerInterval);
            if(this.animationId) cancelAnimationFrame(this.animationId);
            if(this.audioContext) {
                this.audioContext.close().catch(e => console.error(e));
                this.audioContext = null;
            }
            
            const overlay = document.getElementById('recording-overlay');
            if(overlay) overlay.style.display = 'none';
            
            if(this.btn) {
                this.btn.classList.remove('recording');
                this.btn.style.color = '';
            }
        }
        
        async uploadAudio(blob) {
            const formData = new FormData();
            formData.append('file', blob, 'voice_msg.webm');
            try {
                const headers = {};
                if (state.user.token) headers['Authorization'] = `Bearer ${state.user.token}`;
                headers['X-Idempotency-Key'] = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
                const resp = await fetch(`${API_BASE_URL}/chat/upload_audio`, {
                    method: 'POST',
                    headers,
                    body: formData
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                    let errMsg = err.detail || 'Upload failed';
                    if (Array.isArray(errMsg)) {
                        errMsg = errMsg.map(e => e.msg || JSON.stringify(e)).join(', ');
                    } else if (typeof errMsg === 'object') {
                        errMsg = JSON.stringify(errMsg);
                    }
                    throw new Error(errMsg);
                }
                const data = await resp.json();
                
                const msgInput = document.getElementById('chat-input');
                // [FIX] Save caption, send voice, then clear - do NOT restore old value
                const captionToSend = msgInput ? msgInput.value.trim() : '';
                state.pendingFile = { url: data.audio_url, name: 'Voice Message' };
                await window.sendChatMsg(captionToSend || null);
                // input is already cleared by sendChatMsg - do not restore
            } catch(e) {
                addLog('Ошибка отправки голосового сообщения', 'error');
            }
        }
    }

    // [VIDEO-CIRCLE] Video Circle Recorder Service
    class VideoCircleService {
        constructor() {
            this.btn = document.getElementById('video-record-btn');
            this.mediaRecorder = null;
            this.videoChunks = [];
            this.isRecording = false;
            
            this.timerInterval = null;
            this.startTime = null;
            this.isCancelled = false;
            this.previewVideo = null;
            this.previewContainer = null;
            
            if(this.btn) {
                // Remove old event listeners
                const newBtn = this.btn.cloneNode(true);
                this.btn.parentNode.replaceChild(newBtn, this.btn);
                this.btn = newBtn;
                
                this.btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if(this.isRecording) {
                        this.stopAndSend();
                    } else {
                        this.start();
                    }
                });
            }
        }
        
        async start() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
                this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
                this.videoChunks = [];
                this.isCancelled = false;
                
                this.mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) this.videoChunks.push(event.data);
                };
                
                this.mediaRecorder.onstop = async () => {
                    const videoBlob = new Blob(this.videoChunks, { type: 'video/webm;codecs=vp8,opus' });
                    this.videoChunks = [];
                    stream.getTracks().forEach(t => t.stop());
                    
                    this.cleanupUI();
                    
                    if (!this.isCancelled && videoBlob.size > 1000) {
                        // [UX] Show loading placeholder while video uploads
                        const placeholderId = 'msg-circle-uploading-' + Date.now();
                        const history = document.getElementById('chat-history');
                        let placeholderRow = null;
                        
                        if (history) {
                            placeholderRow = document.createElement('div');
                            placeholderRow.className = 'msg-row msg-me';
                            placeholderRow.id = placeholderId;
                            placeholderRow.innerHTML = `
                                <div class="msg-bubble" style="background:transparent; border:none; padding:4px;">
                                    <div style="width:240px; height:240px; border-radius:50%; background:rgba(0,242,255,0.05); border:2px solid var(--accent-cyan, #00f2ff); display:flex; flex-direction:column; align-items:center; justify-content:center; animation: circleUploadPulse 1.5s ease-in-out infinite;">
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan, #00f2ff)" stroke-width="1.5" opacity="0.7">
                                            <circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-dashoffset="0">
                                                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.2s" repeatCount="indefinite"/>
                                            </circle>
                                            <polygon points="10 8 16 12 10 16 10 8" fill="var(--accent-cyan, #00f2ff)" opacity="0.5"/>
                                        </svg>
                                        <span style="color:var(--text-dim, #888); font-size:11px; margin-top:8px;">Загрузка кружочка...</span>
                                    </div>
                                </div>`;
                            history.appendChild(placeholderRow);
                            history.scrollTop = history.scrollHeight;
                        }
                        
                        // Add CSS animation if not already present
                        if (!document.getElementById('circle-upload-pulse-style')) {
                            const style = document.createElement('style');
                            style.id = 'circle-upload-pulse-style';
                            style.textContent = `@keyframes circleUploadPulse { 0%,100% { opacity:0.6; transform:scale(0.97); } 50% { opacity:1; transform:scale(1.02); } }`;
                            document.head.appendChild(style);
                        }
                        
                        await this.uploadVideo(videoBlob);
                        
                        // Remove placeholder after upload completes
                        if (placeholderRow && placeholderRow.parentNode) {
                            placeholderRow.remove();
                        } else {
                            const ph = document.getElementById(placeholderId);
                            if (ph) ph.remove();
                        }
                    }
                };
                
                this.mediaRecorder.start();
                this.isRecording = true;
                
                this.setupUI(stream);
                
                addLog('Запись видеосообщения...', 'info');
            } catch(e) {
                addLog('Камера/Микрофон недоступны: ' + e.message, 'error');
            }
        }
        
        stopAndSend() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.isCancelled = false;
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }
        
        cancel() {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.isCancelled = true;
                this.mediaRecorder.stop();
                this.isRecording = false;
                addLog('Запись видео отменена', 'info');
            }
        }
        
        setupUI(stream) {
            // UI Overlay for Video
            this.previewContainer = document.createElement('div');
            this.previewContainer.style.position = 'absolute';
            this.previewContainer.style.bottom = '80px';
            this.previewContainer.style.right = '20px';
            this.previewContainer.style.width = '200px';
            this.previewContainer.style.height = '200px';
            this.previewContainer.style.borderRadius = '50%';
            this.previewContainer.style.overflow = 'hidden';
            this.previewContainer.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
            this.previewContainer.style.border = '3px solid var(--accent-cyan)';
            this.previewContainer.style.zIndex = '1000';
            this.previewContainer.style.display = 'flex';
            this.previewContainer.style.flexDirection = 'column';
            this.previewContainer.style.justifyContent = 'center';
            this.previewContainer.style.alignItems = 'center';
            this.previewContainer.style.background = '#000';

            this.previewVideo = document.createElement('video');
            this.previewVideo.srcObject = stream;
            this.previewVideo.autoplay = true;
            this.previewVideo.muted = true;
            this.previewVideo.playsInline = true;
            this.previewVideo.style.width = '100%';
            this.previewVideo.style.height = '100%';
            this.previewVideo.style.objectFit = 'cover';
            this.previewContainer.appendChild(this.previewVideo);

            // Controls overlay inside video
            const controls = document.createElement('div');
            controls.style.position = 'absolute';
            controls.style.bottom = '10px';
            controls.style.display = 'flex';
            controls.style.gap = '15px';
            controls.style.alignItems = 'center';

            const cancelBtn = document.createElement('button');
            cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="white" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            cancelBtn.style.background = 'rgba(239, 68, 68, 0.8)';
            cancelBtn.style.border = 'none';
            cancelBtn.style.borderRadius = '50%';
            cancelBtn.style.width = '36px';
            cancelBtn.style.height = '36px';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.onclick = (e) => { e.stopPropagation(); this.cancel(); };
            controls.appendChild(cancelBtn);

            const timerEl = document.createElement('span');
            timerEl.style.color = 'white';
            timerEl.style.fontWeight = 'bold';
            timerEl.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
            timerEl.textContent = '0:00';
            controls.appendChild(timerEl);

            const sendBtn = document.createElement('button');
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
            sendBtn.style.background = 'rgba(0, 242, 255, 0.8)';
            sendBtn.style.border = 'none';
            sendBtn.style.borderRadius = '50%';
            sendBtn.style.width = '36px';
            sendBtn.style.height = '36px';
            sendBtn.style.cursor = 'pointer';
            sendBtn.onclick = (e) => { e.stopPropagation(); this.stopAndSend(); };
            controls.appendChild(sendBtn);

            this.previewContainer.appendChild(controls);

            const chatLayout = document.querySelector('.chat-layout');
            if(chatLayout) chatLayout.appendChild(this.previewContainer);
            
            if(this.btn) {
                this.btn.classList.add('recording');
                this.btn.style.color = 'var(--accent-cyan, #00f2ff)';
            }
            
            this.startTime = Date.now();
            this.timerInterval = setInterval(() => {
                if(!timerEl) return;
                const diff = Math.floor((Date.now() - this.startTime) / 1000);
                const m = Math.floor(diff / 60);
                const s = diff % 60;
                timerEl.textContent = `${m}:${s < 10 ? '0' + s : s}`;
            }, 1000);
        }
        
        cleanupUI() {
            if(this.timerInterval) clearInterval(this.timerInterval);
            if(this.btn) {
                this.btn.classList.remove('recording');
                this.btn.style.color = '';
            }
            if(this.previewContainer) {
                this.previewContainer.remove();
                this.previewContainer = null;
            }
        }
        
        async uploadVideo(blob) {
            const formData = new FormData();
            formData.append('file', blob, 'video_circle.webm');
            try {
                const headers = {};
                if (state.user.token) headers['Authorization'] = `Bearer ${state.user.token}`;
                headers['X-Idempotency-Key'] = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
                const resp = await fetch(`${API_BASE_URL}/chat/upload_video`, {
                    method: 'POST',
                    headers,
                    body: formData
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                    throw new Error(err.detail || 'Upload failed');
                }
                const data = await resp.json();
                
                const msgInput = document.getElementById('chat-input');
                const captionToSend = msgInput ? msgInput.value.trim() : '';
                state.pendingFile = { url: data.video_url, name: 'Video Message', file_type: 'video_circle' };
                await window.sendChatMsg(captionToSend || null);
            } catch(e) {
                addLog('Ошибка отправки видеосообщения', 'error');
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



    window.showForwardModal = function(text) {
        const modal = document.createElement('div');
        modal.className = 'modal auth-modal-custom';
        modal.style.display = 'flex';
        modal.style.zIndex = '10001';
        
        const content = document.createElement('div');
        content.className = 'modal-content auth-content';
        content.innerHTML = `<h3>Выберите чат для пересылки</h3>
        <div id="forward-rooms-list" style="max-height:300px; overflow-y:auto; margin-top:15px; display:flex; flex-direction:column; gap:10px;"></div>
        <button class="cyber-btn" style="margin-top:15px; width:100%;" onclick="this.closest('.modal').remove()">Отмена</button>`;
        
        modal.appendChild(content);
        document.body.appendChild(modal);

        const list = modal.querySelector('#forward-rooms-list');
        const rooms = window.state.chat.rooms || [];
        if (rooms.length === 0) {
            list.innerHTML = '<p style="color:var(--text-dim); text-align:center;">Нет доступных чатов</p>';
        } else {
            rooms.forEach(room => {
                const btn = document.createElement('button');
                btn.className = 'cyber-btn';
                btn.style.textAlign = 'left';
                btn.style.padding = '10px';
                btn.textContent = room.room_name || room.name || 'Чат';
                btn.onclick = () => {
                    modal.remove();
                    window.selectChatRoom(room.id, room.room_name || room.name, room.type, room.other_user_id, room.role, room.avatar_url);
                    setTimeout(() => {
                        const input = document.getElementById('chat-input');
                        if (input) {
                            input.value = `>>> Пересланное сообщение:\n${text}\n\n`;
                            input.focus();
                        }
                    }, 500);
                };
                list.appendChild(btn);
            });
        }
    };

    // Expose functions to window
    window.connectWebSocket = connectWebSocket;
    window.loadChatRooms = loadChatRooms;
    window.renderChatRooms = renderChatRooms;
    window.renderFoldersTabs = renderFoldersTabs;
    window.selectChatRoom = selectChatRoom;
    window.renderChatMessage = renderChatMessage;
    window.sendChatMsg = sendChatMsg;
    window.uploadChatFiles = uploadChatFiles;
    window.uploadChatFile = (file) => uploadChatFiles([file]);
    window.clearChatFile = clearChatFile;
    window.renderFabContacts = renderFabContacts;
    window.VoiceRecorderService = VoiceRecorderService;
    window.VideoCircleService = VideoCircleService;
    window.EmojiPickerEngine = EmojiPickerEngine;

    // --- IN-APP IMAGE LIGHTBOX ---
    window.openChatLightbox = function(url, galleryUrls, index) {
        let modal = document.getElementById('chat-lightbox-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'chat-lightbox-modal';
            modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:9999; flex-direction:column; justify-content:center; align-items:center;';
            
            const img = document.createElement('img');
            img.id = 'chat-lightbox-img';
            img.style.cssText = 'max-width:100%; max-height:85%; object-fit:contain; border-radius:8px; transition: transform 0.2s ease;';
            
            const closeBtn = document.createElement('div');
            closeBtn.innerHTML = '&#10005;'; // X mark
            closeBtn.style.cssText = 'position:absolute; top:20px; right:20px; color:#fff; font-size:30px; cursor:pointer; width:40px; height:40px; display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.5); border-radius:50%; z-index:10000;';
            closeBtn.onclick = () => window.closeChatLightbox();
            
            const counter = document.createElement('div');
            counter.id = 'chat-lightbox-counter';
            counter.style.cssText = 'position:absolute; top:25px; left:20px; color:#fff; font-size:16px; font-weight:bold; background:rgba(0,0,0,0.5); padding:5px 12px; border-radius:12px;';
            
            const prevBtn = document.createElement('div');
            prevBtn.id = 'chat-lightbox-prev';
            prevBtn.innerHTML = '&#10094;'; // <
            prevBtn.style.cssText = 'position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#fff; font-size:40px; cursor:pointer; padding:20px; text-shadow:0 0 10px rgba(0,0,0,0.8); user-select:none; z-index:10000;';
            
            const nextBtn = document.createElement('div');
            nextBtn.id = 'chat-lightbox-next';
            nextBtn.innerHTML = '&#10095;'; // >
            nextBtn.style.cssText = 'position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#fff; font-size:40px; cursor:pointer; padding:20px; text-shadow:0 0 10px rgba(0,0,0,0.8); user-select:none; z-index:10000;';

            const downloadBtn = document.createElement('a');
            downloadBtn.id = 'chat-lightbox-download';
            downloadBtn.innerHTML = '&#8681;'; // Download arrow
            downloadBtn.style.cssText = 'position:absolute; bottom:30px; right:30px; color:#fff; font-size:24px; cursor:pointer; text-decoration:none; width:50px; height:50px; display:flex; justify-content:center; align-items:center; background:rgba(255,255,255,0.2); border-radius:50%; backdrop-filter:blur(5px); border:1px solid rgba(255,255,255,0.3); z-index:10000;';
            downloadBtn.download = '';
            downloadBtn.target = '_blank';

            modal.appendChild(closeBtn);
            modal.appendChild(counter);
            modal.appendChild(img);
            modal.appendChild(prevBtn);
            modal.appendChild(nextBtn);
            modal.appendChild(downloadBtn);
            
            document.body.appendChild(modal);

            // Click outside to close
            modal.onclick = (e) => {
                if (e.target === modal) window.closeChatLightbox();
            };

            // Swipe logic
            let touchstartX = 0;
            let touchendX = 0;
            
            modal.addEventListener('touchstart', e => {
                touchstartX = e.changedTouches[0].screenX;
            }, {passive: true});

            modal.addEventListener('touchend', e => {
                touchendX = e.changedTouches[0].screenX;
                handleSwipe();
            }, {passive: true});

            function handleSwipe() {
                if (touchendX < touchstartX - 50) window.lightboxNext();
                if (touchendX > touchstartX + 50) window.lightboxPrev();
            }
            
            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (modal.style.display !== 'flex') return;
                if (e.key === 'Escape') window.closeChatLightbox();
                if (e.key === 'ArrowRight') window.lightboxNext();
                if (e.key === 'ArrowLeft') window.lightboxPrev();
            });
        }

        // Dynamically find ALL images in the chat feed
        const allImgElements = Array.from(document.querySelectorAll('.gallery-item-image img, .msg-file-img-preview'));
        const allUrls = allImgElements.map(img => img.src);
        const foundIndex = allUrls.indexOf(url);
        
        if (foundIndex !== -1 && allUrls.length > 0) {
            window._lightboxUrls = allUrls;
            window._lightboxIndex = foundIndex;
        } else {
            // Fallback for isolated images
            window._lightboxUrls = galleryUrls || [url];
            window._lightboxIndex = index || 0;
        }
        
        window.updateLightboxView = function() {
            const img = document.getElementById('chat-lightbox-img');
            const counter = document.getElementById('chat-lightbox-counter');
            const prev = document.getElementById('chat-lightbox-prev');
            const next = document.getElementById('chat-lightbox-next');
            const dl = document.getElementById('chat-lightbox-download');
            
            const curUrl = window._lightboxUrls[window._lightboxIndex];
            img.src = curUrl;
            dl.href = curUrl;
            
            if (window._lightboxUrls.length > 1) {
                counter.style.display = 'block';
                counter.innerText = `${window._lightboxIndex + 1} / ${window._lightboxUrls.length}`;
                prev.style.display = window._lightboxIndex > 0 ? 'block' : 'none';
                next.style.display = window._lightboxIndex < window._lightboxUrls.length - 1 ? 'block' : 'none';
            } else {
                counter.style.display = 'none';
                prev.style.display = 'none';
                next.style.display = 'none';
            }
        };
        
        window.lightboxNext = function() {
            if (window._lightboxIndex < window._lightboxUrls.length - 1) {
                window._lightboxIndex++;
                window.updateLightboxView();
            }
        };
        
        window.lightboxPrev = function() {
            if (window._lightboxIndex > 0) {
                window._lightboxIndex--;
                window.updateLightboxView();
            }
        };

        const prevBtn = document.getElementById('chat-lightbox-prev');
        const nextBtn = document.getElementById('chat-lightbox-next');
        prevBtn.onclick = (e) => { e.stopPropagation(); window.lightboxPrev(); };
        nextBtn.onclick = (e) => { e.stopPropagation(); window.lightboxNext(); };

        window.updateLightboxView();
        modal.style.display = 'flex';
        
        // Push state for back button to close modal instead of exiting app
        history.pushState({ lightbox: true }, "", "#lightbox");
    };

    window.closeChatLightbox = function() {
        const modal = document.getElementById('chat-lightbox-modal');
        if (modal) modal.style.display = 'none';
        if (history.state && history.state.lightbox) {
            history.back(); // Remove the pushed state
        }
    };

    window.addEventListener('popstate', (e) => {
        // If popstate happens, check if modal is open and we aren't in lightbox state
        const modal = document.getElementById('chat-lightbox-modal');
        if (modal && modal.style.display === 'flex') {
            if (!e.state || !e.state.lightbox) {
                // User pressed back button
                modal.style.display = 'none';
            }
        }
    });

};
