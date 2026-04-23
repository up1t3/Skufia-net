import re
import os

source_file = r'e:\AgentZero\usr\projects\skufia\backend\routes.py'
dest_dir = r'e:\AgentZero\usr\projects\skufia\backend\routers'

if not os.path.exists(dest_dir):
    os.makedirs(dest_dir)

with open(source_file, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Extract imports and shared definitions (up to # --- AUTH ROUTES (Existing) ---)
header_end = content.find('# --- AUTH ROUTES (Existing) ---')
header = content[:header_end]

# Modify header to use relative imports if needed, but since it's in a subdirectory, 
# we need to adjust imports like `from database import` to `from database import` (if sys.path is correct)
# Actually, if we use `from database import`, Python in FastAPI usually runs from backend dir, so it should work.

# Let's extract modules based on headers.
modules = [
    ('wiki', '# --- WIKI MODULE ---', '# --- FORUM MODULE ---'),
    ('forum', '# --- FORUM MODULE ---', '# --- REGISTRY MODULE ---'),
    ('registry', '# --- REGISTRY MODULE ---', '# --- CHAT MODULE ---'),
    ('chat', '# --- CHAT MODULE ---', '# --- GLOBAL NOTIFICATIONS MODULE ---'),
    ('notifications', '# --- GLOBAL NOTIFICATIONS MODULE ---', '# --- MARKET MODULE ---'),
    ('market', '# --- MARKET MODULE ---', '# --- EVENTS MODULE ---'),
    ('events', '# --- EVENTS MODULE ---', '# --- PRIVATE CHAT MODULE ---'),
    # Note: PRIVATE CHAT, MESSENGER GROUP, INVITE SYSTEM are all chat related.
    ('chat_part2', '# --- PRIVATE CHAT MODULE ---', None)
]

for mod_name, start_marker, end_marker in modules:
    start_idx = content.find(start_marker)
    if start_idx == -1:
        print(f"Skipping {mod_name}, marker not found")
        continue
    
    end_idx = content.find(end_marker) if end_marker else len(content)
    if end_idx == -1: end_idx = len(content)
    
    mod_content = content[start_idx:end_idx]
    
    # We will combine chat parts
    filename = os.path.join(dest_dir, f"{mod_name.replace('_part2', '')}.py")
    
    # Write header if new file
    if not os.path.exists(filename):
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(header + "\n\n")
    
    with open(filename, 'a', encoding='utf-8') as f:
        f.write(mod_content + "\n")

print("Files generated in routers/")
