// Media Capture Logic for Audio (Waveform) and Video (Circles)
// Manages MediaRecorder, streams, and UI bindings for media capture.

let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let recordingStartTime = 0;
let recordingTimerInterval = null;

// Audio context for waveform
let audioContext = null;
let analyser = null;
let dataArray = null;
let source = null;
let animationId = null;

async function startAudioRecording() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(audioStream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            // Cleanup
            audioStream.getTracks().forEach(track => track.stop());
            stopWaveform();
            
            // Convert blob to File and push to pendingFiles
            const file = new File([blob], `voice_message_${Date.now()}.webm`, { type: 'audio/webm' });
            
            // Add a visual preview immediately for the user
            if (!window.state.pendingFiles) window.state.pendingFiles = [];
            
            // Show preview strip
            const preview = document.getElementById('chat-file-preview');
            const nameEl = document.getElementById('chat-file-name');
            if (preview) preview.style.display = 'flex';
            if (nameEl) nameEl.textContent = `🎤 Голосовое сообщение (${(file.size / 1024).toFixed(1)} KB) - Готово к отправке`;
            
            // Fake upload directly into state since voice is singular in intent
            // In a real app we'd upload directly or pass to uploadChatFile.
            // But our uploadChatFile does the network request immediately.
            if (window.uploadChatFile) {
                await window.uploadChatFile(file);
            }
        };

        // UI Updates
        const recordBtn = document.getElementById('voice-record-btn');
        if (recordBtn) recordBtn.classList.add('recording');
        
        // Show waveform canvas and timer
        let waveformContainer = document.getElementById('recording-overlay');
        let canvasId = 'recording-visualizer';
        if (waveformContainer) {
            waveformContainer.style.display = 'flex';
            const cancelBtn = document.getElementById('cancel-record-btn');
            const stopBtn = document.getElementById('send-record-btn');
            if (cancelBtn) cancelBtn.onclick = cancelAudioRecording;
            if (stopBtn) stopBtn.onclick = stopAudioRecording;
        } else {
            waveformContainer = document.getElementById('audio-waveform-container');
            if (!waveformContainer) {
                const chatInputRow = document.querySelector('.chat-input-row');
                if (chatInputRow) {
                    waveformContainer = document.createElement('div');
                    waveformContainer.id = 'audio-waveform-container';
                    waveformContainer.className = 'waveform-container';
                    waveformContainer.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; background:var(--bg-dark); border-radius:30px; align-items:center; z-index:10; padding:0 5px 0 15px; gap:10px; display:flex;';
                    waveformContainer.innerHTML = `
                        <div class="recording-indicator" style="width:10px; height:10px; border-radius:50%; background:var(--accent-red,#ff4444); animation:blink 1s infinite;"></div>
                        <span id="recording-timer" style="color:var(--accent-red,#ff4444); font-weight:600;">0:00</span>
                        <canvas id="waveform-canvas" style="flex:1; height:24px;"></canvas>
                        <button class="capsule-btn stop-btn" onclick="stopAudioRecording()" title="Остановить">⏹</button>
                        <button class="capsule-btn cancel-btn" onclick="cancelAudioRecording()" title="Отменить">✖</button>
                    `;
                    chatInputRow.parentNode.insertBefore(waveformContainer, chatInputRow);
                }
            }
            if (waveformContainer) waveformContainer.style.display = 'flex';
            canvasId = 'waveform-canvas';
        }


        // Timer
        recordingStartTime = Date.now();
        const timerEl = document.getElementById('recording-timer');
        recordingTimerInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - recordingStartTime) / 1000);
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            if (timerEl) timerEl.textContent = `${mins}:${secs}`;
        }, 1000);

        setupWaveform(canvasId);
        mediaRecorder.start(200); // chunk every 200ms
        
    } catch (e) {
        if (window.addLog) window.addLog('Ошибка доступа к микрофону', 'error');
        console.error(e);
    }
}

function setupWaveform(canvasId = 'waveform-canvas') {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaStreamSource(audioStream);
    source.connect(analyser);
    analyser.fftSize = 64;
    
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    
    function draw() {
        if (!canvasCtx) return;
        animationId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        
        canvasCtx.fillStyle = 'transparent';
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 8;
            canvasCtx.fillStyle = '#00ffcc'; // accent-cyan
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    draw();
}

function stopWaveform() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    clearInterval(recordingTimerInterval);
    
    const overlay = document.getElementById('recording-overlay');
    if (overlay) overlay.style.display = 'none';
    
    const waveformContainer = document.getElementById('audio-waveform-container');
    if (waveformContainer) waveformContainer.style.display = 'none';
    
    const chatInputRow = document.querySelector('.chat-input-row');
    if (chatInputRow) chatInputRow.style.display = 'flex';
    
    const recordBtn = document.getElementById('voice-record-btn');
    if (recordBtn) recordBtn.classList.remove('recording');
}

function stopAudioRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}
window.stopAudioRecording = stopAudioRecording;

function cancelAudioRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // override onstop to not save
        mediaRecorder.onstop = () => {
            audioStream.getTracks().forEach(track => track.stop());
            stopWaveform();
        };
        mediaRecorder.stop();
    }
}
window.cancelAudioRecording = cancelAudioRecording;

document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('voice-record-btn');
    if (micBtn) {
        micBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopAudioRecording();
            } else {
                startAudioRecording();
            }
        });
    }
});
