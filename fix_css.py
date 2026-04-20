import sys

with open('frontend/style.css', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix zigzag
content = content.replace('''#chat-input {
    flex-grow: 1;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-family: var(--font-main);
    font-size: 14px;
    padding: 8px 4px;
    outline: none;
    resize: none;
    overflow-y: auto;
    max-height: 120px;
    min-height: 38px;
    line-height: 1.4;
    align-self: center;
}''', '''#chat-input {
    flex-grow: 1;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-family: var(--font-main);
    font-size: 14px;
    padding: 8px 4px;
    outline: none;
    resize: none;
    overflow-y: auto;
    max-height: 120px;
    min-height: 36px;
    line-height: 1.4;
    align-self: flex-end;
}''')

# Fix sidebar header
content = content.replace('''.sidebar-header {
    padding: 16px;
    background: rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid var(--border-metal);
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 70px;
    box-sizing: border-box;
    flex-shrink: 0;
}''', '''.sidebar-header {
    padding: 16px;
    background: transparent;
    border-top: none;
    border-bottom: 1px solid var(--border-metal);
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 70px;
    box-sizing: border-box;
    flex-shrink: 0;
}''')

with open('frontend/style.css', 'w', encoding='utf-8') as f:
    f.write(content)

print("CSS fixed.")
