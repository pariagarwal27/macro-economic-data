import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


DB_PATH = Path(os.environ.get("CALENDAR_DB_PATH", "economic_calendar.db"))
INPUT_FILE = Path("all_calendar_results.json")
TABLE_NAME = "calendar"

CANONICAL_ID_ALIASES = {
    "us-initial-jobless-claims": "us-initial-claims",
    "us-continuing-jobless-claims": "us-continuing-claims",
    "us-adp-employment-change": "us-adp-change",
    "us-adp-employment-level": "us-adp-level",
    "us-atlanta-core-sticky-cpi": "us-core-sticky-cpi",
    "us-atlanta-flexible-cpi": "us-flexible-cpi",
    "us-atlanta-sticky-cpi": "us-sticky-cpi",
    "us-atlanta-wage-growth": "us-atlanta-wage",
    "us-breakeven-5y5y": "us-5y5y-forward",
    "us-chicago-cfnai": "us-cfnai",
    "us-dallas-business-activity": "us-dallas-fed-activity",
    "us-gdpnow": "us-gdp-now",
    "de-unemployment-rate": "de-unemployment",
    "uk-oecd-cli": "uk-cli",
    **{f"us-cleveland-inflation-exp-{horizon}": f"us-cleveland-exp-inf-{horizon}" for horizon in ("1y", "2y", "3y", "5y", "5-10y", "10y", "30y")},
}

def canonical_metric_id(value):
    if value is None:
        return None
    value = str(value).strip()
    return CANONICAL_ID_ALIASES.get(value, value) or None



CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    metric_id TEXT PRIMARY KEY,
    metric TEXT,
    source TEXT,
    family TEXT,
    next_release_date TEXT,
    next_release_at TEXT,
    status TEXT,
    official_source TEXT,
    official_evidence TEXT,
    updated_at TEXT
)
"""


def load_payload():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Missing {INPUT_FILE}"
        )

    with INPUT_FILE.open(
        "r",
        encoding="utf-8",
    ) as f:
        payload = json.load(f)

    metrics = payload.get("metrics")

    if not isinstance(metrics, list):
        raise ValueError(
            "all_calendar_results.json does not contain "
            "a top-level 'metrics' list."
        )

    return payload, metrics


def ensure_table(conn):
    conn.execute(CREATE_TABLE_SQL)

    # Add missing columns if an older calendar table exists.
    existing = {
        row[1]
        for row in conn.execute(
            f"PRAGMA table_info({TABLE_NAME})"
        ).fetchall()
    }

    required = {
        "metric": "TEXT",
        "source": "TEXT",
        "family": "TEXT",
        "next_release_date": "TEXT",
        "next_release_at": "TEXT",
        "status": "TEXT",
        "official_source": "TEXT",
        "official_evidence": "TEXT",
        "updated_at": "TEXT",
        "release_deadline_at": "TEXT",
        "release_time_kind": "TEXT",
    }

    for column, sql_type in required.items():
        if column not in existing:
            conn.execute(
                f"ALTER TABLE {TABLE_NAME} "
                f"ADD COLUMN {column} {sql_type}"
            )


def archive_calendar(conn):
    """Keep scheduled events when the next-release snapshot rolls forward."""
    conn.execute("CREATE TABLE IF NOT EXISTS calendar_history AS SELECT *, COALESCE(next_release_at,next_release_date) AS scheduled_key FROM calendar WHERE 0")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS calendar_history_event ON calendar_history(metric_id,scheduled_key)")
    conn.execute("INSERT OR REPLACE INTO calendar_history SELECT *, COALESCE(next_release_at,next_release_date) FROM calendar WHERE next_release_date IS NOT NULL AND (status != 'daily_series' OR status IS NULL)")


def retain_confirmed_schedule(incoming, prior):
    if incoming.get("status") != "source_error" or not prior.get("next_release_date"):
        return incoming
    retained = dict(incoming)
    for key in ("next_release_date", "next_release_at", "release_deadline_at", "release_time_kind", "official_source", "updated_at"):
        retained[key] = prior.get(key)
    retained["official_evidence"] = "Latest provider fetch failed; retaining the last confirmed schedule. " + (prior.get("official_evidence") or "")
    return retained


def normalize(record):
    return {
        "metric_id": canonical_metric_id(record.get("metric_id")),
        "metric": record.get("metric"),
        "source": record.get("source"),
        "family": record.get("family"),

        # all_calendar_results.json uses "next_release"
        "next_release_date": (
            record.get("next_release")
            or record.get("next_release_date")
        ),

        "next_release_at": (
            record.get("next_release_at")
            or record.get("release_datetime")
            or record.get("release_date_time")
            or record.get("release_at")
            or record.get("scheduled_at")
        ),

        "status": (
            record.get("release_status")
            or record.get("status")
        ),

        "official_source": record.get(
            "official_source"
        ),

        "official_evidence": record.get(
            "official_evidence"
        ),
        "release_deadline_at": record.get("release_deadline_at"),
        "release_time_kind": record.get("release_time_kind"),

        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }


def main():

    payload, metrics = load_payload()

    valid = []
    skipped = []

    for record in metrics:

        if not isinstance(record, dict):
            skipped.append(record)
            continue

        item = normalize(record)

        if not item["metric_id"]:
            skipped.append(record)
            continue

        valid.append(item)

    if not valid:
        raise RuntimeError(
            "No valid metric records found."
        )

    conn = sqlite3.connect(DB_PATH)

    try:
        ensure_table(conn)
        archive_calendar(conn)

        # Build the new snapshot, but first retain any existing scheduled row
        # that is absent from the current fetch output. This prevents a stale
        # or partially populated provider JSON file from deleting a previously
        # known release schedule. Legacy/provider IDs are canonicalized before
        # they are retained.
        catalog_path = Path("catalog_metrics.json")
        catalog_ids = {item["id"] for item in json.loads(catalog_path.read_text(encoding="utf-8"))["metrics"]} if catalog_path.exists() else None
        existing_rows = {}
        for row in conn.execute(f"SELECT metric_id, metric, source, family, next_release_date, next_release_at, status, official_source, official_evidence, updated_at, release_deadline_at, release_time_kind FROM {TABLE_NAME}").fetchall():
            rid = canonical_metric_id(row[0])
            if rid and rid not in existing_rows and (catalog_ids is None or rid in catalog_ids):
                existing_rows[rid] = row

        incoming = {}
        for item in valid:
            rid = canonical_metric_id(item["metric_id"])
            if rid:
                item = dict(item)
                item["metric_id"] = rid
                incoming[rid] = item

        for rid, row in existing_rows.items():
            if rid in incoming:
                incoming[rid] = retain_confirmed_schedule(incoming[rid], {
                    "next_release_date":row[4], "next_release_at":row[5],
                    "official_source":row[7], "official_evidence":row[8], "updated_at":row[9],
                    "release_deadline_at":row[10], "release_time_kind":row[11],
                })
            if rid not in incoming:
                incoming[rid] = {
                    "metric_id": rid,
                    "metric": row[1],
                    "source": row[2],
                    "family": row[3],
                    "next_release_date": row[4],
                    "next_release_at": row[5],
                    "status": row[6],
                    "official_source": row[7],
                    "official_evidence": row[8],
                    "updated_at": row[9],
                    "release_deadline_at": row[10],
                    "release_time_kind": row[11],
                }

        valid = list(incoming.values())
        conn.execute(f"DELETE FROM {TABLE_NAME}")

        inserted = 0
        updated = 0
        unchanged = 0

        for item in valid:

            existing = conn.execute(
                f"""
                SELECT metric, source, family,
                       next_release_date, next_release_at, status,
                       official_source,
                       official_evidence, release_deadline_at, release_time_kind
                FROM {TABLE_NAME}
                WHERE metric_id = ?
                """,
                (item["metric_id"],),
            ).fetchone()

            values = (
                item["metric"],
                item["source"],
                item["family"],
                item["next_release_date"],
                item["next_release_at"],
                item["status"],
                item["official_source"],
                item["official_evidence"],
                item["release_deadline_at"],
                item["release_time_kind"],
            )

            if existing is None:

                conn.execute(
                    f"""
                    INSERT INTO {TABLE_NAME} (
                        metric_id,
                        metric,
                        source,
                        family,
                        next_release_date,
                        next_release_at,
                        status,
                        official_source,
                        official_evidence,
                        release_deadline_at,
                        release_time_kind,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["metric_id"],
                        *values,
                        item["updated_at"],
                    ),
                )

                inserted += 1

            else:

                old = tuple(existing)

                if old == values:
                    unchanged += 1
                    continue

                conn.execute(
                    f"""
                    UPDATE {TABLE_NAME}
                    SET metric = ?,
                        source = ?,
                        family = ?,
                        next_release_date = ?,
                        next_release_at = ?,
                        status = ?,
                        official_source = ?,
                        official_evidence = ?,
                        release_deadline_at = ?,
                        release_time_kind = ?,
                        updated_at = ?
                    WHERE metric_id = ?
                    """,
                    (
                        *values,
                        item["updated_at"],
                        item["metric_id"],
                    ),
                )

                updated += 1

        conn.commit()

        total = conn.execute(
            f"SELECT COUNT(*) FROM {TABLE_NAME}"
        ).fetchone()[0]

        with_date = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM {TABLE_NAME}
            WHERE next_release_date IS NOT NULL
              AND TRIM(next_release_date) != ''
            """
        ).fetchone()[0]

        without_date = total - with_date

        with_time = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM {TABLE_NAME}
            WHERE next_release_at IS NOT NULL
              AND TRIM(next_release_at) != ''
            """
        ).fetchone()[0]

        without_time = total - with_time

        print("\n=== DATABASE LOAD ===")
        print(f"Metrics in merged file : {len(metrics)}")
        print(f"Valid metrics          : {len(valid)}")
        print(f"Skipped                : {len(skipped)}")
        print(f"Inserted               : {inserted}")
        print(f"Updated                : {updated}")
        print(f"Unchanged              : {unchanged}")
        print(f"Total in database      : {total}")
        print(f"With release date      : {with_date}")
        print(f"Without release date   : {without_date}")
        print(f"With release time      : {with_time}")
        print(f"Without release time   : {without_time}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
