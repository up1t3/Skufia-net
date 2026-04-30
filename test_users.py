import sqlite3

conn = sqlite3.connect('skufia.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT * FROM users")
users = cur.fetchall()
for d in users:
    print(f"User {d['id']}: {d['username']} (public_key: {bool(d['public_key'])})")
