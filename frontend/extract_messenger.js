const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf-8');

const headEnd = content.indexOf('</head>');
const bodyStart = content.indexOf('<body');

const authOverlayStart = content.indexOf('<!-- Auth Overlay -->');
const globalAlertStart = content.indexOf('<div id="global-alert-banner"');
const modals = content.substring(authOverlayStart, globalAlertStart);

const viewMessagesStart = content.indexOf('<!-- SKUFenger VIEW (Skufia-Net) -->');
const viewMessagesEnd = content.indexOf('</main>', viewMessagesStart);
const viewMessages = content.substring(viewMessagesStart, viewMessagesEnd);

const scriptsStart = content.indexOf('<script defer src="https://unpkg.com/dexie/dist/dexie.js">');
const scriptsEnd = content.indexOf('</body>');
const scripts = content.substring(scriptsStart, scriptsEnd);

let messengerHtml = `<!DOCTYPE html>
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

${modals}
    <div id="global-alert-banner" class="hidden"></div>
    <div class="app-container">
        <main class="viewport" id="viewport">
${viewMessages}
        </main>
    </div>

${scripts}
</body>
</html>`;

messengerHtml = messengerHtml.replace('src="app.js?v=49"', 'src="messenger_app.js?v=49"');
messengerHtml = messengerHtml.replace('<div class="view" id="view-messages">', '<div class="view active" id="view-messages">');

fs.writeFileSync('messenger.html', messengerHtml, 'utf-8');
console.log('messenger.html created successfully.');
