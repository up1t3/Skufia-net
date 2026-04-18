/**
 * Enterprise WebRTC Manager for Skufia-Net
 * Handles P2P state, signaling via WebSocket, and UI modal controls.
 */

class RTCManager {
    constructor() {
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentCallTarget = null;
        this.isCalling = false;
        
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
        // Inject Call Modal
        const modalHtml = `
            <div id="rtc-call-modal" class="rtc-modal" style="display:none;">
                <div class="rtc-modal-content">
                    <h2 id="rtc-status-text">Входящий вызов...</h2>
                    <p id="rtc-caller-name">Unknown</p>
                    <div class="rtc-actions">
                        <button id="rtc-accept-btn" class="rtc-btn accept">📞 Принять</button>
                        <button id="rtc-reject-btn" class="rtc-btn reject">❌ Отклонить</button>
                    </div>
                    <audio id="rtc-remote-audio" autoplay></audio>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        this.modal = document.getElementById('rtc-call-modal');
        this.statusText = document.getElementById('rtc-status-text');
        this.callerName = document.getElementById('rtc-caller-name');
        
        document.getElementById('rtc-accept-btn').addEventListener('click', () => this.acceptCall());
        document.getElementById('rtc-reject-btn').addEventListener('click', () => this.endCall());
    }

    startCall(targetUserId) {
        if(this.isCalling) return;
        this.currentCallTarget = targetUserId;
        this.isCalling = true;
        this.showModal('Исходящий вызов...', 'User ' + targetUserId, false);
        this.initiatePeerConnection(targetUserId, true);
    }

    handleIncomingSignal(type, payload, senderId) {
        if(type === 'offer') {
            if(this.isCalling) return; // Busy
            this.currentCallTarget = senderId;
            this.isCalling = true;
            this.incomingOffer = payload;
            this.showModal('Входящий вызов', 'User ' + senderId, true);
        } else if(type === 'answer') {
            if(this.peerConnection) {
                this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
                this.statusText.textContent = 'Звонок активен';
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
        
        // Ensure you have a function called sendSocketEvent in global scope or adjust here
        if(window.sendSocketEvent) {
             window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, type: 'answer', payload: answer });
        }
        this.statusText.textContent = 'Звонок активен';
    }

    async initiatePeerConnection(targetId, isInitiator) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            this.peerConnection = new RTCPeerConnection(this.iceServers);
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            this.peerConnection.ontrack = (event) => {
                document.getElementById('rtc-remote-audio').srcObject = event.streams[0];
            };

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, type: 'candidate', payload: event.candidate });
                }
            };

            if (isInitiator) {
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                if(window.sendSocketEvent) {
                    window.sendSocketEvent('rtc_signal', { target: targetId, type: 'offer', payload: offer });
                }
            }
        } catch(e) {
            console.error("RTC Connection Error", e);
            if(window.addLog) window.addLog('Ошибка микрофона для звонка', 'error');
            this.endCall();
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
            window.sendSocketEvent('rtc_signal', { target: this.currentCallTarget, type: 'end' });
        }
        this.isCalling = false;
        this.peerConnection = null;
        this.localStream = null;
        this.currentCallTarget = null;
        this.incomingOffer = null;
        this.hideModal();
    }

    showModal(status, name, showAccept) {
        this.statusText.textContent = status;
        this.callerName.textContent = name;
        document.getElementById('rtc-accept-btn').style.display = showAccept ? 'inline-block' : 'none';
        this.modal.style.display = 'flex';
    }

    hideModal() {
        this.modal.style.display = 'none';
    }
}

// Attach to window
window.RTCManagerInstance = new RTCManager();
