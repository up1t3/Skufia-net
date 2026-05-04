/**
 * Enterprise WebRTC Manager for SKUFenger
 * Handles P2P audio/video calls, signaling via WebSocket, and UI modal controls.
 */

/**
 * CallState — централизованное перечисление всех состояний звонка.
 * Единственный источник правды для UI-статуса.
 */
const CallState = Object.freeze({
    IDLE:           'idle',
    WAITING:        'waiting',           // Caller ожидает ответа
    INCOMING:       'incoming',          // Callee получил входящий
    CONNECTING:     'connecting',        // Установка соединения
    ACTIVE:         'active',            // Звонок активен
    AUTOPLAY_BLOCKED: 'autoplay_blocked', // Браузер заблокировал автоплей
    ENDED:          'ended',             // Звонок завершён
});

/**
 * CallStateManager — конечный автомат для управления состоянием звонка.
 * Гарантирует: 1) единственную точку обновления UI, 2) логирование переходов,
 * 3) защиту от дублирующих/некорректных переходов.
 */
class CallStateManager {
    constructor(statusTextEl, timerEl) {
        this._state = CallState.IDLE;
        this._statusTextEl = statusTextEl;
        this._timerEl = timerEl;
        this._listeners = [];

        // Валидные переходы: из какого состояния в какое можно перейти
        this._transitions = {
            [CallState.IDLE]:             [CallState.WAITING, CallState.INCOMING],
            [CallState.WAITING]:          [CallState.ACTIVE, CallState.ENDED, CallState.CONNECTING],
            [CallState.INCOMING]:         [CallState.CONNECTING, CallState.ENDED],
            [CallState.CONNECTING]:       [CallState.ACTIVE, CallState.AUTOPLAY_BLOCKED, CallState.ENDED],
            [CallState.ACTIVE]:           [CallState.ENDED],
            [CallState.AUTOPLAY_BLOCKED]: [CallState.ACTIVE, CallState.ENDED],
            [CallState.ENDED]:            [CallState.IDLE, CallState.WAITING, CallState.INCOMING],
        };

        // Маппинг состояния → текст для UI
        this._labels = {
            [CallState.IDLE]:             '',
            [CallState.WAITING]:          'Ожидание...',
            [CallState.INCOMING]:         'Входящий вызов...',
            [CallState.CONNECTING]:       'Соединение...',
            [CallState.ACTIVE]:           'Звонок активен',
            [CallState.AUTOPLAY_BLOCKED]: 'Нажмите, чтобы включить звук',
            [CallState.ENDED]:            '',
        };
    }

    /** Текущее состояние */
    get state() { return this._state; }

    /** Является ли звонок активным (не idle/ended) */
    get isInCall() {
        return this._state !== CallState.IDLE && this._state !== CallState.ENDED;
    }

    /** Попытка перехода в новое состояние. Возвращает true при успехе. */
    transition(newState, customLabel) {
        const allowed = this._transitions[this._state];
        if (!allowed || !allowed.includes(newState)) {
            console.warn(`[CallState] Invalid transition: ${this._state} → ${newState}`);
            return false;
        }

        const prevState = this._state;
        this._state = newState;

        const label = customLabel || this._labels[newState];
        if (this._statusTextEl && label) {
            this._statusTextEl.textContent = label;
        }

        console.log(`[CallState] ${prevState} → ${newState}${customLabel ? ` ("${customLabel}")` : ''}`);

        // Уведомить слушателей
        this._listeners.forEach(fn => {
            try { fn(newState, prevState); } catch(e) { console.error('[CallState] Listener error:', e); }
        });

        return true;
    }

    /** Принудительный сброс в IDLE (для endCall) */
    reset() {
        this._state = CallState.IDLE;
    }

    /** Подписка на изменения состояния */
    onChange(fn) {
        this._listeners.push(fn);
        return () => { this._listeners = this._listeners.filter(l => l !== fn); };
    }

    /** Установить кастомный label для входящего вызова (видео/аудио) */
    setIncomingLabel(isVideo) {
        this._labels[CallState.INCOMING] = isVideo ? 'Входящий видеовызов...' : 'Входящий вызов...';
    }
}

