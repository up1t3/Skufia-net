import sqlite3

try:
    conn = sqlite3.connect('test_skufia.db')
    cur = conn.cursor()
    cur.execute('SELECT id, name, avatar_url FROM chat_rooms;')
    for row in cur.fetchall():
        print(row)
except Exception as e:
    print("Error:", e)
