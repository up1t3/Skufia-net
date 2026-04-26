import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update state
content = content.replace('sessionKeys: {} // Map of roomId -> CryptoKey (AES)', 
                          '''sessionKeys: {}, // Map of roomId -> CryptoKey (AES)\n            currentFolderId: 'all',\n            folders: []''')

# 2. Update switchView
content = content.replace("if (viewId === 'messages') loadChatRooms();", 
                          "if (viewId === 'messages') { loadChatRooms(); if (window.loadFolders) window.loadFolders(); }")

# 3. Add Folders logic and rewrite loadChatRooms
# Find loadChatRooms
match = re.search(r'async function loadChatRooms\(\) \{.*?catch \(e\) \{ addLog\(\\\'Failed to load chat channels\\\', \\'error\\'\); \}\n    \}', content, re.DOTALL)
if match:
    original_fn = match.group(0)
    new_fn = '''async function loadChatRooms() {
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
                img.src = room.avatar_url;
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
            statusSpan.style.display = 'none';

            div.appendChild(avatarDiv);
            div.appendChild(infoDiv);
            div.appendChild(statusSpan);
            div.onclick = () => selectChatRoom(room.id, room.name, room.type, room.other_user_id, room.my_role);
            list.appendChild(div);
        });
    }

    // --- FOLDERS LOGIC ---
    window.openFolderModal = function() {
        const input = document.getElementById('folder-name-input');
        if(input) input.value = '';
        const container = document.getElementById('folder-rooms-selection');
        if (container) {
            container.innerHTML = '';
            if (!state.chat.rooms || state.chat.rooms.length === 0) {
               container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-dim)">Нет доступных чатов</div>';
            } else {
                state.chat.rooms.forEach(room => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.alignItems = 'center';
                    div.style.gap = '10px';
                    div.style.padding = '8px';
                    div.style.borderBottom = '1px solid var(--border-metal)';
                    
                    div.innerHTML = `<input type="checkbox" id="folder-room-${room.id}" value="${room.id}" style="width:16px; height:16px; cursor:pointer;">
                        <label for="folder-room-${room.id}" style="color:var(--text-main); cursor:pointer;">${room.name}</label>`;
                    container.appendChild(div);
                });
            }
        }
        document.getElementById('folder-modal').style.display = 'flex';
    };

    window.submitFolderCreate = async function() {
        const name = document.getElementById('folder-name-input').value.trim();
        if (!name) return addLog('Введите имя папки', 'error');
        
        const checkboxes = document.querySelectorAll('#folder-rooms-selection input[type="checkbox"]:checked');
        const roomIds = Array.from(checkboxes).map(c => parseInt(c.value));
        
        try {
            const resp = await apiRequest('/chat/folders', 'POST', { name: name, room_ids: roomIds });
            addLog('Папка ' + name + ' создана', 'success');
            document.getElementById('folder-modal').style.display = 'none';
            await loadFolders();
        } catch(e) {
            addLog('Ошибка создания папки', 'error');
        }
    };

    window.loadFolders = async function() {
        try {
            state.chat.folders = await apiRequest('/chat/folders');
            renderFoldersTabs();
        } catch(e) {
            console.error('Failed to load folders:', e);
        }
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

    window.selectFolder = function(folderId, element) {
        state.chat.currentFolderId = folderId;
        const tabs = document.querySelectorAll('#chat-folders-tabs .folder-tab');
        tabs.forEach(t => t.classList.remove('active'));
        if (element) element.classList.add('active');
        renderChatRooms();
    };'''
    
    content = content.replace(original_fn, new_fn)
    
    # 4. Expose functions to global scope
    content = content.replace('window.loadChatRooms = loadChatRooms;', 'window.loadChatRooms = loadChatRooms;\n    window.loadFolders = loadFolders;\n    window.renderChatRooms = renderChatRooms;')
    
    with open('frontend/app.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully modified app.js")
else:
    print("Could not find loadChatRooms function block.")
