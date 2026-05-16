import os
import re

for root, dirs, files in os.walk('e:/Skufia-net'):
    dirs[:] = [d for d in dirs if d not in ('.venv', 'node_modules', '.git', 'dist', 'build', '__pycache__')]
    for file in files:
        if file.endswith('.py'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            if 'lambda: datetime.now(timezone.utc)' in content:
                # Add timezone to imports if missing
                if 'from datetime import' in content and 'timezone' not in content:
                    content = re.sub(r'(from datetime import.*?)\n', r'\1, timezone\n', content, count=1)
                
                # Replace datetime.now(timezone.utc)
                content = content.replace('datetime.now(timezone.utc)', 'datetime.now(timezone.utc)')
                # Replace lambda: datetime.now(timezone.utc) (for sqlalchemy defaults)
                content = content.replace('lambda: datetime.now(timezone.utc)', 'lambda: datetime.now(timezone.utc)')
                
                # For cases where import datetime is used directly
                if 'import datetime' in content and 'from datetime import' not in content:
                    content = content.replace('datetime.now(timezone.utc)', 'datetime.datetime.now(datetime.timezone.utc)')
                    content = content.replace('lambda: datetime.now(timezone.utc)', 'lambda: datetime.datetime.now(datetime.timezone.utc)')

                with open(path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Patched {path}")
