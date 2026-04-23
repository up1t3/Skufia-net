import sys

with open("index.html", "r", encoding="utf-8") as f:
    content = f.read()

# Split the content
head_end = content.find("</head>")
body_start = content.find("<body")

# Extract Modals
auth_overlay_start = content.find("<!-- Auth Overlay -->")
global_alert_start = content.find("<div id=\"global-alert-banner\"")
modals = content[auth_overlay_start:global_alert_start]

# Extract #view-messages
view_messages_start = content.find("<!-- SKUFenger VIEW (Skufia-Net) -->")
view_messages_end = content.find("</main>", view_messages_start)
view_messages = content[view_messages_start:view_messages_end]

# Extract scripts
scripts_start = content.find("<script defer src=\"https://unpkg.com/dexie/dist/dexie.js\">")
scripts_end = content.find("</body>")
scripts = content[scripts_start:scripts_end]

messenger_html = f'''<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>SKUFenger | Messenger</title>
    <link rel="icon" type="image/png" href="favicon.png">
    <link rel="stylesheet" href="style.css?v=43">
    <link rel="stylesheet" href="style-modal.css?v=43">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=JetBrains+Mono:wght@300;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="manifest" href="manifest-skufenger.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="SKUFenger">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#0a0e14" media="(prefers-color-scheme: dark)">
</head>
<body data-theme="telegram" class="skufenger-fullscreen">
    <div class="crt-overlay"></div>
    <div class="scanline"></div>

{modals}
    <div id="global-alert-banner" class="hidden"></div>
    <div class="app-container">
        <main class="viewport" id="viewport">
{view_messages}
        </main>
    </div>

{scripts}
</body>
</html>'''

# Replace app.js with messenger_app.js
messenger_html = messenger_html.replace('src="app.js?v=49"', 'src="messenger_app.js?v=49"')

# Make sure #view-messages has class "view active"
messenger_html = messenger_html.replace('<div class="view" id="view-messages">', '<div class="view active" id="view-messages">')

with open("messenger.html", "w", encoding="utf-8") as f:
    f.write(messenger_html)

print("messenger.html created successfully.")
