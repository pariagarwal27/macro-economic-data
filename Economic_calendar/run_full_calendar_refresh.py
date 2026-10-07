import os
import subprocess
import sys
import sqlite3
from datetime import datetime, timezone


FETCHER_SCRIPTS = [
    "fetch_bea_calendar.py",
    "fetch_boe_calendar.py",
    "fetch_census_retail_calendar.py",
    "fetch_ecb_calendar.py",
    "fetch_eurostat_calendar.py",
    "fetch_fred_calendar.py",
    "fetch_nyfed_sce_philly_spf_calendar.py",
    "fetch_ons_calendar.py",
    "fetch_special_us_macro_calendar_v2.py",
    "fetch_pmi_calendar.py",
]

MERGE_SCRIPT = "merge_all_calendars.py"
LOAD_SCRIPT = os.path.join("db", "load_calendar_to_db.py")
DB_PATH = os.environ.get("CALENDAR_DB_PATH", "economic_calendar.db")


def run_script(script):
    start = datetime.now()

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    result = subprocess.run(
        [sys.executable, script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,
        env=env,
    )

    seconds = (datetime.now() - start).total_seconds()
    ok = result.returncode == 0
    err = result.stderr[-2000:] if not ok else ""

    return ok, seconds, err


def log_run(summary):
    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS refresh_log (
            run_time TEXT,
            script TEXT,
            ok INTEGER,
            seconds REAL,
            error TEXT
        )
    """)

    conn.executemany(
        "INSERT INTO refresh_log VALUES (?, ?, ?, ?, ?)",
        summary,
    )

    conn.commit()
    conn.close()


def verify_critical_calendar_rows():
    """Fail the refresh if the two weekly DOL claims schedules disappeared."""
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT metric_id, next_release_date, next_release_at FROM calendar WHERE metric_id IN (?, ?)",
            ("us-initial-claims", "us-continuing-claims"),
        ).fetchall()
    finally:
        conn.close()

    found = {row[0]: row for row in rows}
    required = ("us-initial-claims", "us-continuing-claims")
    missing = [rid for rid in required if rid not in found]
    if missing:
        raise RuntimeError(
            "Calendar refresh completed but required catalog release rows are missing: "
            + ", ".join(missing)
        )

    for rid in required:
        if not found[rid][1]:
            raise RuntimeError(f"Calendar row {rid} has no next_release_date")
        if not found[rid][2]:
            raise RuntimeError(f"Calendar row {rid} has no next_release_at")

    print("[VERIFY] DOL claims schedules present: us-initial-claims, us-continuing-claims")


def verify_critical_calendar_rows():
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT metric_id, next_release_date, next_release_at FROM calendar WHERE metric_id IN (?, ?)",
            ("us-initial-claims", "us-continuing-claims"),
        ).fetchall()
    finally:
        conn.close()
    found = {row[0]: row for row in rows}
    required = ("us-initial-claims", "us-continuing-claims")
    missing = [rid for rid in required if rid not in found]
    if missing:
        raise RuntimeError("Missing canonical DOL claims calendar rows: " + ", ".join(missing))
    for rid in required:
        if not found[rid][1] or not found[rid][2]:
            raise RuntimeError(f"Incomplete DOL claims calendar row: {rid}")
    print("[VERIFY] DOL claims schedules present with date and time.")


def main():
    run_time = datetime.now(timezone.utc).isoformat()
    summary = []
    failed = []

    print("\n=== FETCHERS ===\n")

    for script in FETCHER_SCRIPTS:

        try:
            ok, secs, err = run_script(script)

        except subprocess.TimeoutExpired:
            ok = False
            secs = 600
            err = "Timed out after 600 seconds"

        except Exception as exc:
            ok = False
            secs = 0
            err = str(exc)

        summary.append(
            (
                run_time,
                script,
                int(ok),
                secs,
                err,
            )
        )

        print(
            f"[{'OK' if ok else 'FAILED'}] "
            f"{script} ({secs:.1f}s)"
        )

        if not ok:
            failed.append(script)

            if err:
                print(err)

    # Do not merge partial/stale results.
    if failed:
        print("\n=== REFRESH STOPPED ===")
        print("Failed fetchers:")

        for script in failed:
            print(f"  - {script}")

        print("\nMerge and database load were skipped.")

        try:
            log_run(summary)
        except Exception as exc:
            print(f"Could not write refresh log: {exc}")

        return 1

    print("\n=== MERGE ===\n")

    try:
        ok, secs, err = run_script(MERGE_SCRIPT)

    except subprocess.TimeoutExpired:
        ok = False
        secs = 600
        err = "Timed out after 600 seconds"

    except Exception as exc:
        ok = False
        secs = 0
        err = str(exc)

    summary.append(
        (
            run_time,
            MERGE_SCRIPT,
            int(ok),
            secs,
            err,
        )
    )

    print(
        f"[{'OK' if ok else 'FAILED'}] "
        f"{MERGE_SCRIPT} ({secs:.1f}s)"
    )

    if not ok:
        if err:
            print(err)

        log_run(summary)
        return 1

    print("\n=== DATABASE LOAD ===\n")

    try:
        ok, secs, err = run_script(LOAD_SCRIPT)

    except subprocess.TimeoutExpired:
        ok = False
        secs = 600
        err = "Timed out after 600 seconds"

    except Exception as exc:
        ok = False
        secs = 0
        err = str(exc)

    summary.append(
        (
            run_time,
            LOAD_SCRIPT,
            int(ok),
            secs,
            err,
        )
    )

    print(
        f"[{'OK' if ok else 'FAILED'}] "
        f"{LOAD_SCRIPT} ({secs:.1f}s)"
    )

    if not ok:
        if err:
            print(err)

        log_run(summary)
        return 1

    try:
        verify_critical_calendar_rows()
    except Exception as exc:
        print("\n=== CALENDAR VERIFICATION FAILED ===")
        print(str(exc))
        summary.append((run_time, "verify_critical_calendar_rows", 0, 0, str(exc)))
        log_run(summary)
        return 1

    summary.append((run_time, "verify_critical_calendar_rows", 1, 0, ""))
    log_run(summary)

    print("\n=== REFRESH COMPLETE ===")
    print("All fetchers succeeded.")
    print("Merge succeeded.")
    print("Database load succeeded.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
