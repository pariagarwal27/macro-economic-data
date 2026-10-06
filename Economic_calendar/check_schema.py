import sqlite3

c = sqlite3.connect("economic_calendar.db")

rows = c.execute("PRAGMA table_info(calendar)").fetchall()

for row in rows:
    print(row)

c.close()
