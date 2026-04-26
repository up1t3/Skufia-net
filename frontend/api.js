window.isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.BASE_URL = '';
window.API_BASE_URL = `/api`;

window.apiRequest = async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {};
    if (!(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    
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
            body: body instanceof FormData ? body : (body ? JSON.stringify(body) : null),
            cache: 'no-store'
        });
        if (res.status === 401) {
            console.warn('[API] 401 Unauthorized detected. Clearing session.');
            localStorage.removeItem('skuf_token');
            if (window.state && window.state.user) {
                window.state.user.token = null;
                window.state.user.id = null;
                window.state.user.username = 'Guest';
            }
            document.documentElement.classList.remove('is-logged-in'); // Allow overlay to show
            
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) {
                authOverlay.style.display = 'flex';
                const authTitle = document.getElementById('auth-title');
                if (authTitle) authTitle.textContent = 'СЕССИЯ ИСТЕКЛА';
                const authBtn = authOverlay.querySelector('.auth-main-btn');
                if (authBtn) {
                    authBtn.disabled = false;
                    authBtn.textContent = 'ВОЙТИ СНОВА';
                }
            } else {
                // Only as an absolute last resort if DOM is broken
                console.warn('[API] Auth overlay missing from DOM, forcing reload.');
                window.location.reload();
            }
            throw new Error('Unauthorized');
        }
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            let errorCode = null;
            try {
                const errBody = await res.json();
                if (errBody && errBody.detail) {
                    if (typeof errBody.detail === 'string') {
                        detail = errBody.detail;
                    } else if (Array.isArray(errBody.detail)) {
                        detail = errBody.detail.map(e => e.msg || JSON.stringify(e)).join(', ');
                    } else if (typeof errBody.detail === 'object') {
                        if (errBody.detail.message) {
                            detail = errBody.detail.message;
                            errorCode = errBody.detail.code || null;
                        } else {
                            detail = JSON.stringify(errBody.detail);
                        }
                    }
                }
            } catch (_) { /* keep default message */ }
            const err = new Error(detail);
            err.status = res.status;
            err.code = errorCode;
            throw err;
        }
        return await res.json();
    } catch (e) {
        if (window.addLog) window.addLog(`API Error [${endpoint}]: ${e.message}`, 'error');
        throw e;
    }
};
