import sqlite3

conn = sqlite3.connect('skufia.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT id, username FROM users")
users = cur.fetchall()
for d in users:
    print(f"User: {d['id']}, {d['username']}")
