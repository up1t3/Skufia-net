import requests

BASE_URL = "http://localhost:8007"
TOKEN = "DEV_TOKEN_ADMIN_ACCESS"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

print("1. Getting current profile...")
resp = requests.get(f"{BASE_URL}/me", headers=HEADERS)
print(resp.json())

print("2. Changing nickname...")
resp2 = requests.post(f"{BASE_URL}/me/update", json={"username": "NewSkuf_Admin", "bio": "Updated Bio!"}, headers=HEADERS)
print(resp2.status_code, resp2.text)

print("3. Verifying profile...")
resp3 = requests.get(f"{BASE_URL}/me", headers=HEADERS)
print(resp3.json())

# Cleanup: change it back
requests.post(f"{BASE_URL}/me/update", json={"username": "Скуф_Админ", "bio": ""}, headers=HEADERS)
