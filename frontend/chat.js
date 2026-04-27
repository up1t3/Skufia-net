// Chat PWA Logic
document.addEventListener('DOMContentLoaded', () => {
    // 1. ServiceWorker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/chat-sw.js').then(registration => {
                console.log('Chat SW registered: ', registration.scope);
            }).catch(err => {
                console.log('Chat SW registration failed: ', err);
            });
        });
    }

    // 2. Elements & State
    const chatLayout = document.querySelector('.chat-layout');
    const backBtn = document.getElementById('back-btn');
    const chatListItems = document.querySelectorAll('.chat-item');
    const sendBtn = document.getElementById('send-btn');
    const msgInput = document.getElementById('message-input');
    const chatMessages = document.getElementById('chat-messages');
    const micBtn = document.getElementById('mic-btn');
    const recordingOverlay = document.getElementById('recording-overlay');
    const recordingTimeDisplay = document.getElementById('recording-time');
    // Group UI Elements
    const createGroupBtn = document.getElementById('create-group-btn');
    const createGroupModal = document.getElementById('create-group-modal');
    const submitGroupBtn = document.getElementById('submit-group-btn');
    const groupNameInput = document.getElementById('group-name-input');

    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            if (createGroupModal) {
                createGroupModal.style.display = 'flex';
            }
        });
    }

    if (submitGroupBtn) {
        submitGroupBtn.addEventListener('click', async () => {
            const name = groupNameInput.value.trim();
            if (!name) return;
            try {
                const res = await fetch('/api/chat/rooms/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({name: name, room_type: 'group'})
                });
                if (res.ok) {
                    createGroupModal.style.display = 'none';
                    groupNameInput.value = '';
                    alert('Group created successfully!');
                    // Optionally refresh chat list here
                } else {
                    alert('Failed to create group');
                }
            } catch (err) {
                console.error(err);
            }
        });
    }


    let ws = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingInterval = null;
    let recordingStartTime = 0;

    // 3. UI Interactions (Mobile-first responsive)

    // Open chat on mobile (slides sidebar away)
    chatListItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all
            chatListItems.forEach(i => i.classList.remove('active'));
            // Add to clicked
            item.classList.add('active');
            // On mobile, show chat main area
            if (window.innerWidth <= 768) {
                chatLayout.classList.add('chat-open');
            }
            // Track room id, default to 1 if not set
            let currentRoomId = item.dataset.roomId || 1;
            if (typeof loadRoomMembers === 'function') {
                loadRoomMembers(currentRoomId);
            }
        });
    });

    // Back button on mobile (slides sidebar back)
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            chatLayout.classList.remove('chat-open');
        });
    }

    // Mobile Swipe Gestures to close sidebar / go back
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);

    function handleSwipe() {
        if (window.innerWidth <= 768) {
            const swipeDistance = touchEndX - touchStartX;
            // Swipe Right (Open sidebar / go back to list)
            if (swipeDistance > 50) {
                chatLayout.classList.remove('chat-open');
            }
            // Swipe Left (Open chat) - usually clicking an item does this, but could be added if needed
            // if (swipeDistance < -50) {
            //     chatLayout.classList.add('chat-open');
            // }
        }
    }

    // Auto-resize textarea
    if (msgInput) {
        msgInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if (this.value.trim() !== '') {
                sendBtn.style.color = 'var(--accent-cyan)';
            } else {
                sendBtn.style.color = '';
            }
        });
    }

    // 4. WebSocket Setup (Basic outline)

    // Member Loading and UI Update
    const chatInfoPanel = document.getElementById('chat-info-panel');
    const groupMembersDiv = document.getElementById('group-members');
    const inviteSection = document.getElementById('invite-section');
    const inviteCodeDisplay = document.getElementById('invite-code-display');
    const copyInviteBtn = document.getElementById('copy-invite-btn');

    async function loadRoomMembers(roomId) {
        try {
            const res = await fetch(`/api/chat/rooms/${roomId}/members`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (res.ok) {
                const data = await res.json();
                chatInfoPanel.style.display = 'flex'; // show the panel

                // Invite Link
                if (data.invite_code) {
                    inviteSection.style.display = 'block';
                    inviteCodeDisplay.value = `skuf-net.local/join/${data.invite_code}`;
                    copyInviteBtn.onclick = () => {
                        navigator.clipboard.writeText(`skuf-net.local/join/${data.invite_code}`);
                        const oldText = copyInviteBtn.textContent;
                        copyInviteBtn.textContent = '✅';
                        setTimeout(() => copyInviteBtn.textContent = oldText, 2000);
                    };
                } else {
                    inviteSection.style.display = 'none';
                }

                // Render members
                groupMembersDiv.innerHTML = ''; // safe, we create elements below
                const myRole = data.my_role;

                data.members.forEach(member => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'member-item';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'member-name';
                    nameSpan.textContent = member.display_name;

                    const roleSpan = document.createElement('span');
                    roleSpan.className = 'member-role';
                    roleSpan.textContent = `(${member.role})`;
                    nameSpan.appendChild(roleSpan);

                    itemDiv.appendChild(nameSpan);

                    // Kick button logic
                    if (myRole === 'admin' && member.user_id !== parseJwt(localStorage.getItem('token'))?.user_id) {
                        const kickBtn = document.createElement('button');
                        kickBtn.className = 'kick-btn';
                        kickBtn.textContent = 'Kick ❌';
                        kickBtn.onclick = async () => {
                            if (confirm(`Kick ${member.display_name}?`)) {
                                await fetch(`/api/chat/rooms/${roomId}/members/${member.user_id}`, {
                                    method: 'DELETE',
                                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                                });
                                loadRoomMembers(roomId);
                            }
                        };
                        itemDiv.appendChild(kickBtn);
                    }
                    groupMembersDiv.appendChild(itemDiv);
                });
            } else {
                chatInfoPanel.style.display = 'none';
            }
        } catch (err) {
            console.error('Error loading members:', err);
            chatInfoPanel.style.display = 'none';
        }
    }

    // Helper for parsing token to get current user_id
    function parseJwt (token) {
        if (!token) return null;
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    }
function connectWebSocket() {
        const token = localStorage.getItem('token');
        if (!token) {
            console.warn("No token found for WebSocket");
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Adjust port/path as per backend (assuming proxy handles /ws or similar, or direct to backend port if testing)
        // Note: For this project standard, usually ws://localhost:8000/ws/chat
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat?token=${token}`);

        ws.onopen = () => {
            console.log("WebSocket connected");
            appendMessage("System: Connected to chat server.", "system");
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleIncomingMessage(data);
        };

        ws.onclose = () => {
            console.log("WebSocket disconnected. Reconnecting...");
            setTimeout(connectWebSocket, 3000);
        };
    }

    // Auto connect for production
    connectWebSocket();

    // 5. Messaging Logic
    function appendMessage(data, type = 'sent') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (data.type === 'audio') {
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            // ensure URL safety by setting .src directly instead of innerHTML
            audioEl.src = data.url;
            contentDiv.appendChild(audioEl);
        } else {
            const text = data.content || data.text;
            if (!text) {
                 contentDiv.textContent = text;
            } else {
                // Parse for skuf-net.local/join/XXXX
                const regex = /(skuf-net\.local\/join\/[a-zA-Z0-9]+)/g;
                let lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    // text before match
                    if (match.index > lastIndex) {
                        contentDiv.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                    }
                    // Button
                    const code = match[0].split('/').pop();
                    const btn = document.createElement('button');
                    btn.className = 'join-btn';
                    btn.dataset.code = code;
                    btn.textContent = match[0];
                    contentDiv.appendChild(btn);

                    lastIndex = regex.lastIndex;
                }
                // text after last match
                if (lastIndex < text.length) {
                    contentDiv.appendChild(document.createTextNode(text.substring(lastIndex)));
                }
            }
        }

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Global listener for join buttons
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('join-btn')) {
            const code = e.target.dataset.code;
            try {
                const res = await fetch(`/api/chat/join/${code}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    alert(`Joined room successfully!`);
                    // optionally reload rooms
                } else {
                    alert('Failed to join room. Link may be invalid.');
                }
            } catch (err) {
                console.error('Join room error:', err);
            }
        }
    });


    function handleIncomingMessage(data) {
        // Example handling
        if (data.type === 'text') {
            appendMessage({ type: 'text', text: data.text }, 'received');
        } else if (data.type === 'audio') {
            appendMessage({ type: 'audio', url: data.url }, 'received');
        }
    }

    function sendTextMessage() {
        const text = msgInput.value.trim();
        if (!text) return;

        // Display locally
        appendMessage({ type: 'text', content: text }, 'sent');

        // Send via WS
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'text', content: text }));
        }

        // Reset input
        msgInput.value = '';
        msgInput.style.height = 'auto';
        sendBtn.style.color = '';
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', sendTextMessage);
    }

    if (msgInput) {
        msgInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextMessage();
            }
        });
    }

    // 6. Voice Recording Logic
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                await sendAudioMessage(audioBlob);

                // Stop all tracks to release mic
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            isRecording = true;

            // UI Updates
            recordingOverlay.classList.add('active');
            recordingStartTime = Date.now();
            updateRecordingTime();
            recordingInterval = setInterval(updateRecordingTime, 1000);

        } catch (err) {
            console.error("Microphone access denied or error:", err);
            alert("Could not access microphone.");
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;

            // UI Updates
            recordingOverlay.classList.remove('active');
            clearInterval(recordingInterval);
            recordingTimeDisplay.textContent = "0:00";
        }
    }

    function updateRecordingTime() {
        const diff = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        recordingTimeDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async function sendAudioMessage(blob) {
        // Optimistic UI update: show audio element immediately
        const localUrl = URL.createObjectURL(blob);
        appendMessage({ type: 'audio', url: localUrl }, 'sent');

        // Prepare FormData
        const formData = new FormData();
        formData.append('file', blob, 'voice_message.webm');

        try {
            // Adjust endpoint path based on your API
            const response = await fetch('/chat/upload_audio', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const result = await response.json();
            console.log("Audio uploaded successfully", result);
            // Optionally, if the server returns a permanent URL, you could update the <audio> src here
            // Or send a WS message that a file was uploaded.

        } catch (error) {
            console.error("Error uploading audio:", error);
            // appendMessage("System: Failed to upload audio message.", "system");
        }
    }

    // Mic button event listeners (Hold to record)
    if (micBtn) {
        // Mouse events
        micBtn.addEventListener('mousedown', startRecording);
        document.addEventListener('mouseup', () => {
            if (isRecording) stopRecording();
        });

        // Touch events for mobile
        micBtn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scroll/zoom
            startRecording();
        });
        document.addEventListener('touchend', () => {
            if (isRecording) stopRecording();
        });
    }
});
