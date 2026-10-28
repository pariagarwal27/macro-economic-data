# nfp_forecast_job.py
"""Nightly forecast job for Non‑Farm Payroll (NFP).

This script is intended to be run automatically (e.g., via Windows Task Scheduler) after the daily data ingestion pipeline has refreshed
the leading‑indicator tables in the `investing_db` SQLite database.

It performs the following steps:
1. Load the champion model (selected by `model_selector.pick_best_model`).
2. Obtain the latest feature vector for the upcoming month via `nfp_feature_engine.get_latest_features`.
3. Apply any required scalers (the models were saved with a `StandardScaler` using joblib).
4. Produce a point forecast for the NFP change (in thousands of jobs).
5. Insert the forecast into the `nfp_predictions` table for consumption by the Economic Dashboard.

The script logs progress and errors to standard output; you can redirect the output to a log file when scheduling.
"""

import sys
import logging
from pathlib import Path
import sqlite3
import datetime
import joblib

# Ensure the project root (where the investing_db lives) is on PYTHONPATH
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

# Import local modules
try:
    from nfp_feature_engine import get_latest_features, load_panel
    from model_selector import pick_best_model
except Exception as e:
    logging.error(f"Failed to import project modules: {e}")
    sys.exit(1)

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Path to the SQLite DB (same as used by ingestion scripts)
DB_PATH = PROJECT_ROOT / "investing_db" / "investing_economic_calendar.db"

def insert_prediction(
    conn: sqlite3.Connection,
    target_month: str,
    forecast_date: str,
    model_name: str,
    predicted_nfp: float,
    consensus_nfp: float | None = None,
    implied_surprise: float | None = None,
    bias_label: str | None = None,
):
    """Insert a row into `nfp_predictions`.

    The table schema (created manually or via migration) is expected to be:
    ```sql
    CREATE TABLE IF NOT EXISTS nfp_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_month TEXT NOT NULL,      -- e.g., "2024-09"
        forecast_date TEXT NOT NULL,     -- ISO‑8601 timestamp of the run
        model_name TEXT NOT NULL,
        predicted_nfp REAL NOT NULL,    -- thousands of jobs
        consensus_nfp REAL,               -- optional market consensus
        implied_surprise REAL,            -- predicted_nfp - consensus_nfp
        bias_label TEXT,                  -- e.g., "Bullish", "Neutral", "Bearish"
        UNIQUE(target_month)
    );
    ```
    """
    sql = """
        INSERT INTO nfp_predictions (
            target_month, forecast_date, model_name, predicted_nfp,
            consensus_nfp, implied_surprise, bias_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_month) DO UPDATE SET
            forecast_date=excluded.forecast_date,
            model_name=excluded.model_name,
            predicted_nfp=excluded.predicted_nfp,
            consensus_nfp=excluded.consensus_nfp,
            implied_surprise=excluded.implied_surprise,
            bias_label=excluded.bias_label;
    """
    conn.execute(
        sql,
        (
            target_month,
            forecast_date,
            model_name,
            predicted_nfp,
            consensus_nfp,
            implied_surprise,
            bias_label,
        ),
    )
    conn.commit()
    logging.info(f"Inserted/updated prediction for {target_month} (model={model_name})")


def main():
    logging.info("Starting NFP forecast job")

    # 1. Determine champion model path and human‑readable name
    try:
        model_path, model_name = pick_best_model()
        logging.info(f"Champion model: {model_name} ({model_path})")
    except Exception as e:
        logging.error(f"Model selection failed: {e}")
        sys.exit(1)

    # 2. Load the saved scaler + model (both were persisted via joblib in the same file)
    try:
        scaler, model = joblib.load(model_path)
    except Exception as e:
        logging.error(f"Failed to load model from {model_path}: {e}")
        sys.exit(1)

    # 3. Retrieve the latest feature vector and target month label
    try:
        X_latest, target_month = get_latest_features()
        # X_latest is a 2‑D numpy array with shape (1, n_features)
        X_scaled = scaler.transform(X_latest)
    except Exception as e:
        logging.error(f"Feature extraction failed: {e}")
        sys.exit(1)

    # 4. Predict (the models were trained to predict NFP change in *thousands* of jobs)
    try:
        pred = model.predict(X_scaled)[0]
        logging.info(f"Forecast for {target_month}: {pred:,.0f} (thousand jobs)")
    except Exception as e:
        logging.error(f"Prediction step failed: {e}")
        sys.exit(1)

    # 5. Optional: load consensus NFP from the existing dashboard JSON if available
    consensus_nfp = None
    implied_surprise = None
    bias_label = None
    # The dashboard stores consensus in `us-nfp.json` under the key "consensus".
    # We'll attempt to read it; if unavailable we gracefully continue.
    try:
        import json
        dashboard_json_path = PROJECT_ROOT / "Economic-Dashboard" / "public" / "us-nfp.json"
        if dashboard_json_path.is_file():
            with open(dashboard_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            consensus_nfp = data.get("consensus")
            if consensus_nfp is not None:
                implied_surprise = pred - consensus_nfp
                # Simple bias categorisation based on surprise magnitude
                if implied_surprise > 20:
                    bias_label = "Bullish"
                elif implied_surprise < -20:
                    bias_label = "Bearish"
                else:
                    bias_label = "Neutral"
    except Exception as e:
        logging.warning(f"Could not read consensus NFP from dashboard JSON: {e}")

    # 6. Write prediction to SQLite
    try:
        conn = sqlite3.connect(DB_PATH)
        insert_prediction(
            conn,
            target_month=target_month,
            forecast_date=datetime.datetime.utcnow().isoformat(),
            model_name=model_name,
            predicted_nfp=pred,
            consensus_nfp=consensus_nfp,
            implied_surprise=implied_surprise,
            bias_label=bias_label,
        )
    finally:
        conn.close()

    logging.info("NFP forecast job completed successfully")

if __name__ == "__main__":
    main()
