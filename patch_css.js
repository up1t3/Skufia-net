const fs=require('fs');
let css=fs.readFileSync('frontend/style.css','utf8');
css=css.replace('border-radius: 2px var(--chat-bubble-radius) var(--chat-bubble-radius) var(--chat-bubble-radius);', 'border-radius: var(--chat-bubble-radius) var(--chat-bubble-radius) var(--chat-bubble-radius) 4px;');
css=css.replace('border-radius: var(--chat-bubble-radius) 2px var(--chat-bubble-radius) var(--chat-bubble-radius);', 'border-radius: var(--chat-bubble-radius) var(--chat-bubble-radius) 4px var(--chat-bubble-radius);');
const insertCss = `
/* Special bubbles without padding */
.msg-bubble-audio {
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

.msg-bubble-image {
    padding: 0 !important;
    overflow: hidden;
}
.msg-bubble-image .msg-image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: inherit;
    max-width: 300px;
}
`;
css=css.replace('[data-theme="neon"] .msg-sent {', insertCss + '[data-theme="neon"] .msg-sent {');
fs.writeFileSync('frontend/style.css', css);
