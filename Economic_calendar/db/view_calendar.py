import sqlite3
from pathlib import Path


DB_PATH = Path("economic_calendar.db")


def main():
    conn = sqlite3.connect(DB_PATH)

    try:
        rows = conn.execute("""
            SELECT
                metric_id,
                source,
                next_release_date,
                next_release_at,
                status
            FROM calendar
            ORDER BY
                CASE
                    WHEN next_release_date IS NULL OR TRIM(next_release_date) = ''
                    THEN 1
                    ELSE 0
                END,
                next_release_date ASC,
                metric_id ASC
            LIMIT 20
        """).fetchall()

        print("Showing first 20 rows:")
        print()

        for row in rows:
            print(row)

        total = conn.execute(
            "SELECT COUNT(*) FROM calendar"
        ).fetchone()[0]

        with_date = conn.execute("""
            SELECT COUNT(*)
            FROM calendar
            WHERE next_release_date IS NOT NULL
              AND TRIM(next_release_date) <> ''
        """).fetchone()[0]

        with_time = conn.execute("""
            SELECT COUNT(*)
            FROM calendar
            WHERE next_release_at IS NOT NULL
              AND TRIM(next_release_at) <> ''
        """).fetchone()[0]

        print()
        print(f"Total rows: {total}")
        print(f"Rows with release date: {with_date}")
        print(f"Rows with release time: {with_time}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()