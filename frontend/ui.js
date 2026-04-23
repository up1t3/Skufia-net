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
        if (element instanceof HTMLImageElement && url) {
            element.src = url;
        }
    }
};

window.changeTheme = function(themeName) {
    document.body.setAttribute('data-theme', themeName);
    localStorage.setItem('skufia_theme', themeName);
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

const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
window.sounds = {
    click: new Audio(silentWav),
    alert: new Audio(silentWav),
    ambient: new Audio(silentWav)
};

window.playSound = function(soundName, loop = false) {
    if (window.state && !window.state.audioEnabled) return;
    try {
        const s = window.sounds[soundName];
        if (s) {
            s.loop = loop;
            s.volume = loop ? 0.2 : 0.5;
            s.play().catch(() => {});
        }
    } catch (e) { console.log('Audio play failed'); }
};

window.addLog = function(message, type = 'info') {
    const consoleLog = document.getElementById('console-log');
    if (!consoleLog) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `> [${new Date().toLocaleTimeString()}] ${message}`;
    consoleLog.appendChild(entry);
    consoleLog.scrollTop = consoleLog.scrollHeight;
    
    if (type === 'error') window.playSound('alert');
};
