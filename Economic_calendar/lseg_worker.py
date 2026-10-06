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
PORT = int(os.getenv("LSEG_PORT", "8787"))

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

    # For economic RICs, get_data exposes the current actual value and
    # observation period. We prefer those real-time fields. If unavailable,
    # fall back to get_history and use its newest numeric observation.
    try:
        df = ld.get_data(
            universe=[ric],
            fields=[
                "CF_DATE",
                "ACT_END_DT",
                "ACT_VAL_NS",
                "REF_PRD",
                "ECON_ACT",
            ],
        )

        if df is not None and not df.empty:
            row = df.iloc[0]
            value = row.get("ACT_VAL_NS")
            period = row.get("ACT_END_DT") or row.get("REF_PRD")
            release = row.get("CF_DATE")

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

    # Fallback: latest time-series observation. LSEG notes that get_history
    # is the supported historical-timeseries access layer.
    df = ld.get_history(
        universe=[ric],
        start="-120D",
        end="0D",
        interval="1d",
    )
    if df is None or df.empty:
        return None

    numeric = list(_numeric_columns(df))
    if not numeric:
        return None

    value_col, values = numeric[0]
    row = df.iloc[-1]
    value = values.iloc[-1]
    if value is None or not math.isfinite(float(value)):
        return None

    idx = df.index[-1]
    period_date = normalize_period(str(idx))
    if not period_date:
        for col in df.columns:
            if "date" in str(col).lower():
                period_date = normalize_period(str(row[col]))
                if period_date:
                    break

    if not period_date:
        return None

    return {
        "periodDate": period_date,
        "value": float(value),
        "rawValue": str(value),
        "releasedAt": datetime.now(timezone.utc).isoformat(),
    }


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
        if parsed.path != "/latest":
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        ric = parse_qs(parsed.query).get("ric", [""])[0]
        ric = unquote(ric).strip()
        if not ric:
            self.send_json(400, {"ok": False, "error": "Missing ric"})
            return

        try:
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
