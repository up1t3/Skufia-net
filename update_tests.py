import re
import uuid

with open('tests/backend/integration/test_chat_api.py', 'r', encoding='utf-8') as f:
    content = f.read()

if 'import uuid' not in content:
    content = 'import uuid\n' + content

content = re.sub(r'headers\["X-Idempotency-Key"\]\s*=\s*f?"[^"]+"', 'headers["X-Idempotency-Key"] = uuid.uuid4().hex', content)

with open('tests/backend/integration/test_chat_api.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated file successfully')
