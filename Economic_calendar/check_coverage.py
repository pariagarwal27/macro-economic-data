import re
import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_FILE = BASE_DIR / "economic_calendar.db"
CATALOG_FILE = BASE_DIR.parent / "src" / "catalog" / "metrics.ts"


def load_catalog_ids():
    text = CATALOG_FILE.read_text(encoding="utf-8")
    start = text.find("export const METRICS")
    if start < 0:
        raise RuntimeError("METRICS export not found.")

    array_start = text.find("[", start)
    array_end = text.find("];", array_start)
    if array_start < 0 or array_end < 0:
        raise RuntimeError("METRICS array bounds not found.")

    body = text[array_start + 1 : array_end]

    ids = []
    depth = 0
    obj_start = None
    in_string = False
    escaped = False

    for i, ch in enumerate(body):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start is not None:
                obj = body[obj_start : i + 1]
                m = re.search(r'\bid:\s*"([^"]+)"', obj)
                if m:
                    ids.append(m.group(1))
                obj_start = None

    return set(ids)


def main():
    catalog_ids = load_catalog_ids()

    conn = sqlite3.connect(DB_FILE)
    rows = conn.execute(
        """
        SELECT metric_id, source, next_release_date,
               next_release_at, status
        FROM calendar
        """
    ).fetchall()
    conn.close()

    db = {row[0]: row for row in rows}
    db_ids = set(db)

    missing = sorted(catalog_ids - db_ids)
    extra = sorted(db_ids - catalog_ids)

    with_date = sum(
        bool(row[2] and str(row[2]).strip())
        for row in rows
    )
    with_time = sum(
        bool(row[3] and str(row[3]).strip())
        for row in rows
    )

    print("=== CATALOG CALENDAR COVERAGE ===")
    print(f"Catalog metrics : {len(catalog_ids)}")
    print(f"DB metrics      : {len(db_ids)}")
    print(f"Missing IDs     : {len(missing)}")
    print(f"Extra IDs       : {len(extra)}")
    print(f"With date       : {with_date}")
    print(f"With time       : {with_time}")

    if missing:
        print("\nMISSING:")
        for metric_id in missing:
            print(f"  {metric_id}")

    if extra:
        print("\nEXTRA:")
        for metric_id in extra:
            print(f"  {metric_id}")

    if missing or extra:
        raise SystemExit(1)

    print("\nCatalog and calendar IDs are fully aligned.")


if __name__ == "__main__":
    main()
