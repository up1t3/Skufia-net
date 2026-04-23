
import os

path = r'e:\AgentZero\usr\projects\skufia\frontend\app.js'
backup_path = r'e:\AgentZero\usr\projects\skufia\frontend\app.js.prod_backup'

with open(backup_path, 'r', encoding='utf-8') as f:
    content = f.read()

# The specific block to replace
old_login_logic = """    document.getElementById('login-form').addEventListener('submit', async (e) => {

e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.textContent = 'ОЖИДАНИЕ...';
        try {
            const res = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('login-username').value,
                    password: document.getElementById('login-password').value
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Login failed');

            localStorage.setItem('skuf_token', data.access_token);
            state.user.token = data.access_token;
            authOverlay.style.display = 'none';
            addLog('Аутентификация успешна', 'system');

            // Re-bind auth logic on boot system
            bootSystem();
        } catch (err) {
            document.getElementById('login-error').textContent = err.message;
        } finally {
            btn.textContent = 'ВОЙТИ В СЕТЬ';
        }
    });"""

new_login_logic = """    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        if (btn) btn.textContent = 'ОЖИДАНИЕ...';
        try {
            const res = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('login-username').value,
                    password: document.getElementById('login-password').value
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Login failed');
            
            localStorage.setItem('skuf_token', data.access_token);
            state.user.token = data.access_token;
            state.user.password = document.getElementById('login-password').value; // Temporary store for E2EE key sync
            authOverlay.style.display = 'none';
            addLog('Аутентификация успешна', 'system');
            
            // Re-bind auth logic on boot system
            bootSystem();
        } catch (err) {
            document.getElementById('login-error').textContent = err.message;
        } finally {
            if (btn) btn.textContent = 'ВОЙТИ В СЕТЬ';
        }
    });"""

# Normalize line endings to avoid issues
content = content.replace('\\r\\n', '\\n')
old_login_logic = old_login_logic.replace('\\r\\n', '\\n')
new_login_logic = new_login_logic.replace('\\r\\n', '\\n')

if old_login_logic in content:
    content = content.replace(old_login_logic, new_login_logic)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: app.js restored and updated.")
else:
    # Try a more fuzzy match if needed, but the backup should be exact
    print("ERROR: Could not find the exact block to replace in backup.")
    # Show what we found around that area
    start_idx = content.find("document.getElementById('login-form').addEventListener('submit'")
    if start_idx != -1:
        print("Found starting point at index", start_idx)
        print("Content snippet:", content[start_idx:start_idx+200])
    else:
        print("Could not even find the starting point.")
