import sqlite3
from pathlib import Path

DB = Path("economic_calendar.db")
REQUIRED = {
    "us-initial-claims": "Initial Jobless Claims",
    "us-continuing-claims": "Continuing Jobless Claims",
}

conn = sqlite3.connect(DB)
try:
    rows = conn.execute("SELECT metric_id, metric, next_release_date, next_release_at FROM calendar").fetchall()
finally:
    conn.close()
by_id = {r[0]: r for r in rows}
print(f"Calendar rows: {len(rows)}")
missing = [k for k in REQUIRED if k not in by_id]
if missing:
    raise SystemExit("MISSING: " + ", ".join(missing))
for k, name in REQUIRED.items():
    print(k, "=>", by_id[k][1], by_id[k][2], by_id[k][3])
print("OK: both DOL claims release schedules are present under canonical catalog IDs.")
