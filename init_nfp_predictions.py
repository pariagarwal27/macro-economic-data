"""Utility to ensure the `nfp_predictions` table exists in the investing_db SQLite database.

Run this once (or as part of your deployment pipeline) before scheduling the forecast job.
"""
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
DB_PATH = PROJECT_ROOT / "investing_db" / "investing_economic_calendar.db"

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS nfp_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_month TEXT NOT NULL,      -- e.g., "2024-09"
    forecast_date TEXT NOT NULL,     -- ISO‑8601 timestamp of the run
    model_name TEXT NOT NULL,
    predicted_nfp REAL NOT NULL,    -- thousands of jobs
    consensus_nfp REAL,              -- optional market consensus
    implied_surprise REAL,           -- predicted_nfp - consensus_nfp
    bias_label TEXT,                 -- "Bullish", "Neutral", "Bearish"
    UNIQUE(target_month)
);
"""

def ensure_table():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(CREATE_TABLE_SQL)
        conn.commit()
        print(f"`nfp_predictions` table ensured in {DB_PATH}")
    finally:
        conn.close()

if __name__ == "__main__":
    ensure_table()
