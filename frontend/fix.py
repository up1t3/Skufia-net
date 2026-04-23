import os

filepath = 'app.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove Source header (lines 1-4)
content = content.replace("Source: https://skuf-net.ru/app.js\n\n---\n\n", "")

# 2. Fix bootSystem param check
content = content.replace(
    "const isStandalone = new URLSearchParams(window.location.search).get('app') === 'skufenger';",
    "const appParam = new URLSearchParams(window.location.search).get('app');\n            const isStandalone = appParam === 'skufenger' || appParam === 'messenger';"
)

# 3. Remove loadFolders call in switchView
content = content.replace(
    "loadChatRooms(); if (window.loadFolders) window.loadFolders();",
    "loadChatRooms();"
)

# 4. Remove redundant and undefined exports at the bottom
content = content.replace(
    "window.loadChatRooms = loadChatRooms;\n    window.loadFolders = loadFolders;\n    window.renderChatRooms = renderChatRooms;\n",
    ""
)

content = content.replace(
    "window.selectChatRoom = selectChatRoom;\n    // [FIX-06] Alias: selectChatRoom renders new #chat-input with inline onclick=\"window.sendChatMessage()\"\n    window.sendChatMessage = sendChatMsg;",
    "// [FIX-06] Removed undefined exports"
)

# 5. Fix standalone logic below bootSystem (around line 430)
content = content.replace(
    "if (new URLSearchParams(window.location.search).get('app') === 'skufenger') {",
    "const stParam = new URLSearchParams(window.location.search).get('app');\n    if (stParam === 'skufenger' || stParam === 'messenger') {"
)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")
