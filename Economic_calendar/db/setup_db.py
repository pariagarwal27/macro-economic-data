import sqlite3


def setup_database(db_path="economic_calendar.db"):
    conn = sqlite3.connect(db_path)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS calendar (
            metric_id TEXT PRIMARY KEY,
            source TEXT,
            title TEXT,
            next_release TEXT,
            date_confirmed BOOLEAN,
            latest_value TEXT,
            last_checked TEXT,
            last_changed TEXT,
            metric TEXT,
            family TEXT,
            next_release_date TEXT,
            next_release_at TEXT,
            status TEXT,
            official_source TEXT,
            official_evidence TEXT,
            updated_at TEXT
        )
    """)

    existing = {
        row[1]
        for row in conn.execute(
            "PRAGMA table_info(calendar)"
        ).fetchall()
    }

    required = {
        "next_release_at": "TEXT",
        "metric": "TEXT",
        "family": "TEXT",
        "next_release_date": "TEXT",
        "status": "TEXT",
        "official_source": "TEXT",
        "official_evidence": "TEXT",
        "updated_at": "TEXT",
    }

    for column, sql_type in required.items():
        if column not in existing:
            conn.execute(
                f"ALTER TABLE calendar ADD COLUMN {column} {sql_type}"
            )

    conn.execute("""
        CREATE TABLE IF NOT EXISTS refresh_log (
            run_time TEXT,
            script TEXT,
            ok INTEGER,
            seconds REAL,
            error TEXT
        )
    """)

    conn.commit()
    conn.close()
    print(f"Database ready at {db_path}")


if __name__ == "__main__":
    setup_database()
