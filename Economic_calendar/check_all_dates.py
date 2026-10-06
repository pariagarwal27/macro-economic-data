"""Validate the generated release-calendar SQLite snapshot."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime
from pathlib import Path

DB = Path("economic_calendar.db")


def main() -> int:
    if not DB.exists():
        print(f"Missing {DB}")
        return 1

    conn = sqlite3.connect(DB)
    try:
        rows = conn.execute(
            """
            SELECT metric_id, source, next_release_date,
                   next_release_at, status
            FROM calendar
            ORDER BY metric_id
            """
        ).fetchall()
    finally:
        conn.close()

    errors = []

    for metric_id, source, release_date, release_at, status in rows:
        if not metric_id:
            errors.append("calendar row has empty metric_id")
            continue

        if release_date:
            try:
                date.fromisoformat(str(release_date)[:10])
            except ValueError:
                errors.append(
                    f"{metric_id}: invalid next_release_date={release_date!r}"
                )

        if release_at:
            try:
                datetime.fromisoformat(str(release_at).replace("Z", "+00:00"))
            except ValueError:
                errors.append(
                    f"{metric_id}: invalid next_release_at={release_at!r}"
                )

    print(f"Calendar rows: {len(rows)}")
    print(f"Rows with date: {sum(bool(r[2]) for r in rows)}")
    print(f"Rows with exact time: {sum(bool(r[3]) for r in rows)}")

    if errors:
        print("\nCalendar validation errors:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print("Calendar schema/date validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
