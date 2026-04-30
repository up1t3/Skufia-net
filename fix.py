import re

with open("frontend/features.js", "r", encoding="utf-8") as f:
    content = f.read()

wiki_target = """    window.loadWikiArticle = async function(artId, pushState = true) {
        if (pushState) history.pushState({ wikiId: artId }, '', '#wiki-article-' + artId);
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            let modal = document.getElementById('wiki-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'wiki-modal';
                modal.className = 'modal-overlay';
                modal.style.zIndex = '9999';
                modal.innerHTML = `
                    <div class="modal-content glass-panel" style="max-width: 800px; width: 90%; background: var(--bg-panel); border: 1px solid var(--accent-cyan); box-shadow: 0 0 20px rgba(0, 242, 255, 0.2);">
                        <div class="modal-header" style="border-bottom: 1px solid var(--border-metal); padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                            <h2 id="wiki-modal-title" style="margin: 0; color: var(--accent-cyan); font-family: 'Orbitron', sans-serif;">TITLE</h2>
                            <button class="icon-btn" onclick="window.history.back()" style="color: var(--text-dim);">✕</button>
                        </div>
                        <div id="wiki-modal-body" class="premium-scroll" style="max-height: 65vh; overflow-y: auto; text-align: left; padding-right: 15px; font-size: 1.05em; line-height: 1.7; white-space: pre-wrap; color: var(--text-main);">
                            CONTENT
                        </div>
                        <div style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
                            <button class="cyber-btn" onclick="window.history.back()">ЗАКРЫТЬ БАЗУ</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                
                // Add fade-in animation
                modal.style.animation = 'fadeIn 0.3s ease';
            }
            document.getElementById('wiki-modal-title').textContent = "📜 " + art.title.toUpperCase();
            document.getElementById('wiki-modal-body').textContent = art.content;
            modal.style.display = 'flex';
        } catch (e) { addLog('Article data corrupted', 'error'); }
    }"""

wiki_replacement = """    window.loadWikiArticle = async function(artId, pushState = true) {
        if (pushState) history.pushState({ wikiId: artId }, '', '#wiki-article-' + artId);
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            
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
            
            modal.innerHTML = `
                <div class="modal-content glass-panel" style="max-width: 800px; width: 90%; background: var(--bg-panel); border: 1px solid var(--accent-cyan); box-shadow: 0 0 20px rgba(0, 242, 255, 0.2);">
                    <div class="modal-header" style="border-bottom: 1px solid var(--border-metal); padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                        <h2 id="wiki-modal-title" style="margin: 0; color: var(--accent-cyan); font-family: 'Orbitron', sans-serif;"></h2>
                        <button class="icon-btn" onclick="window.history.back()" style="color: var(--text-dim); font-size: 24px; background: none; border: none; cursor: pointer; line-height: 1;">✕</button>
                    </div>
                    <div id="wiki-modal-body" class="premium-scroll" style="max-height: 65vh; overflow-y: auto; text-align: left; padding-right: 15px; font-size: 1.05em; line-height: 1.7; white-space: pre-wrap; color: var(--text-main);"></div>
                    <div style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="cyber-btn" onclick="window.history.back()">ЗАКРЫТЬ БАЗУ</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Prevent XSS and load content
            document.getElementById('wiki-modal-title').textContent = titleText;
            document.getElementById('wiki-modal-body').textContent = contentText;
            
        } catch (e) { 
            console.error('[Wiki] Error loading article:', e);
            addLog('Ошибка при загрузке статьи', 'error'); 
        }
    }"""

forum_target = """        threadView.style.display = 'flex';
        threadView.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid var(--border-metal); padding-bottom: 15px;">
                <button onclick="window.history.back()" style="background: var(--bg-surface); border: 1px solid var(--border-metal); color: var(--text-dim); border-radius: 6px; padding: 6px 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: 0.2s;">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg> Вернуться к Форуму
                </button>
                <span style="color: var(--text-dim); font-size: 14px;">/</span>
                <h3 style="margin: 0; color: var(--text-main); font-size: 1.1em; font-weight: 500;">${title}</h3>
            </div>
            <div id="thread-posts-container" style="display: flex; flex-direction: column; gap: 15px;">
                <div class="system-msg" style="animation: pulse 1.5s infinite;">Дешифровка ответов...</div>
            </div>
        `;"""

forum_replacement = """        threadView.style.display = 'flex';
        threadView.innerHTML = `
            <div class="thread-header" style="background: var(--bg-panel); border: 1px solid var(--border-metal); border-radius: var(--chat-bubble-radius); padding: 16px; margin-bottom: 20px; box-shadow: var(--panel-shadow);">
                <div style="display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-size: 13px; cursor: pointer; width: fit-content; margin-bottom: 12px;" onclick="window.history.back()">
                    <span style="font-size: 16px; font-family: monospace;">←</span> 
                    <span style="text-decoration: underline; text-underline-offset: 3px;">Назад к темам</span>
                </div>
                <h2 style="margin: 0 0 10px 0; color: var(--accent-cyan); font-family: 'Orbitron', sans-serif; font-size: 1.4em;">${title}</h2>
            </div>
            <div id="thread-posts-container" style="display: flex; flex-direction: column; gap: 15px;">
                <div class="system-msg" style="animation: pulse 1.5s infinite;">Дешифровка ответов...</div>
            </div>
        `;"""

if wiki_target in content:
    content = content.replace(wiki_target, wiki_replacement)
    print("Wiki replaced.")
else:
    print("Wiki not found.")
    
if forum_target in content:
    content = content.replace(forum_target, forum_replacement)
    print("Forum replaced.")
else:
    print("Forum not found.")

with open("frontend/features.js", "w", encoding="utf-8") as f:
    f.write(content)
