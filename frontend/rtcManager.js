/**
 * Enterprise WebRTC Manager for SKUFenger
 * Handles P2P audio/video calls, signaling via WebSocket, and UI modal controls.
 */

class RTCManager {
    constructor() {
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentCallTarget = null;
        this.isCalling = false;
        this.isVideoCall = false;
        
        // Ice Servers - Google STUN as fallback
        this.iceServers = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
            ]
        };
        
        this.initUI();
    }
    
    initUI() {
        // Inject Call Modal with video support
        const modalHtml = `
            <div id="rtc-call-modal" class="rtc-modal" style="display:none;">
                <div class="rtc-modal-content">
                    <div class="rtc-modal-header">
                        <h2 id="rtc-status-text">Входящий вызов...</h2>
                        <p id="rtc-caller-name">Unknown</p>
                        <p id="rtc-call-type" style="font-size:12px;opacity:0.7;margin-top:4px;"></p>
                    </div>
                    <div class="rtc-video-container" id="rtc-video-container" style="display:none;">
                        <video id="rtc-remote-video" autoplay playsinline style="width:100%;max-height:300px;border-radius:8px;background:#000;"></video>
                        <video id="rtc-local-video" autoplay playsinline muted style="width:120px;height:90px;position:absolute;bottom:10px;right:10px;border-radius:6px;border:2px solid rgba(0,242,255,0.5);background:#000;"></video>
                    </div>
                    <div class="rtc-timer" id="rtc-timer" style="font-size:20px;font-family:'Orbitron',monospace;color:var(--accent-cyan);margin:12px 0;display:none;">00:00</div>
                    <div class="rtc-actions">
                        <button id="rtc-accept-btn" class="rtc-btn accept">📞 Принять</button>
                        <button id="rtc-toggle-mute-btn" class="rtc-btn" style="display:none;" title="Выключить микрофон">🎙️</button>
                        <button id="rtc-toggle-video-btn" class="rtc-btn" style="display:none;" title="Переключить камеру">📷</button>
                        <button id="rtc-reject-btn" class="rtc-btn reject">❌ Завершить</button>
                    </div>
                    <audio id="rtc-remote-audio" autoplay></audio>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Inject modal CSS
        const style = document.createElement('style');
        style.textContent = `
            .rtc-modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.7); z-index: 10000;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(8px);
            }
            .rtc-modal-content {
                background: linear-gradient(135deg, rgba(15,20,30,0.97), rgba(25,30,45,0.97));
                border: 1px solid var(--border-metal, rgba(100,120,140,0.3));
                border-radius: 16px; padding: 32px; text-align: center;
                min-width: 320px; max-width: 500px; position: relative;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            }
            .rtc-modal-header h2 { margin: 0 0 6px; font-size: 18px; color: var(--text-main, #fff); }
            .rtc-modal-header p { margin: 0; color: var(--accent-cyan, #0ff); font-size: 14px; }
            .rtc-video-container { position: relative; margin: 16px 0; border-radius: 8px; overflow: hidden; }
            .rtc-actions { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
            .rtc-btn {
                padding: 10px 20px; border: 1px solid var(--border-metal, #444);
                border-radius: 24px; cursor: pointer; font-size: 14px;
                background: rgba(0,0,0,0.3); color: var(--text-main, #fff);
                transition: all 0.2s;
            }
            .rtc-btn:hover { background: rgba(0,242,255,0.1); border-color: var(--accent-cyan, #0ff); }
            .rtc-btn.accept { background: rgba(0,180,80,0.2); border-color: #0b4; color: #0f6; }
            .rtc-btn.accept:hover { background: rgba(0,180,80,0.35); }
            .rtc-btn.reject { background: rgba(200,40,40,0.2); border-color: #c44; color: #f66; }
            .rtc-btn.reject:hover { background: rgba(200,40,40,0.35); }
        `;
        document.head.appendChild(style);
        
        this.modal = document.getElementById('rtc-call-modal');
        this.statusText = document.getElementById('rtc-status-text');
        this.callerName = document.getElementById('rtc-caller-name');
        this.callTypeText = document.getElementById('rtc-call-type');
        this.timerEl = document.getElementById('rtc-timer');
        this.timerInterval = null;
        this.callStartTime = null;
        
        document.getElementById('rtc-accept-btn').addEventListener('click', () => this.acceptCall());
        document.getElementById('rtc-reject-btn').addEventListener('click', () => this.endCall());
        document.getElementById('rtc-toggle-mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('rtc-toggle-video-btn').addEventListener('click', () => this.toggleVideo());
    }

    startCall(targetUserId, isVideo = false) {
        if(this.isCalling) return;
        this.currentCallTarget = targetUserId;
        this.isCalling = true;
        this.isVideoCall = isVideo;
        this.showModal('Исходящий вызов...', 'User ' + targetUserId, false, isVideo);
        this.initiatePeerConnection(targetUserId, true);
    }

    handleIncomingSignal(type, payload, senderId) {
        if(type === 'offer') {
            if(this.isCalling) return; // Busy
            this.currentCallTarget = senderId;
            this.isCalling = true;
            this.incomingOffer = payload;
            this.isVideoCall = payload.sdp && payload.sdp.includes('m=video');
            this.showModal('Входящий вызов', 'User ' + senderId, true, this.isVideoCall);
        } else if(type === 'answer') {
            if(this.peerConnection) {
                this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
                this.statusText.textContent = 'Звонок активен';
                this.startTimer();
                this.showInCallControls();
            }
        } else if(type === 'candidate') {
            if(this.peerConnection) {
                this.peerConnection.addIceCandidate(new RTCIceCandidate(payload));
            }
        } else if(type === 'end') {
            this.endCall(false);
        }
    }

    async acceptCall() {
        if(!this.incomingOffer) return;
        this.statusText.textContent = 'Соединение...';
        document.getElementById('rtc-accept-btn').style.display = 'none';
        
        await this.initiatePeerConnection(this.currentCallTarget, false);
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.incomingOffer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        if(window.sendSocketEvent) {
             window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, signal_type: 'answer', payload: answer });
        }
        this.statusText.textContent = 'Звонок активен';
        this.startTimer();
        this.showInCallControls();
    }

    async initiatePeerConnection(targetId, isInitiator) {
        try {
            const constraints = { audio: true, video: this.isVideoCall };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Show local video if video call
            if (this.isVideoCall) {
                const localVideo = document.getElementById('rtc-local-video');
                const videoContainer = document.getElementById('rtc-video-container');
                if (localVideo) localVideo.srcObject = this.localStream;
                if (videoContainer) videoContainer.style.display = 'block';
            }
            
            this.peerConnection = new RTCPeerConnection(this.iceServers);
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            this.peerConnection.ontrack = (event) => {
                if (this.isVideoCall) {
                    const remoteVideo = document.getElementById('rtc-remote-video');
                    if (remoteVideo) remoteVideo.srcObject = event.streams[0];
                } else {
                    document.getElementById('rtc-remote-audio').srcObject = event.streams[0];
                }
            };

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, signal_type: 'candidate', payload: event.candidate });
                }
            };

            this.peerConnection.onconnectionstatechange = () => {
                const st = this.peerConnection.connectionState;
                if (st === 'connected') {
                    this.statusText.textContent = 'Звонок активен';
                    this.startTimer();
                    this.showInCallControls();
                } else if (st === 'disconnected' || st === 'failed') {
                    this.endCall(false);
                }
            };

            if (isInitiator) {
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                if(window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, signal_type: 'offer', payload: offer });
                }
            }
        } catch(e) {
            console.error("RTC Connection Error", e);
            if(window.addLog) window.addLog(`Ошибка ${this.isVideoCall ? 'камеры' : 'микрофона'} для звонка: ${e.message}`, 'error');
            this.endCall();
        }
    }

    showInCallControls() {
        const muteBtn = document.getElementById('rtc-toggle-mute-btn');
        const videoBtn = document.getElementById('rtc-toggle-video-btn');
        if (muteBtn) muteBtn.style.display = 'inline-block';
        if (videoBtn && this.isVideoCall) videoBtn.style.display = 'inline-block';
    }

    toggleMute() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('rtc-toggle-mute-btn');
            btn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
            btn.title = audioTrack.enabled ? 'Выключить микрофон' : 'Включить микрофон';
        }
    }

    toggleVideo() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('rtc-toggle-video-btn');
            btn.textContent = videoTrack.enabled ? '📷' : '📷❌';
            btn.title = videoTrack.enabled ? 'Выключить камеру' : 'Включить камеру';
        }
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
        if(this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if(this.peerConnection) {
            this.peerConnection.close();
        }
        if(emit && this.currentCallTarget && window.sendSocketEvent) {
            window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, signal_type: 'end' });
        }
        
        // Clean up video elements
        const localVideo = document.getElementById('rtc-local-video');
        const remoteVideo = document.getElementById('rtc-remote-video');
        const videoContainer = document.getElementById('rtc-video-container');
        if (localVideo) localVideo.srcObject = null;
        if (remoteVideo) remoteVideo.srcObject = null;
        if (videoContainer) videoContainer.style.display = 'none';
        
        // Reset controls
        const muteBtn = document.getElementById('rtc-toggle-mute-btn');
        const videoBtn = document.getElementById('rtc-toggle-video-btn');
        if (muteBtn) { muteBtn.style.display = 'none'; muteBtn.textContent = '🎙️'; }
        if (videoBtn) { videoBtn.style.display = 'none'; videoBtn.textContent = '📷'; }

        this.stopTimer();
        this.isCalling = false;
        this.isVideoCall = false;
        this.peerConnection = null;
        this.localStream = null;
        this.currentCallTarget = null;
        this.incomingOffer = null;
        this.hideModal();
        
        if(window.addLog) window.addLog('Звонок завершён', 'info');
    }

    showModal(status, name, showAccept, isVideo = false) {
        this.statusText.textContent = status;
        this.callerName.textContent = name;
        this.callTypeText.textContent = isVideo ? '📹 Видеозвонок' : '📞 Аудиозвонок';
        document.getElementById('rtc-accept-btn').style.display = showAccept ? 'inline-block' : 'none';
        this.modal.style.display = 'flex';
    }

    hideModal() {
        this.modal.style.display = 'none';
    }
}

// Attach to window
window.RTCManagerInstance = new RTCManager();
