window.applyAvatarDisplay = function(element, url, index = null) {
    if (!element) return;
    if (url && url.startsWith('SPRITE:')) {
        const [_, src, idx] = url.split(':');
        const i = parseInt(idx);
        const col = i % 3;
        const row = Math.floor(i / 3);
        
        element.style.backgroundImage = `url(${src})`;
        element.style.backgroundSize = '300% 300%'; // 3x3 grid
        element.style.backgroundPosition = `${(col / 2) * 100}% ${(row / 2) * 100}%`;
        element.style.backgroundRepeat = 'no-repeat';
        
        if (element instanceof HTMLImageElement) {
            element.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        }
    } else {
        element.style.backgroundImage = url ? `url(${url})` : 'none';
        element.style.backgroundSize = 'cover';
        element.style.backgroundPosition = 'center';
        element.style.borderRadius = '50%';
        if (element instanceof HTMLImageElement && url) {
            element.src = url;
            element.style.objectFit = 'cover';
        }
    }
};

window.changeTheme = function(themeName) {
    document.body.setAttribute('data-theme', themeName);
    localStorage.setItem('skufia_theme', themeName);
    const label = document.getElementById('current-theme-label');
    if (label) {
        const themeMap = {
            'cyber': 'Cyber Dark',
            'telegram': 'Telegram Dark',
            'light-ios': 'Light OS',
            'gold': 'Cyber Gold',
            'matrix': 'Matrix Green',
            'blood': 'Blood Red'
        };
        label.textContent = themeMap[themeName] || themeName;
    }
};

window.setAndCloseTheme = function(themeName) {
    window.changeTheme(themeName);
    document.getElementById('theme-switcher-modal').style.display = 'none';
    const heroText = document.querySelector('.glitch');
    if (heroText) {
        heroText.style.animation = 'none';
        setTimeout(() => { heroText.style.animation = ''; }, 10);
    }
};

window.debounce = function(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

window.sounds = {
    click: new Audio('assets/sounds/ui_click.mp3'),
    alert: new Audio('assets/sounds/system_alert.mp3'),
    ambient: new Audio('assets/sounds/industrial_hum.mp3')
};

window.playSound = function(soundName, loop = false) {
    if (window.state && !window.state.audioEnabled) return;
    try {
        const s = window.sounds[soundName];
        if (s) {
            s.loop = loop;
            s.volume = loop ? 0.2 : 0.5;
            s.currentTime = 0;
            s.play().catch(() => {});
        }
    } catch (e) { console.log('Audio play failed'); }
};

window.stopSound = function(soundName) {
    try {
        const s = window.sounds[soundName];
        if (s) {
            s.pause();
            s.currentTime = 0;
        }
    } catch (e) {}
};

window.addLog = function(message, type = 'info') {
    console.log(`[SYS_LOG] ${type.toUpperCase()}: ${message}`);
    const consoleLog = document.getElementById('console-log');
    if (!consoleLog) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `> [${new Date().toLocaleTimeString()}] ${message}`;
    consoleLog.appendChild(entry);
    consoleLog.scrollTop = consoleLog.scrollHeight;
    
    if (type === 'error') window.playSound('alert');
};

window.showToast = function(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:99999; display:flex; flex-direction:column; align-items:center; gap:8px; pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'background:rgba(15,20,30,0.95); color:#fff; padding:12px 24px; border-radius:12px; font-size:14px; font-family:Inter,sans-serif; border:1px solid rgba(0,242,255,0.3); backdrop-filter:blur(12px); box-shadow:0 8px 32px rgba(0,0,0,0.4); opacity:0; transform:translateY(-10px); transition:all 0.3s ease; pointer-events:auto; max-width:90vw; text-align:center;';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
};
