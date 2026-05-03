    window.chatOptionAction = function(action) {
        const dd = document.getElementById('chat-options-dropdown');
        if (dd) dd.style.display = 'none';

        switch(action) {
            case 'mute': {
                const roomId = state.chat.currentRoomId;
                if (!roomId) { addLog('Сначала выберите чат', 'error'); return; }
                const mutedRooms = JSON.parse(localStorage.getItem('skuf_muted_rooms') || '[]');
                const idx = mutedRooms.indexOf(roomId);
                if (idx === -1) {
                    mutedRooms.push(roomId);
                    addLog('🔕 Уведомления чата отключены', 'info');
                } else {
                    mutedRooms.splice(idx, 1);
                    addLog('🔔 Уведомления чата включены', 'info');
                }
                localStorage.setItem('skuf_muted_rooms', JSON.stringify(mutedRooms));
                break;
            }
            case 'search': {
                const chatHistory = document.getElementById('chat-history');
                if (!chatHistory) return;
                const term = prompt('Поиск по сообщениям:');
                if (!term || !term.trim()) return;
                const messages = chatHistory.querySelectorAll('.chat-msg');
                let found = 0;
                messages.forEach(msg => {
                    const bodyEl = msg.querySelector('.msg-body');
                    if (!bodyEl) return;
                    const text = bodyEl.textContent || '';
                    if (text.toLowerCase().includes(term.toLowerCase())) {
                        msg.style.outline = '2px solid var(--accent-cyan)';
                        msg.style.outlineOffset = '2px';
                        if (!found) msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        found++;
                    } else {
                        msg.style.outline = 'none';
                    }
                });
                addLog(`🔍 Найдено совпадений: ${found}`, found ? 'info' : 'error');
                break;
            }
            case 'wallpaper': {
                const chatHistory = document.getElementById('chat-history');
                if (!chatHistory) return;
                const wallpapers = [
                    'linear-gradient(135deg, rgba(10,14,20,0.95), rgba(20,30,50,0.95))',
                    'linear-gradient(135deg, rgba(30,10,30,0.95), rgba(15,15,35,0.95))',
                    'linear-gradient(135deg, rgba(10,25,20,0.95), rgba(15,20,35,0.95))',
                    'linear-gradient(135deg, rgba(25,20,10,0.95), rgba(20,15,25,0.95))',
                    'none'
                ];
                const current = localStorage.getItem('skuf_wallpaper_idx') || '0';
                const next = (parseInt(current) + 1) % wallpapers.length;
                chatHistory.style.background = wallpapers[next];
                localStorage.setItem('skuf_wallpaper_idx', String(next));
                addLog('🎨 Фон чата обновлён', 'info');
                break;
            }
            case 'clear': {
                if (!state.chat.currentRoomId) { addLog('Сначала выберите чат', 'error'); return; }
                if (!confirm('Очистить историю сообщений? Это действие необратимо.')) return;
                const chatHistory = document.getElementById('chat-history');
                if (chatHistory) {
                    chatHistory.innerHTML = '<div class="chat-placeholder">История очищена</div>';
                }
                addLog('🗑️ История чата очищена', 'info');
                break;
            }
            case 'encryption': {
                const roomId = state.chat.currentRoomId;
                if (!roomId) { addLog('Сначала выберите чат', 'error'); return; }

                const prefs = JSON.parse(localStorage.getItem('skuf_e2ee_prefs') || '{}');
                // By default E2EE is OFF, so if not set, it's false
                const isCurrentlyEnabled = !!prefs[roomId];
                const newState = !isCurrentlyEnabled;
                
                prefs[roomId] = newState;
                localStorage.setItem('skuf_e2ee_prefs', JSON.stringify(prefs));
                
                // Update UI indicator
                const badge = document.getElementById('chat-encryption-status');
                const e2eeIndicator = document.getElementById('e2ee-indicator');
                
                if (newState) {
                    if (badge) badge.textContent = '🔒 E2E';
                    if (e2eeIndicator) {
                        e2eeIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                        e2eeIndicator.style.color = '#00ff41'; // Green for encrypted
                    }
                    addLog('🔐 Шифрование (E2EE) ВКЛЮЧЕНО для этого чата', 'info');
                } else {
                    if (badge) badge.textContent = '🔓 Нет E2E';
                    if (e2eeIndicator) {
                        e2eeIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
                        e2eeIndicator.style.color = '#8a94a2'; // Gray for unencrypted
                    }
                    addLog('🔓 Шифрование (E2EE) ОТКЛЮЧЕНО для этого чата', 'error');
                }
                break;
            }
        }
    };