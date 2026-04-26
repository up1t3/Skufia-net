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
            lastMsgDiv.textContent = room.last_message || '╨Э╨╡╤В ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╣';

            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(lastMsgDiv);

            const statusSpan = document.createElement('span');
            statusSpan.className = `status-dot ${room.is_online ? 'online' : ''}`;
            statusSpan.style.display = 'none';

            // Delete/Leave button (visible on hover)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'room-delete-btn';
            deleteBtn.innerHTML = 'тЬХ';
            deleteBtn.title = room.type === 'private' ? '╨г╨┤╨░╨╗╨╕╤В╤М ╤З╨░╤В' : '╨Я╨╛╨║╨╕╨╜╤Г╤В╤М / ╤Г╨┤╨░╨╗╨╕╤В╤М';
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
                const label = room.type === 'private' ? '╤Г╨┤╨░╨╗╨╕╤В╤М ╤Н╤В╨╛╤В ╨┐╤А╨╕╨▓╨░╤В╨╜╤Л╨╣ ╤З╨░╤В' : '╨┐╨╛╨║╨╕╨╜╤Г╤В╤М/╤Г╨┤╨░╨╗╨╕╤В╤М ╤Н╤В╤Г ╨║╨╛╨╝╨╜╨░╤В╤Г';
                if (!confirm(`╨Т╤Л ╤Г╨▓╨╡╤А╨╡╨╜╤Л, ╤З╤В╨╛ ╤Е╨╛╤В╨╕╤В╨╡ ${label}? ╨н╤В╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╨╡ ╨╜╨╡╨╛╨▒╤А╨░╤В╨╕╨╝╨╛.`)) return;
                try {
                    await apiRequest(`/chat/rooms/${room.id}`, 'DELETE');
                    // Remove from state and re-render
                    state.chat.rooms = state.chat.rooms.filter(r => r.id !== room.id);
                    if (state.chat.currentRoomId === room.id) {
                        state.chat.currentRoomId = null;
                        const chatMain = document.querySelector('.chat-main');
                        if (chatMain) chatMain.classList.remove('active');
                    }
                    renderChatRooms();
                    addLog(`тЬЕ ╨з╨░╤В ╤Г╨┤╨░╨╗╤С╨╜`, 'success');
                } catch (err) {
                    addLog(`тЭМ ╨Ю╤И╨╕╨▒╨║╨░: ${err.message}`, 'error');
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