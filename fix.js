const fs = require('fs');

let content = fs.readFileSync('frontend/features.js', 'utf8');
// Normalize newlines to \n for matching
content = content.replace(/\r\n/g, '\n');

const wikiRegex = /    window\.loadWikiArticle = async function\(artId, pushState = true\) {[\s\S]*?\} catch \(e\) \{ addLog\('Article data corrupted', 'error'\); \}\n    \}/m;

const wikiReplacement = `    window.loadWikiArticle = async function(artId, pushState = true) {
        if (pushState) history.pushState({ wikiId: artId }, '', '#wiki-article-' + artId);
        try {
            const art = await apiRequest(\`/wiki/\${artId}\`);
            
            // Remove old modal to reset CSS animations and DOM state
            let oldModal = document.getElementById('wiki-modal');
            if (oldModal) {
                oldModal.remove();
            }
            
            let modal = document.createElement('div');
            modal.id = 'wiki-modal';
            modal.className = 'modal';
            modal.style.zIndex = '9999';
            modal.style.display = 'flex';
            
            // Format title safely
            const titleText = "📜 " + (art.title ? art.title.toUpperCase() : "БЕЗ НАЗВАНИЯ");
            const contentText = art.content || "Содержимое отсутствует.";
            
            modal.innerHTML = \`
                <div class="modal-content glass-panel" style="max-width: 800px; width: 90%; background: var(--bg-panel); border: 1px solid var(--accent-cyan); box-shadow: 0 0 20px rgba(0, 242, 255, 0.2);">
                    <div class="modal-header" style="border-bottom: 1px solid var(--border-metal); padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                        <h2 id="wiki-modal-title" style="margin: 0; color: var(--accent-cyan); font-family: 'Orbitron', sans-serif;"></h2>
                        <button class="icon-btn" onclick="window.history.back()" style="color: var(--text-dim); font-size: 24px; background: none; border: none; cursor: pointer; line-height: 1;">✕</button>
                    </div>
                    <div id="wiki-modal-body" class="premium-scroll" style="max-height: 65vh; overflow-y: auto; text-align: left; padding-right: 15px; font-size: 1.05em; line-height: 1.7; white-space: pre-wrap; color: var(--text-main);"></div>
                    <div style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="cyber-btn" onclick="window.history.back()">ЗАКРЫТЬ БАЗУ</button>
                    </div>
                </div>\`;
            document.body.appendChild(modal);
            
            // Prevent XSS and load content
            document.getElementById('wiki-modal-title').textContent = titleText;
            document.getElementById('wiki-modal-body').textContent = contentText;
            
        } catch (e) { 
            console.error('[Wiki] Error loading article:', e);
            addLog('Ошибка при загрузке статьи', 'error'); 
        }
    }`;

const forumRegex = /        threadView\.style\.display = 'flex';\n        threadView\.innerHTML = `[\s\S]*?<div id="thread-posts-container" style="display: flex; flex-direction: column; gap: 15px;">\n                <div class="system-msg" style="animation: pulse 1.5s infinite;">Дешифровка ответов\.\.\.<\/div>\n            <\/div>\n        `;/m;

const forumReplacement = `        threadView.style.display = 'flex';
        threadView.innerHTML = \`
            <div class="thread-header" style="background: var(--bg-panel); border: 1px solid var(--border-metal); border-radius: var(--chat-bubble-radius); padding: 16px; margin-bottom: 20px; box-shadow: var(--panel-shadow);">
                <div style="display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 13px; cursor: pointer; width: fit-content; margin-bottom: 12px;" onclick="window.history.back()">
                    <span style="font-size: 16px; font-family: monospace;">←</span> 
                    <span style="text-decoration: underline; text-underline-offset: 3px;">Назад к темам</span>
                </div>
                <h2 style="margin: 0 0 10px 0; color: var(--accent-cyan); font-family: 'Orbitron', sans-serif; font-size: 1.4em;">\${title}</h2>
            </div>
            <div id="thread-posts-container" style="display: flex; flex-direction: column; gap: 15px;">
                <div class="system-msg" style="animation: pulse 1.5s infinite;">Дешифровка ответов...</div>
            </div>
        \`;`;

if (wikiRegex.test(content)) {
    content = content.replace(wikiRegex, wikiReplacement);
    console.log("Wiki replaced");
} else {
    console.log("Wiki not found");
}

if (forumRegex.test(content)) {
    content = content.replace(forumRegex, forumReplacement);
    console.log("Forum replaced");
} else {
    console.log("Forum not found");
}

// Write it back with original system endings or just let it be \n. \n is fine for JS.
fs.writeFileSync('frontend/features.js', content, 'utf8');
