window.isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.BASE_URL = window.isLocalDev ? 'http://localhost:8007' : '';
window.API_BASE_URL = `${window.BASE_URL}/api`;

window.apiRequest = async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (window.state && window.state.user && window.state.user.token) {
        headers['Authorization'] = `Bearer ${window.state.user.token}`;
    }
    if (method !== 'GET') {
        headers['X-Idempotency-Key'] = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    try {
        const res = await fetch(`${window.API_BASE_URL}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });
        if (res.status === 401) {
            localStorage.removeItem('skuf_token');
            if (window.state && window.state.user) window.state.user.token = null;
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) authOverlay.style.display = 'flex';
            throw new Error('Unauthorized');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        if (window.addLog) window.addLog(`API Error [${endpoint}]: ${e.message}`, 'error');
        throw e;
    }
};
