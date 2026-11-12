"""Export the selected NFP surprise model and its preprocessing for JS inference."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import train_compact_nfp_ridge as compact
import train_nfp_ridge as base
import train_surprise_midas_ensemble as legacy
import create_revised_lightgbm_current_forecast as model_settings
from train_lightgbm_failure_fixes import prune_correlated_features


ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results/lightgbm_failure_fixes_2026-11-06"
OUTPUT = ROOT / "results/nfp-cloudflare-model.json"


def main() -> None:
    summary = json.loads((RESULTS / "summary.json").read_text(encoding="utf-8"))
    selected = summary["models"]["revised_no_indeed_pruned"]
    config = selected["selected_lightgbm"]
    shrink = float(selected["selected_validation_shrink"])

    with base.sqlite3.connect(model_settings.DATABASE.as_uri() + "?mode=ro", uri=True) as connection:
        raw = base.pd.read_sql_query("SELECT * FROM nfp_training ORDER BY target_month", connection)
        predictors, _ = base.classify_columns(raw)
        data, _, _, _ = compact.build_inputs(connection, raw)

    data = legacy.add_surprise_index(legacy.add_regime(data))
    candidates = [feature for feature in predictors + legacy.REGIME + ["surprise_lag_1", "surprise_index_3m"]
                  if not feature.lower().startswith("indeed_")]
    target_month = str(base.pd.Period(data.target_month.max(), freq="M") + 1)
    eligible_mask = data.target_month < target_month
    if config["window"] == "rolling120":
        eligible_mask &= data.target_month >= str(base.pd.Period(target_month, freq="M") - 120)
    eligible = data.index[eligible_mask].tolist()
    training = data.loc[eligible]
    target = training.target_actual.astype(float) - training.current_consensus.astype(float)
    features, _ = prune_correlated_features(training, candidates, target)

    estimator = legacy.make_lgb(config)
    estimator.fit(training[features].astype(float), target)
    preprocessing = estimator.named_steps["features"]
    transformers = dict(preprocessing.transformer_list)
    value_imputer = transformers["values"]
    missing_imputer = transformers["missing"]
    scaler = estimator.named_steps["scale"]
    forest = estimator.named_steps["model"].booster_.dump_model()

    output = {
        "model": "revised_no_indeed_pruned",
        "model_status": "experimental; historical test did not beat consensus",
        "training_window": config["window"],
        "training_rows": int(len(training)),
        "first_training_month": str(training.target_month.min()),
        "last_training_month": str(training.target_month.max()),
        "selected_features": features,
        "surprise_multiplier": shrink,
        "initial_score": 0.0,
        "medians": [None if not np.isfinite(value) else float(value) for value in value_imputer.statistics_],
        "value_missing_features": [int(value) for value in missing_imputer.features_],
        "scale_mean": scaler.mean_.astype(float).tolist(),
        "scale_scale": scaler.scale_.astype(float).tolist(),
        "num_features": len(features),
        "trees": forest["tree_info"],
    }
    # Store a known prediction from a complete historical row for deployment QA.
    probe = training.iloc[[-1]][features].astype(float)
    output["probe"] = {
        "values": {key: float(value) for key, value in probe.iloc[0].items() if np.isfinite(value)},
        "prediction": float(estimator.predict(probe)[0]),
    }
    OUTPUT.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({key: output[key] for key in ["model", "training_rows", "first_training_month", "last_training_month", "num_features"]}, indent=2))


if __name__ == "__main__":
    main()
