"""Local LSEG Workspace Desktop bridge for MacroHub.

Requires the LSEG Data Library for Python and LSEG Workspace Desktop on the
same Windows machine. LSEG's current Python library uses `import lseg.data as ld`
and `ld.open_session()` for a Desktop session. See the official LSEG quickstart.

Run:
    python Economic_calendar/lseg_worker.py

The Next.js release worker calls:
    GET http://127.0.0.1:8787/latest?ric=USCPNY%3DECI
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import lseg.data as ld

HOST = os.getenv("LSEG_HOST", "127.0.0.1")
PORT = int(os.getenv("LSEG_PORT", "8765"))

_session_open = False


def ensure_session():
    global _session_open
    if not _session_open:
        ld.open_session()
        _session_open = True


def _numeric_columns(df):
    for col in df.columns:
        if str(col).lower() in {"timestamp", "date", "time", "trade_date"}:
            continue
        try:
            series = df[col]
            numeric = series.astype(float)
            if numeric.notna().any():
                yield col, numeric
        except Exception:
            continue


def fetch_latest_from_lseg(ric: str):
    ensure_session()

    # LSEG's cross-economic-data field set defines ECON_ACT as the actual,
    # FCAST_PRD as the observation period, and ECI_ACT_DT as the GMT release
    # date. ACT_VAL_NS is the release time, so it must never be used as value.
    try:
        df = ld.get_data(
            universe=[ric],
            fields=[
                "ECI_ACT_DT",
                "FCAST_PRD",
                "ECON_ACT",
            ],
        )

        if df is not None and not df.empty:
            row = df.iloc[0]
            value = row.get("ECON_ACT")
            period = row.get("FCAST_PRD")
            release = row.get("ECI_ACT_DT")

            try:
                value = float(value)
            except Exception:
                value = None

            if value is not None and math.isfinite(value):
                period_text = str(period) if period is not None else ""
                release_text = str(release) if release is not None else ""
                period_date = normalize_period(period_text)
                if period_date:
                    return {
                        "periodDate": period_date,
                        "value": value,
                        "rawValue": str(value),
                        "releasedAt": normalize_timestamp(release_text),
                    }
    except Exception:
        pass

    # Fallback to the same explicitly named economic-actual field used for
    # history, never an arbitrary numeric column from the response.
    points = fetch_history_from_lseg(
        ric,
        "2020-01-01",
        datetime.now(timezone.utc).date().isoformat(),
    )
    if not points:
        return None
    latest = points[-1]
    return {
        "periodDate": latest["date"],
        "value": latest["value"],
        "rawValue": str(latest["value"]),
        "releasedAt": datetime.now(timezone.utc).isoformat(),
    }


def fetch_history_from_lseg(ric: str, start: str, end: str):
    ensure_session()
    # LSEG's history endpoint returns the economic series as Date/Value. ECI
    # history does not accept the snapshot field ECON_ACT in a fields list.
    df = ld.get_history(
        universe=[ric],
        start=start,
        end=end,
        interval="monthly",
    )
    if df is None or df.empty:
        return []

    numeric = list(_numeric_columns(df))
    if not numeric:
        return []
    value_col, values = next(
        ((col, values) for col, values in numeric if str(col).upper() == "VALUE"),
        numeric[0],
    )

    points = []
    for position, (idx, row) in enumerate(df.iterrows()):
        value = values.iloc[position]
        if value is None:
            continue
        if not math.isfinite(value) or value < 0 or value > 100:
            continue

        period = normalize_period(str(idx))
        if not period:
            for col in df.columns:
                if str(col).lower() in {"date", "timestamp", "time"}:
                    period = normalize_period(str(row[col]))
                    if period:
                        break
        if period:
            points.append({"date": period, "value": value})

    # Keep one published observation per period and return chronological data.
    by_period = {point["date"]: point for point in points}
    return [by_period[key] for key in sorted(by_period)]


def normalize_period(value: str):
    value = value.strip()
    if not value or value.lower() in {"nan", "nat", "none"}:
        return None

    # ISO/date-like values.
    if len(value) >= 10 and value[4] == "-" and value[7] == "-":
        return value[:10]

    # YYYYMMDD.
    if len(value) >= 8 and value[:8].isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"

    # Month/year strings used by economic series.
    for fmt in ("%b %Y", "%B %Y", "%Y-%m"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-01")
        except ValueError:
            pass

    return None


def normalize_timestamp(value: str):
    if not value or value.lower() in {"nan", "nat", "none"}:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[lseg-worker] {fmt % args}")

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/latest", "/history"}:
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        ric = parse_qs(parsed.query).get("ric", [""])[0]
        ric = unquote(ric).strip()
        if not ric:
            self.send_json(400, {"ok": False, "error": "Missing ric"})
            return

        try:
            if parsed.path == "/history":
                params = parse_qs(parsed.query)
                start = params.get("start", ["1990-01-01"])[0]
                end = params.get("end", [datetime.now(timezone.utc).date().isoformat()])[0]
                if not all(
                    len(value) == 10 and value[4] == "-" and value[7] == "-"
                    for value in (start, end)
                ):
                    self.send_json(400, {"ok": False, "error": "start and end must use YYYY-MM-DD"})
                    return
                observations = fetch_history_from_lseg(ric, start, end)
                self.send_json(200, {"ok": True, "observations": observations})
            else:
                result = fetch_latest_from_lseg(ric)
                if result is None:
                    self.send_json(200, {"ok": True, "available": False})
                else:
                    self.send_json(200, {"ok": True, **result})
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    ensure_session()
    print(f"[lseg-worker] listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
