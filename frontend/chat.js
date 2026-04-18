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

    // Fallback: don't auto connect if just UI testing, but good to have ready.
    // connectWebSocket();

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
            contentDiv.textContent = data.content || data.text;
        }

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

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