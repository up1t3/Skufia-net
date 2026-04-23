const fs = require('fs');
let code = fs.readFileSync('chat_core.js', 'utf8');

const newFn = `    async function sendChatMsg() {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('chat-input'));
        if (!input || !input.value.trim() || !state.chat.currentRoomId) return;
        
        if (input.disabled) return;
        input.disabled = true;
        const originalPlaceholder = input.placeholder;
        input.placeholder = 'Отправка...';

        let content = input.value.trim();

        const roomId = state.chat.currentRoomId;
        const receiverId = state.chat.receiverId;

        let payload = {
            content,
            encryption_iv: '',
            file_url: state.pendingFile ? state.pendingFile.url : null,
            reply_to_id: state.chat.replyToId
        };

        try {
            // --- E2EE: ENCRYPTION ---
            let isEncrypted = false;
            if (state.chat.currentRoomType === 'private' && typeof getOrEstablishSessionKey === 'function') {
                const sessionKey = await getOrEstablishSessionKey(roomId, receiverId);
                if (sessionKey) {
                    const encrypted = await CryptoManager.encryptMessage(sessionKey, content);
                    payload.content = encrypted.content;
                    payload.encryption_iv = encrypted.iv;
                    isEncrypted = true;
                }
            }

            const savedContent = content;
            const savedFile = state.pendingFile ? { ...state.pendingFile } : null;
            const savedReplyId = state.chat.replyToId;
            
            input.value = '';
            localStorage.removeItem('skuf_draft_' + roomId);
            if (window.cancelReply) window.cancelReply();
            clearChatFile();

            let response;
            if (state.chat.editingId) {
                response = await apiRequest('/chat/messages/' + state.chat.editingId, 'PUT', payload);
            } else {
                response = await apiRequest('/chat/rooms/' + roomId + '/send', 'POST', payload);
            }

            if (!state.chat.editingId) {
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
            state.chat.editingId = null;
            const editBanner = document.getElementById('edit-banner');
            if (editBanner) editBanner.style.display = 'none';
            playSound('click');
        } catch (e) {
            console.error('sendChatMsg error:', e);
            addLog('⚠️ Ошибка отправки: ' + e.message, 'error');
            input.value = content;
        } finally {
            input.disabled = false;
            input.placeholder = originalPlaceholder;
            input.focus();
        }
    }`;

const startIdx = code.indexOf('    async function sendChatMsg() {');
const endMarker = '    // --- ROOMS & CONTACTS ---';
const endIdx = code.indexOf(endMarker, startIdx);
if (startIdx > -1 && endIdx > -1) {
    code = code.substring(0, startIdx) + newFn + '\n\n' + code.substring(endIdx);
    fs.writeFileSync('chat_core.js', code);
    console.log('Replaced successfully.');
} else {
    console.log('Could not find markers', startIdx, endIdx);
}
