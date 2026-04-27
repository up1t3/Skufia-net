async function sendChatMsg() {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('chat-input'));
        if (!input || !input.value.trim() || !state.chat.currentRoomId) return;
        
        let content = input.value.trim();
        localStorage.removeItem(`skuf_draft_${state.chat.currentRoomId}`);

        const roomId = state.chat.currentRoomId;
        const receiverId = state.chat.currentReceiverId;

        // --- E2EE: Lazy key establishment ---
        // Try to get/establish session key (private chats only)
        let sessionKey = null;
        if (receiverId) {
            sessionKey = await getOrEstablishSessionKey(roomId, receiverId).catch(() => null);
        }

        let payload;
        if (sessionKey) {
            // Encrypt the message
            try {
                const encrypted = await CryptoManager.encryptMessage(sessionKey, content);
                payload = {
                    content: encrypted.content,
                    encryption_iv: encrypted.iv,
                    file_url: state.pendingFile ? state.pendingFile.url : null,
                    reply_to_id: state.chat.replyToId
                };
            } catch (e) {
                addLog('тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╤И╨╕╤Д╤А╨╛╨▓╨░╨╜╨╕╤П ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П', 'error');
                return;
            }
        } else {
            // No E2EE тАФ group chat or recipient hasn't registered keys
            payload = {
                content,
                encryption_iv: '',
                file_url: state.pendingFile ? state.pendingFile.url : null,
                reply_to_id: state.chat.replyToId
            };
        }

        try {
            if (state.chat.editingId) {
                await apiRequest(`/chat/messages/${state.chat.editingId}`, 'PUT', payload);
            } else {
                await apiRequest(`/chat/rooms/${roomId}/send`, 'POST', payload);
            }
            input.value = '';
            // @ts-ignore
            if(window.cancelReply) window.cancelReply();
            clearChatFile();
            playSound('click');
        } catch (e) { addLog('Transmission failed', 'error'); }
    }
