    // --- MODULE: CHANNEL/GROUP MEMBER MANAGEMENT ---
    let searchTimeout = null;
    
    window.openAddMemberModal = async function() {
        const roomId = state.chat.activeRoomId;
        if (!roomId) return;
        
        document.getElementById('add-member-modal').style.display = 'flex';
        document.getElementById('add-member-search').value = '';
        const listContainer = document.getElementById('add-member-list');
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Загрузка контактов...</div>';
        
        try {
            const contacts = await apiRequest('/contacts');
            state.contacts = contacts || [];
            window.renderAddMemberResults(state.contacts);
        } catch(e) {
            console.error('Error fetching contacts for add member:', e);
            listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#ff3333;">Ошибка загрузки</div>';
        }
    };

    window.filterAddMemberContacts = function() {
        const query = document.getElementById('add-member-search').value.toLowerCase().trim();
        const listContainer = document.getElementById('add-member-list');
        
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        if (!query) {
            window.renderAddMemberResults(state.contacts);
            return;
        }

        searchTimeout = setTimeout(async () => {
            listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Поиск...</div>';
            try {
                const results = await apiRequest(`/users/search/${encodeURIComponent(query)}`);
                window.renderAddMemberResults(results || []);
            } catch(e) {
                console.error('Search error:', e);
                listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#ff3333;">Ошибка поиска</div>';
            }
        }, 400);
    };

    window.renderAddMemberResults = function(contacts) {
        const listContainer = document.getElementById('add-member-list');
        listContainer.innerHTML = '';
        
        if (!contacts || contacts.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-dim);">Ничего не найдено</div>';
            return;
        }
        
        contacts.forEach(contact => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.marginBottom = '5px';
            const initial = (contact.display_name || contact.username).charAt(0).toUpperCase();
            
            div.innerHTML = `
                <div class="sidebar-item-avatar">${contact.avatar_url ? \`<img src="\${API_BASE_URL}\${contact.avatar_url}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">\` : initial}</div>
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
            await apiRequest(`/chat/rooms/${roomId}/members`, 'POST', { user_ids: userIds });
            addLog(`Добавлено участников: ${userIds.length}`, 'success');
            document.getElementById('add-member-modal').style.display = 'none';
        } catch(e) {
            console.error('Error adding members:', e);
            addLog('Ошибка при добавлении: ' + (e.detail || e.message || ''), 'error');
        }
    };
