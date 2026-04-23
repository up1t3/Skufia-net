
import os

path = r'e:\AgentZero\usr\projects\skufia\frontend\app.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Check for header and remove
if lines[0].startswith("Source:") and "---" in lines[2]:
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines[4:])
    print("SUCCESS: Header removed from app.js")
else:
    print("Header not found or already removed.")
