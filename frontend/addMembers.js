    // --- MODULE: CHANNEL/GROUP MEMBER MANAGEMENT ---
    window.openAddMemberModal = async function() {
        const roomId = state.chat.activeRoomId;
        if (!roomId) return;
        
        document.getElementById('add-member-modal').style.display = 'flex';
        document.getElementById('add-member-search').value = '';
        const listContainer = document.getElementById('add-member-list');
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Загрузка контактов...</div>';
        
        try {
            // Fetch contacts to show in modal
            const contacts = await apiRequest('/contacts');
            state.contacts = contacts || [];
            window.filterAddMemberContacts();
        } catch(e) {
            console.error('Error fetching contacts for add member:', e);
            listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#ff3333;">Ошибка загрузки</div>';
        }
    };

    window.filterAddMemberContacts = function() {
        const query = document.getElementById('add-member-search').value.toLowerCase();
        const listContainer = document.getElementById('add-member-list');
        listContainer.innerHTML = '';
        
        const filtered = state.contacts.filter(c => 
            c.username.toLowerCase().includes(query) || 
            (c.display_name && c.display_name.toLowerCase().includes(query))
        );
        
        if (filtered.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Ничего не найдено</div>';
            return;
        }
        
        filtered.forEach(contact => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.marginBottom = '5px';
            const initial = (contact.display_name || contact.username).charAt(0).toUpperCase();
            
            div.innerHTML = `
                <div class="sidebar-item-avatar">${contact.avatar_url ? `<img src="${API_BASE_URL}${contact.avatar_url}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : initial}</div>
                <div class="sidebar-item-info">
                    <div class="sidebar-item-name">${contact.display_name || contact.username}</div>
                    <div class="sidebar-item-last-msg">@${contact.username}</div>
                </div>
                <input type="checkbox" class="add-member-checkbox" value="${contact.id}" style="width: 20px; height: 20px; cursor: pointer;">
            `;
            listContainer.appendChild(div);
        });
    };

    window.submitAddMembers = async function() {
        const roomId = state.chat.activeRoomId;
        if (!roomId) return;
        
        const checkboxes = document.querySelectorAll('.add-member-checkbox:checked');
        const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
        
        if (userIds.length === 0) {
            addLog('Выберите хотя бы один контакт', 'error');
            return;
        }
        
        try {
            // Need to ensure the backend supports adding multiple members or call in loop
            for (let uid of userIds) {
                await apiRequest(`/chat/rooms/${roomId}/members`, 'POST', { user_id: uid });
            }
            addLog(`Добавлено участников: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
        } catch(e) {
            console.error('Error adding members:', e);
            addLog('Ошибка при добавлении', 'error');
        }
    };
