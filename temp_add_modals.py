import sys, re

modal_html = """
    <!-- Chat Folder Modals -->
    <div id="folder-modal" class="modal" style="display: none;">
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>Создать папку</h2>
                <span class="close-btn" onclick="document.getElementById('folder-modal').style.display='none'">✕</span>
            </div>
            <div class="form-group">
                <label>Название папки</label>
                <input type="text" id="folder-name-input" placeholder="Например: Работа" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Иконка (опционально)</label>
                <input type="text" id="folder-icon-input" placeholder="💼" autocomplete="off">
            </div>
            <div class="form-group">
                <label>Добавить чаты</label>
                <div id="folder-chats-list" style="max-height: 200px; overflow-y: auto; background: var(--bg-dark); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                </div>
            </div>
            <button class="cyber-btn primary-btn" onclick="window.saveFolder()" style="width: 100%; margin-top: 15px;">СОХРАНИТЬ</button>
        </div>
    </div>

    <div id="add-to-folder-modal" class="modal" style="display: none;">
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>Добавить в папку</h2>
                <span class="close-btn" onclick="document.getElementById('add-to-folder-modal').style.display='none'">✕</span>
            </div>
            <div id="add-to-folder-list" style="max-height: 200px; overflow-y: auto; background: var(--bg-dark); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            </div>
            <button class="cyber-btn primary-btn" onclick="window.saveChatToFolders()" style="width: 100%; margin-top: 15px;">ПРИМЕНИТЬ</button>
        </div>
    </div>
"""

for file_path in ['frontend/index.html', 'frontend/messenger.html']:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if '<div id="folder-modal"' not in content:
        content = content.replace('<script defer src="https://unpkg.com/dexie/dist/dexie.js">', modal_html + '\n    <script defer src="https://unpkg.com/dexie/dist/dexie.js">')
        
    # Inject button in chat-options-dropdown
    add_folder_btn = '<button id="btn-add-to-folder" onclick="window.openAddToFolderModal()" style="color: #10b981;">📁 Добавить в папку</button>'
    if add_folder_btn not in content:
        content = content.replace('<div id="chat-options-dropdown" class="chat-options-dropdown" style="display:none;">', 
                                  '<div id="chat-options-dropdown" class="chat-options-dropdown" style="display:none;">\n                                            ' + add_folder_btn)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
print('Done')