class RTCManager {
    constructor() {
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentCallTarget = null;
        this.isCalling = false;
        this.isVideoCall = false;
        this.previewStream = null;
        this.currentFacingMode = 'user';
        this._missedCallTimeout = null;  // 45-sec no-answer timer
        this._callWasAnswered = false;   // flag to detect missed vs ended
        this._ringtoneAudio = new Audio('assets/sounds/system_alert.mp3');
        this._ringtoneAudio.loop = true;
        this._vibrateInterval = null;
        this.callState = null; // initialized after DOM elements are cached
        
        // Ice Servers - Google STUN as fallback and local Coturn server
        this.iceServers = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                {
                    urls: `turn:${window.location.hostname}:3478`,
                    username: "guest",
                    credential: "guest_password"
                }
            ]
        };
        
        this.initUI();
    }
    
    initUI() {
        // Inject Call Modal with Telegram-style UI
        const modalHtml = `
            <div id="rtc-call-modal" class="rtc-modal" style="display:none;">
                <div class="rtc-modal-bg" id="rtc-modal-bg"></div>
                
                <div class="rtc-modal-top">
                    <button id="rtc-minimize-btn" class="icon-btn" title="Свернуть">↙️</button>
                    <div style="flex: 1"></div>
                </div>
                
                <div class="rtc-video-container" id="rtc-video-container" style="display:none;">
                    <video id="rtc-remote-video" autoplay playsinline></video>
                    <video id="rtc-local-video" autoplay playsinline muted></video>
                </div>
                
                <div class="rtc-modal-content">
                    <div id="rtc-profile-info" class="rtc-profile-info">
                        <div id="rtc-avatar-container" class="rtc-avatar-container">
                            <div class="rtc-avatar-ring"></div>
                            <div class="rtc-avatar-inner" id="rtc-avatar-inner"></div>
                        </div>
                        <h2 id="rtc-caller-name">Unknown</h2>
                        <p id="rtc-status-text">Ожидание...</p>
                        <div id="rtc-timer" class="rtc-timer" style="display:none;">00:00</div>
                    </div>
                </div>
                
                <!-- Normal Audio Controls -->
                <div class="rtc-actions" id="rtc-actions-audio">
                    <div class="rtc-btn-col">
                        <button id="rtc-speaker-btn" class="rtc-btn-circle"><span class="icon">🔊</span></button>
                        <span>Динамик</span>
                    </div>
                    <div class="rtc-btn-col">
                        <button id="rtc-video-start-btn" class="rtc-btn-circle"><span class="icon">📹<div class="cross-line" id="rtc-video-cross"></div></span></button>
                        <span>Вкл. видео</span>
                    </div>
                    <div class="rtc-btn-col" id="rtc-switch-cam-col" style="display:none;">
                        <button id="rtc-switch-cam-btn" class="rtc-btn-circle"><span class="icon" style="font-size:24px;">🔄</span></button>
                        <span>Камера</span>
                    </div>
                    <div class="rtc-btn-col">
                        <button id="rtc-toggle-mute-btn" class="rtc-btn-circle"><span class="icon">🎤<div class="cross-line" id="rtc-mute-cross" style="display:none;"></div></span></button>
                        <span>Выкл. звук</span>
                    </div>
                    <div class="rtc-btn-col">
                        <button id="rtc-reject-btn" class="rtc-btn-circle reject" style="transform: rotate(135deg);"><span class="icon">📞</span></button>
                        <span>Завершить</span>
                    </div>
                </div>
                
                <!-- Incoming Call Controls -->
                <div class="rtc-actions" id="rtc-actions-incoming" style="display:none; justify-content: space-around; width: 100%; padding: 0 40px;">
                    <div class="rtc-btn-col">
                        <button id="rtc-reject-btn-inc" class="rtc-btn-circle reject" style="transform: rotate(135deg); width: 70px; height: 70px;"><span class="icon" style="font-size:28px;">📞</span></button>
                        <span>Отклонить</span>
                    </div>
                    <div class="rtc-btn-col">
                        <button id="rtc-accept-btn" class="rtc-btn-circle accept" style="width: 70px; height: 70px;"><span class="icon" style="font-size:28px;">📞</span></button>
                        <span>Принять</span>
                    </div>
                </div>
                
                <!-- Video Broadcast Panel -->
                <div class="rtc-video-options" id="rtc-video-options" style="display:none;">
                    <button id="rtc-broadcast-btn" class="rtc-broadcast-btn">Включить трансляцию</button>
                    <div class="rtc-camera-selector">
                        <div id="rtc-src-screen" class="rtc-src-btn">Экран телефона</div>
                        <div id="rtc-src-front" class="rtc-src-btn active">Передняя камера</div>
                        <div id="rtc-src-back" class="rtc-src-btn">Задняя камера</div>
                    </div>
                </div>
            </div>
            
            <!-- Floating Bar for Minimized Call -->
            <div id="rtc-floating-bar" class="rtc-floating-bar" style="display:none;">
                <span style="display:flex;align-items:center;gap:8px;">
                    <span class="pulse-dot"></span>
                    ВЕРНУТЬСЯ К ЗВОНКУ
                </span>
                <span id="rtc-floating-mic">🎤</span>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Inject modal CSS
        const style = document.createElement('style');
        style.textContent = `
            .rtc-modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 10000; display: flex; flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .rtc-modal-bg {
                position: absolute; top:0; left:0; width:100%; height:100%;
                background: linear-gradient(180deg, #2481ce 0%, #765dd1 100%);
                z-index: -2;
            }
            .rtc-modal-top {
                position: absolute; top: 20px; left: 20px; right: 20px; z-index: 10;
                display: flex; justify-content: space-between;
            }
            .rtc-modal-top .icon-btn {
                background: transparent; border: none; color: white; font-size: 24px; cursor: pointer;
            }
            .rtc-video-container {
                position: absolute; top:0; left:0; width:100%; height:100%; z-index:-1;
                background: #000;
            }
            .rtc-video-container video {
                width: 100%; height: 100%; object-fit: cover;
            }
            #rtc-local-video {
                width: 120px; height: 160px; position: absolute; bottom: 150px; right: 20px;
                border-radius: 12px; border: 2px solid rgba(255,255,255,0.2);
            }
            .rtc-modal-content {
                flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
                pointer-events: none;
            }
            .rtc-profile-info {
                text-align: center; color: white; display: flex; flex-direction: column; align-items: center;
            }
            .rtc-avatar-container {
                position: relative; width: 140px; height: 140px; margin-bottom: 20px;
            }
            .rtc-avatar-ring {
                position: absolute; top:-10px; left:-10px; right:-10px; bottom:-10px;
                border-radius: 50%; border: 1px solid rgba(255,255,255,0.2);
                background: rgba(255,255,255,0.05);
            }
            .rtc-avatar-inner {
                width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
            }
            .rtc-profile-info h2 { margin: 0; font-size: 28px; font-weight: 500; }
            .rtc-profile-info p { margin: 8px 0 0; font-size: 16px; opacity: 0.8; }
            .rtc-timer { margin-top: 8px; font-size: 16px; opacity: 0.9; }
            
            .rtc-actions {
                position: absolute; bottom: 40px; left: 0; width: 100%;
                display: flex; justify-content: center; gap: 20px; z-index: 10;
            }
            .rtc-btn-col {
                display: flex; flex-direction: column; align-items: center; gap: 8px;
                color: white; font-size: 12px; font-weight: 500;
            }
            .rtc-btn-circle {
                width: 60px; height: 60px; border-radius: 50%; border: none;
                background: rgba(255,255,255,0.2); color: white; font-size: 24px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; position: relative; backdrop-filter: blur(5px);
            }
            .rtc-btn-circle:active { background: rgba(255,255,255,0.3); }
            .rtc-btn-circle.reject { background: #ff3b30; }
            .rtc-btn-circle.accept { background: #34c759; }
            .cross-line {
                position: absolute; top: 15%; left: 50%; width: 2px; height: 70%;
                background: white; transform: rotate(45deg); transform-origin: center;
            }
            
            .rtc-video-options {
                position: absolute; bottom: 0; width: 100%; padding: 20px 20px 40px;
                background: rgba(30,30,30,0.95); border-top-left-radius: 20px; border-top-right-radius: 20px;
                flex-direction: column; gap: 20px; z-index: 10;
            }
            .rtc-broadcast-btn {
                background: #007AFF; color: #fff; padding: 16px; border-radius: 12px;
                font-weight: 600; font-size: 16px; border: none; width: 100%; cursor: pointer;
            }
            .rtc-camera-selector {
                display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: #888;
            }
            .rtc-src-btn { cursor: pointer; text-transform: uppercase; }
            .rtc-src-btn.active { color: #fff; }
            
            .rtc-floating-bar {
                position: fixed; top: 0; left: 0; width: 100%; height: 44px;
                background: #34c759; color: #fff; z-index: 9000;
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 20px; font-weight: 600; font-size: 14px; cursor: pointer;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            }
            .pulse-dot {
                width: 10px; height: 10px; background: white; border-radius: 50%;
                animation: pulse 1.5s infinite;
            }
            @keyframes pulse {
                0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); }
                70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(255, 255, 255, 0); }
                100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
            }
        `;
        document.head.appendChild(style);
        
        this.modal = document.getElementById('rtc-call-modal');
        this.statusText = document.getElementById('rtc-status-text');
        this.callerName = document.getElementById('rtc-caller-name');
        this.avatarInner = document.getElementById('rtc-avatar-inner');
        this.timerEl = document.getElementById('rtc-timer');
        this.floatingBar = document.getElementById('rtc-floating-bar');
        
        this.timerInterval = null;
        this.callStartTime = null;
        this.isMinimized = false;
        this.autoAcceptCallerId = null;
        
        // Инициализация централизованного менеджера состояний
        this.callState = new CallStateManager(this.statusText, this.timerEl);
        
        // Buttons
        document.getElementById('rtc-accept-btn').addEventListener('click', () => this.acceptCall());
        document.getElementById('rtc-reject-btn').addEventListener('click', () => this.endCall());
        document.getElementById('rtc-reject-btn-inc').addEventListener('click', () => this.endCall());
        document.getElementById('rtc-toggle-mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('rtc-video-start-btn').addEventListener('click', () => this.showVideoPreview());
        document.getElementById('rtc-switch-cam-btn').addEventListener('click', () => this.switchActiveCamera());
        document.getElementById('rtc-minimize-btn').addEventListener('click', () => this.minimizeCall());
        this.floatingBar.addEventListener('click', () => this.maximizeCall());
        
        // Video broadcast options
        document.getElementById('rtc-broadcast-btn').addEventListener('click', () => this.startBroadcast());
        document.getElementById('rtc-src-front').addEventListener('click', (e) => this.switchPreviewSource('user', e.target));
        document.getElementById('rtc-src-back').addEventListener('click', (e) => this.switchPreviewSource('environment', e.target));
        document.getElementById('rtc-src-screen').addEventListener('click', (e) => this.switchPreviewSource('screen', e.target));
    }

    startCall(targetUserId, targetName, targetAvatarHtml, isVideo = false) {
        if(this.isCalling) return;
        this.currentCallTarget = targetUserId;
        this._callCallerName = targetName;
        this._callWasAnswered = false;
        this.isCalling = true;
        this.isVideoCall = isVideo;
        this.showModal('Ожидание...', targetName, targetAvatarHtml, false);
        this.callState.transition(CallState.WAITING);
        this.initiatePeerConnection(targetUserId, true);

        // 45-second no-answer timeout
        this._missedCallTimeout = setTimeout(() => {
            if (!this._callWasAnswered && this.isCalling) {
                console.log('[RTC] No answer after 45s — ending call');
                this._sendMissedCallMessage(targetUserId, targetName, isVideo);
                this.endCall(true);
                if (window.showToast) window.showToast('📵 Нет ответа');
            }
        }, 45000);
    }

    /** Posts a missed call system message into the current chat */
    _sendMissedCallMessage(targetUserId, name, isVideo) {
        try {
            const callType = isVideo ? 'Видеозвонок' : 'Аудиозвонок';
            const icon = isVideo ? '📹' : '📞';
            // Find room id for this target
            const roomId = window.state?.chat?.currentRoomId;
            if (!roomId) return;

            // Optimistic UI — render system message immediately
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const el = document.createElement('div');
                el.className = 'msg-bubble system-msg missed-call-msg';
                el.innerHTML = `
                    <span class="missed-call-icon">${icon}</span>
                    <span class="missed-call-text">Пропущенный ${callType.toLowerCase()} от <b>${name || 'вас'}</b></span>
                    <span class="missed-call-time">${timeStr}</span>
                `;
                chatMessages.appendChild(el);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            // Send to backend as a system message so the other side sees it too
            if (window.apiRequest) {
                window.apiRequest(`/chat/rooms/${roomId}/send`, 'POST', {
                    content: `${icon} Пропущенный ${callType.toLowerCase()}`,
                    encryption_iv: '',
                    file_url: null,
                    reply_to_id: null
                }).catch(() => {});
            }
        } catch(e) {
            console.error('[RTC] Failed to send missed call message:', e);
        }
    }

    startRingtone() {
        if (window.state && window.state.audioEnabled === false) return;
        try {
            this._ringtoneAudio.currentTime = 0;
            this._ringtoneAudio.play().catch(e => console.warn('Ringtone blocked:', e));
        } catch(e) {}
        
        if (navigator.vibrate) {
            navigator.vibrate([1000, 1000]);
            this._vibrateInterval = setInterval(() => {
                if (navigator.vibrate) navigator.vibrate([1000, 1000]);
            }, 2000);
        }
    }

    stopRingtone() {
        try {
            this._ringtoneAudio.pause();
            this._ringtoneAudio.currentTime = 0;
        } catch(e) {}
        
        if (this._vibrateInterval) {
            clearInterval(this._vibrateInterval);
            this._vibrateInterval = null;
        }
        if (navigator.vibrate) {
            navigator.vibrate(0);
        }
    }

    handleIncomingSignal(type, payload, senderId, callerName, callerAvatar) {
        let parsedPayload = payload;
        try {
            if (typeof payload === 'string') parsedPayload = JSON.parse(payload);
        } catch (e) {
            console.error("Failed to parse RTC payload", e);
            if(window.addLog) window.addLog('Error parsing payload: ' + e.message, 'error');
        }

        if(type === 'offer') {
            if(this.isCalling && this.currentCallTarget === senderId && this.peerConnection) {
                // Renegotiation (added video)
                this.peerConnection.setRemoteDescription(new RTCSessionDescription(parsedPayload))
                    .then(() => this.peerConnection.createAnswer())
                    .then(answer => this.peerConnection.setLocalDescription(answer))
                    .then(() => {
                        if(window.sendSocketEvent) {
                            window.sendSocketEvent('rtc_signal', { target: senderId, signal_type: 'answer', payload: JSON.stringify(this.peerConnection.localDescription) });
                        }
                    });
                
                const hasVideo = parsedPayload.sdp && parsedPayload.sdp.includes('m=video');
                if (hasVideo) {
                    document.getElementById('rtc-video-container').style.display = 'block';
                    document.getElementById('rtc-profile-info').style.display = 'none';
                    document.getElementById('rtc-modal-bg').style.display = 'none';
                }
                return;
            } else if (this.isCalling) {
                return; // Busy with someone else
            }
            
            // New Incoming Call
            this.currentCallTarget = senderId;
            this.isCalling = true;
            this.incomingOffer = parsedPayload;
            this.isVideoCall = parsedPayload.sdp && parsedPayload.sdp.includes('m=video');
            
            if (this.autoAcceptCallerId === senderId) {
                console.log('[RTC] Auto-accepting call from push notification intent');
                this.autoAcceptCallerId = null;
                this.acceptCall();
                return;
            }
            
            // Try to resolve name and avatar
            let name = callerName || ('User ' + senderId);
            let avatarHtml = '<div style="width:100%;height:100%;background:#555;display:flex;align-items:center;justify-content:center;font-size:40px;">?</div>';
            
            if (callerAvatar) {
                avatarHtml = `<img src="${callerAvatar}" style="width:100%;height:100%;object-fit:cover;">`;
            } else if (window.state && window.state.chat && window.state.chat.rooms) {
                const room = window.state.chat.rooms.find(r => r.id == senderId || r.other_user_id == senderId);
                if (room) {
                    name = callerName || room.name || room.id;
                    if (room.avatar_url) {
                        avatarHtml = `<img src="${room.avatar_url}" style="width:100%;height:100%;object-fit:cover;">`;
                    }
                }
            }
            
            if (name === 'Unknown' && callerName) {
                name = callerName;
            }
            
            this.startRingtone();
            
            const callType = this.isVideoCall ? 'Видеозвонок' : 'Аудиозвонок';
            if (window.Notification && Notification.permission === "granted") {
                try {
                    const notification = new Notification("Входящий вызов", {
                        body: `Вам звонит ${name} (${callType})`,
                        icon: '/pwa/icon-192.png',
                        requireInteraction: true,
                        tag: 'incoming_call',
                        vibrate: [1000, 500, 1000, 500, 1000, 500, 1000]
                    });
                    notification.onclick = function() {
                        window.focus();
                        this.close();
                    };
                } catch(e) {}
            } else if (window.Notification && Notification.permission !== "denied") {
                Notification.requestPermission();
            }
            
            const incomingTitle = this.isVideoCall ? 'Входящий видеовызов...' : 'Входящий вызов...';
            this.callState.setIncomingLabel(this.isVideoCall);
            this.showModal(incomingTitle, name, avatarHtml, true);
            this.callState.transition(CallState.INCOMING);
        } else if(type === 'answer') {
            if(window.addLog) window.addLog('Received answer from ' + senderId, 'info');
            console.log('[RTC] Received answer, peerConnection exists:', !!this.peerConnection, 'signalingState:', this.peerConnection?.signalingState);
            if(this.peerConnection) {
                this.peerConnection.setRemoteDescription(new RTCSessionDescription(parsedPayload))
                    .then(() => {
                        console.log('[RTC] CALLER: Remote description set successfully. connectionState:', this.peerConnection.connectionState, 'iceConnectionState:', this.peerConnection.iceConnectionState);
                        if (this.pendingCandidates) {
                            console.log('[RTC] CALLER: Flushing', this.pendingCandidates.length, 'pending candidates');
                            this.pendingCandidates.forEach(c => this.peerConnection.addIceCandidate(c).catch(e => console.warn(e)));
                            this.pendingCandidates = [];
                        }
                        
                        // IMPORTANT: Update UI *after* successful SDP negotiation
                        console.log('[RTC] CALLER: Setting statusText to Звонок активен. statusText element:', !!this.statusText, 'current text:', this.statusText?.textContent);
                        this.callState.transition(CallState.ACTIVE);
                        this._callWasAnswered = true;
                        if (this._missedCallTimeout) {
                            clearTimeout(this._missedCallTimeout);
                            this._missedCallTimeout = null;
                        }
                        this.startTimer();
                        if (window.addLog) window.addLog('Звонок установлен', 'success');
                    })
                    .catch(e => {
                        console.error('[RTC] CALLER: Error setting answer:', e);
                        if(window.addLog) window.addLog('Error setting answer: ' + e.message, 'error');
                    });
            } else {
                console.error('[RTC] Answer received but peerConnection is null!');
                if(window.addLog) window.addLog('Answer received but no peerConnection!', 'warning');
            }
        } else if(type === 'candidate') {
            if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
                this.peerConnection.addIceCandidate(new RTCIceCandidate(parsedPayload)).catch(e => console.warn(e));
            } else {
                if (!this.pendingCandidates) this.pendingCandidates = [];
                this.pendingCandidates.push(new RTCIceCandidate(parsedPayload));
            }
        } else if(type === 'end') {
            if (this.currentCallTarget == senderId || this.incomingOffer) {
                this.endCall(false);
            }
        } else if(type === 'reject') {
            if (this.isCalling && this.currentCallTarget == senderId) {
                this.endCall(false);
                if(window.addLog) window.addLog('Вызов отклонен', 'warning');
            }
        } else if(type === 'request_offer') {
            if (this.isCalling && this.currentCallTarget == senderId && this.peerConnection && this.peerConnection.localDescription) {
                if(window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: senderId, signal_type: 'offer', payload: JSON.stringify(this.peerConnection.localDescription) });
                }
            }
        }
    }

    async acceptCall() {
        if(!this.incomingOffer) return;
        this.stopRingtone();
        this._stopTitleBlink();
        this._callWasAnswered = true;
        // Clear any missed-call timeout (we are answering!)
        if (this._missedCallTimeout) {
            clearTimeout(this._missedCallTimeout);
            this._missedCallTimeout = null;
        }
        this.callState.transition(CallState.CONNECTING);
        document.getElementById('rtc-actions-incoming').style.display = 'none';
        document.getElementById('rtc-actions-audio').style.display = 'flex';
        this.modal.style.display = 'flex';
        this.floatingBar.style.display = 'none';
        
        try {
            await this.initiatePeerConnection(this.currentCallTarget, false);
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.incomingOffer));
            if (this.pendingCandidates) {
                this.pendingCandidates.forEach(c => this.peerConnection.addIceCandidate(c).catch(e => console.warn(e)));
                this.pendingCandidates = [];
            }
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            if(window.sendSocketEvent) {
                window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, signal_type: 'answer', payload: JSON.stringify(answer) });
            }
            this.callState.transition(CallState.ACTIVE);
            this.startTimer();
            if (window.addLog) window.addLog('Ответ отправлен', 'success');
        } catch (e) {
            console.error('[RTC] Error accepting call:', e);
            if (window.addLog) window.addLog('Ошибка при ответе: ' + e.message, 'error');
            this.endCall(false);
        }
    }

    async initiatePeerConnection(targetId, isInitiator) {
        try {
            console.log('[RTC] Initiating peer connection, targetId:', targetId, 'isInitiator:', isInitiator);
            const constraints = { 
                audio: true, 
                video: this.isVideoCall ? { facingMode: this.currentFacingMode } : false 
            };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[RTC] Obtained local media stream successfully');
            
            if (this.isVideoCall) {
                const localVid = document.getElementById('rtc-local-video');
                localVid.srcObject = this.localStream;
                localVid.play().catch(e => console.error("Local video play error:", e));
                document.getElementById('rtc-video-container').style.display = 'block';
                document.getElementById('rtc-profile-info').style.display = 'none';
                document.getElementById('rtc-modal-bg').style.display = 'none';
                document.getElementById('rtc-video-cross').style.display = 'none';
                document.getElementById('rtc-switch-cam-col').style.display = 'flex';
            }
            
            this.peerConnection = new RTCPeerConnection(this.iceServers);
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            this.peerConnection.ontrack = (event) => {
                console.log('[RTC] ontrack fired, track kind:', event.track.kind);
                
                const remoteVid = document.getElementById('rtc-remote-video');
                let remoteAud = document.getElementById('rtc-remote-audio');
                if (!remoteAud) {
                    remoteAud = document.createElement('audio');
                    remoteAud.id = 'rtc-remote-audio';
                    remoteAud.autoplay = true;
                    remoteAud.playsInline = true;
                    document.body.appendChild(remoteAud);
                }
                
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                }
                if (!this.remoteStream.getTracks().includes(event.track)) {
                    this.remoteStream.addTrack(event.track);
                }
                
                if (event.track.kind === 'video') {
                    if (remoteVid.srcObject !== this.remoteStream) {
                        remoteVid.srcObject = this.remoteStream;
                    }
                    remoteVid.muted = true; // Mute video so it doesn't fight for audio focus
                    remoteVid.play().catch(e => console.warn(e));
                    
                    document.getElementById('rtc-video-container').style.display = 'block';
                    document.getElementById('rtc-profile-info').style.display = 'none';
                    document.getElementById('rtc-modal-bg').style.display = 'none';
                    document.getElementById('rtc-switch-cam-col').style.display = 'flex';
                } else if (event.track.kind === 'audio') {
                    if (remoteAud.srcObject !== this.remoteStream) {
                        remoteAud.srcObject = this.remoteStream;
                    }
                    remoteAud.muted = false;
                    remoteAud.play().then(() => {
                        console.log('[RTC] Remote audio playback started successfully');
                    }).catch(e => {
                        console.error('[RTC] Remote audio play error:', e);
                        // Add tap-to-play overlay if blocked
                        this.callState.transition(CallState.AUTOPLAY_BLOCKED);
                        const handleTap = () => {
                            remoteAud.play();
                            this.callState.transition(CallState.ACTIVE);
                            document.removeEventListener('click', handleTap);
                        };
                        document.addEventListener('click', handleTap);
                    });
                }
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('[RTC] ICE Connection State:', this.peerConnection.iceConnectionState);
                if (this.peerConnection.iceConnectionState === 'failed') {
                    console.error('[RTC] ICE Connection FAILED. Check STUN/TURN server configuration.');
                }
            };

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, signal_type: 'candidate', payload: JSON.stringify(event.candidate) });
                }
            };

            this.peerConnection.onconnectionstatechange = () => {
                const st = this.peerConnection.connectionState;
                console.log('[RTC] Connection State Changed:', st);
                if (st === 'connected') {
                    console.log('[RTC] CONNECTION ESTABLISHED — updating UI to Звонок активен');
                    this.callState.transition(CallState.ACTIVE);
                    this._callWasAnswered = true;
                    this.startTimer();
                    
                    // Setup MediaSession API to keep call alive in background
                    if ('mediaSession' in navigator) {
                        try {
                            const name = this.callerName ? this.callerName.textContent : 'Skufenger';
                            navigator.mediaSession.metadata = new MediaMetadata({
                                title: this.isVideoCall ? 'Видеозвонок' : 'Аудиозвонок',
                                artist: name,
                                album: 'Skufenger Call',
                                artwork: [
                                    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }
                                ]
                            });
                            navigator.mediaSession.setActionHandler('pause', () => { /* prevent native pause */ });
                            navigator.mediaSession.setActionHandler('play', () => { /* prevent native pause */ });
                            if (navigator.mediaSession.setActionHandler) {
                                navigator.mediaSession.setActionHandler('hangup', () => this.endCall());
                            }
                        } catch(e) { console.warn('MediaSession API error:', e); }
                    }
                } else if (st === 'disconnected' || st === 'failed') {
                    console.log('[RTC] Connection lost/failed, ending call');
                    this.endCall(false);
                }
            };

            if (isInitiator) {
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                if(window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, signal_type: 'offer', payload: JSON.stringify(offer) });
                }
            }
        } catch(e) {
            console.error("RTC Connection Error", e);
            if(window.addLog) window.addLog(`Ошибка ${this.isVideoCall ? 'камеры' : 'микрофона'} для звонка: ${e.message}`, 'error');
            this.endCall();
        }
    }

    toggleMute() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const cross = document.getElementById('rtc-mute-cross');
            cross.style.display = audioTrack.enabled ? 'none' : 'block';
            document.getElementById('rtc-floating-mic').style.opacity = audioTrack.enabled ? '1' : '0.5';
        }
    }

    async showVideoPreview() {
        if (this.isVideoCall) return; // Already active
        try {
            document.getElementById('rtc-actions-audio').style.display = 'none';
            document.getElementById('rtc-video-options').style.display = 'flex';
            
            // Get preview stream without sending yet — show on LOCAL video (not remote!)
            this.previewStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.currentFacingMode } });
            const localVid = document.getElementById('rtc-local-video');
            localVid.srcObject = this.previewStream;
            localVid.play().catch(e => console.error('[RTC] Preview play error:', e));
            document.getElementById('rtc-video-container').style.display = 'block';
            document.getElementById('rtc-profile-info').style.display = 'none';
            document.getElementById('rtc-modal-bg').style.display = 'none';
        } catch (e) {
            console.error(e);
            document.getElementById('rtc-actions-audio').style.display = 'flex';
            document.getElementById('rtc-video-options').style.display = 'none';
        }
    }

    async switchActiveCamera() {
        if (!this.isVideoCall || !this.localStream) return;
        
        try {
            // Toggle facing mode
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            console.log('[RTC] Switching camera to:', this.currentFacingMode);
            
            // Re-acquire local stream with new facing mode
            const constraints = {
                audio: true,
                video: { facingMode: this.currentFacingMode }
            };
            
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = newStream.getVideoTracks()[0];
            const newAudioTrack = newStream.getAudioTracks()[0];
            
            // Replace video track in RTCPeerConnection
            if (this.peerConnection) {
                const senders = this.peerConnection.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(newVideoTrack);
                }
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                if (audioSender && newAudioTrack) {
                    await audioSender.replaceTrack(newAudioTrack);
                }
            }
            
            // Stop old tracks
            this.localStream.getTracks().forEach(t => t.stop());
            
            // Assign new stream to local variables and UI
            this.localStream = newStream;
            const localVid = document.getElementById('rtc-local-video');
            localVid.srcObject = this.localStream;
            
        } catch (e) {
            console.error('[RTC] Error switching camera:', e);
            if (window.addLog) window.addLog('Ошибка переключения камеры: ' + e.message, 'error');
            // Revert on failure
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
        }
    }

    async switchPreviewSource(sourceType, element) {
        // Update active tab
        document.querySelectorAll('.rtc-src-btn').forEach(b => b.classList.remove('active'));
        element.classList.add('active');
        
        if (this.previewStream) {
            this.previewStream.getTracks().forEach(t => t.stop());
        }
        
        try {
            if (sourceType === 'screen') {
                this.previewStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            } else {
                this.currentFacingMode = sourceType;
                this.previewStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: sourceType } });
            }
            // Show on local video (preview is YOUR camera, not remote!)
            const localVid = document.getElementById('rtc-local-video');
            localVid.srcObject = this.previewStream;
            localVid.play().catch(e => console.error('[RTC] Preview source play error:', e));
        } catch (e) {
            console.error('[RTC] Switch source error', e);
        }
    }

    async startBroadcast() {
        if (!this.previewStream) return;
        
        document.getElementById('rtc-video-options').style.display = 'none';
        document.getElementById('rtc-actions-audio').style.display = 'flex';
        document.getElementById('rtc-video-cross').style.display = 'none';
        document.getElementById('rtc-switch-cam-col').style.display = 'flex';
        
        this.isVideoCall = true;

        if (!this.peerConnection) {
            // New Video Call initiated
            if (this.previewStream) {
                this.previewStream.getTracks().forEach(t => t.stop());
                this.previewStream = null;
            }
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: this.currentFacingMode } });
                await this.initiatePeerConnection(this.currentCallTarget, true);
            } catch (e) {
                console.error("Media access denied", e);
                this.endCall();
            }
            return;
        }
        
        const videoTrack = this.previewStream.getVideoTracks()[0];
        this.localStream.addTrack(videoTrack);
        
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(videoTrack);
        } else {
            this.peerConnection.addTrack(videoTrack, this.localStream);
        }
        
        // Move preview to local mini video
        const localVid = document.getElementById('rtc-local-video');
        localVid.srcObject = this.previewStream; // Keep preview stream for local display until renegotiation is complete
        localVid.play().catch(e => console.error("Local play error:", e));
        
        // The remote video will be set when we receive the remote track
        const remoteVid = document.getElementById('rtc-remote-video');
        remoteVid.srcObject = this.remoteStream || null;
        if (this.remoteStream) {
            remoteVid.play().catch(e => console.error("Remote play error:", e));
        }
        
        // Send renegotiation offer
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            if(window.sendSocketEvent) {
                window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, signal_type: 'offer', payload: JSON.stringify(offer) });
            }
        } catch(e) {
            console.error(e);
        }
    }

    minimizeCall() {
        this.isMinimized = true;
        this.modal.style.display = 'none';
        this.floatingBar.style.display = 'flex';
        // When scrolling chat, wait to show we are minimized
    }

    maximizeCall() {
        this.isMinimized = false;
        this.floatingBar.style.display = 'none';
        this.modal.style.display = 'flex';
    }

    startTimer() {
        if (this.timerInterval) return;
        this.callStartTime = Date.now();
        this.timerEl.style.display = 'block';
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            this.timerEl.textContent = `${m}:${s}`;
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.timerEl) {
            this.timerEl.style.display = 'none';
            this.timerEl.textContent = '00:00';
        }
    }

    endCall(emit = true) {
        this.stopRingtone();
        // Clear the no-answer timeout if still pending
        if (this._missedCallTimeout) {
            clearTimeout(this._missedCallTimeout);
            this._missedCallTimeout = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.onicecandidate = null;
            this.peerConnection.ontrack = null;
            this.peerConnection.onconnectionstatechange = null;
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.localStream = null;
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });
            this.remoteStream = null;
        }
        
        if(this.previewStream) {
            this.previewStream.getTracks().forEach(track => track.stop());
        }

        if(emit && this.currentCallTarget && window.sendSocketEvent) {
            window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, signal_type: 'end' });
        }
        
        // Clean up UI elements
        const localVidEl = document.getElementById('rtc-local-video');
        if (localVidEl) {
            localVidEl.pause();
            localVidEl.srcObject = null;
        }
        const remoteVidEl = document.getElementById('rtc-remote-video');
        if (remoteVidEl) {
            remoteVidEl.pause();
            remoteVidEl.srcObject = null;
        }
        
        document.getElementById('rtc-video-container').style.display = 'none';
        document.getElementById('rtc-profile-info').style.display = 'flex';
        document.getElementById('rtc-modal-bg').style.display = 'block';
        document.getElementById('rtc-video-cross').style.display = 'block';
        document.getElementById('rtc-mute-cross').style.display = 'none';
        document.getElementById('rtc-video-options').style.display = 'none';
        
        this.stopTimer();
        this.isCalling = false;
        this.isVideoCall = false;
        this.isMinimized = false;
        this.peerConnection = null;
        this.pendingCandidates = [];
        this.localStream = null;
        this.previewStream = null;
        this.remoteStream = null;
        this.currentCallTarget = null;
        this.incomingOffer = null;
        
        this.modal.style.display = 'none';
        this.floatingBar.style.display = 'none';
        this._stopTitleBlink();
        
        if(window.addLog) window.addLog('Звонок завершён', 'info');
    }

    showModal(status, name, avatarHtml, isIncoming = false) {
        // UI текст статуса теперь управляется через CallStateManager
        // showModal только устанавливает начальный текст напрямую
        this.statusText.textContent = status;
        this.callerName.textContent = name;
        this.avatarInner.innerHTML = avatarHtml;
        
        if (isIncoming) {
            document.getElementById('rtc-actions-incoming').style.display = 'flex';
            document.getElementById('rtc-actions-audio').style.display = 'none';

            // Force window to front when tab is backgrounded
            try { window.focus(); } catch(e) {}

            // Blink tab title to attract attention
            if (!this._titleBlinkInterval) {
                const originalTitle = document.title;
                let blink = false;
                this._titleBlinkInterval = setInterval(() => {
                    document.title = blink ? originalTitle : `📞 ВХОДЯЩИЙ ВЫЗОВ — ${name}`;
                    blink = !blink;
                }, 1000);
                this._originalTitle = originalTitle;
            }
        } else {
            document.getElementById('rtc-actions-incoming').style.display = 'none';
            document.getElementById('rtc-actions-audio').style.display = 'flex';
            this._stopTitleBlink();
        }
        
        this.modal.style.display = 'flex';
        this.floatingBar.style.display = 'none';
    }

    _stopTitleBlink() {
        if (this._titleBlinkInterval) {
            clearInterval(this._titleBlinkInterval);
            this._titleBlinkInterval = null;
            if (this._originalTitle) {
                document.title = this._originalTitle;
                this._originalTitle = null;
            }
        }
    }
}

// Attach to window
window.RTCManagerInstance = new RTCManager();
