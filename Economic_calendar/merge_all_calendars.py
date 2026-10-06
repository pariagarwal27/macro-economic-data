"""
Merge all economic calendar fetcher outputs into one JSON file.

Input files:
    bea_fetch_results.json
    boe_fetch_results.json
    census_retail_fetch_results.json
    ecb_fetch_results.json
    eurostat_fetch_results.json
    fred_bls_release_dates.json
    nyfed_sce_philly_spf_fetch_results.json
    ons_fetch_results.json
    special_us_macro_fetch_results.json

Output:
    all_calendar_results.json

Rules:
- metric_id is resolved using:
      metric_id -> id -> metric
- This handles BoE records where `id` may be null.
- Duplicate metric IDs are reported but not silently removed
  from the source audit.
- One canonical record is retained per metric ID.
"""

from __future__ import annotations

import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

from release_time_utils import clean_datetime_value


# ============================================================
# CONFIG
# ============================================================

OUTPUT_FILE = Path("all_calendar_results.json")


SOURCE_FILES = [
    ("BEA", "bea_fetch_results.json"),
    ("BoE", "boe_fetch_results.json"),
    ("Census", "census_retail_fetch_results.json"),
    ("ECB", "ecb_fetch_results.json"),
    ("Eurostat", "eurostat_fetch_results.json"),
    ("FRED/BLS", "fred_bls_release_dates.json"),
    (
        "NY Fed / Philadelphia Fed",
        "nyfed_sce_philly_spf_fetch_results.json",
    ),
    ("ONS", "ons_fetch_results.json"),
    (
        "Special US Macro",
        "special_us_macro_fetch_results.json",
    ),
    ("PMI", "pmi_calendar_fetch_results.json"),
]


# ============================================================
# HELPERS
# ============================================================

# Canonical catalog IDs used by the current TypeScript catalog.
# Calendar fetchers may retain historical/provider-facing IDs; normalize them
# here as well as in individual fetchers so stale JSON can never drop a
# scheduled metric during a merge.
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
}

def canonical_metric_id(value):
    if value is None:
        return None
    value = str(value).strip()
    return CANONICAL_ID_ALIASES.get(value, value) or None


def load_json(path: Path):
    """
    Load JSON from disk.
    """
    with path.open(
        "r",
        encoding="utf-8",
    ) as f:
        return json.load(f)


def resolve_metric_id(record: dict):
    """
    Resolve canonical metric ID.

    Priority:
        1. metric_id
        2. id
        3. metric

    The third fallback is important for BoE records where
    `id` can be None while `metric` contains the canonical
    metric identifier.
    """

    # `metric_id` is canonical when present. Some fetchers (notably BoE)
    # use `id` for the provider-native series code while `metric` contains
    # the canonical catalog ID. Prefer `metric` before provider `id`.
    metric_id = (
        record.get("metric_id")
        or record.get("metric")
        or record.get("id")
    )

    if metric_id is None:
        return None

    metric_id = str(metric_id).strip()

    if not metric_id:
        return None

    return canonical_metric_id(metric_id)


def extract_records(payload):
    """
    Normalize different fetcher JSON structures into a list
    of metric records.

    Supported structures:
        - {"results": [...]}
        - {"metrics": [...]}
        - {"data": [...]}
        - list
        - dictionary keyed by metric ID
    """

    # --------------------------------------------------------
    # Direct list
    # --------------------------------------------------------

    if isinstance(payload, list):
        return payload

    # --------------------------------------------------------
    # Dictionary
    # --------------------------------------------------------

    if isinstance(payload, dict):

        # Common result containers
        for key in (
            "results",
            "metrics",
            "data",
            "records",
        ):
            value = payload.get(key)

            if isinstance(value, list):
                return value

            if isinstance(value, dict):
                records = []

                for key_id, value_item in value.items():

                    if isinstance(value_item, dict):

                        item = dict(value_item)

                        # Preserve dictionary key if no ID exists
                        if not (
                            item.get("metric_id")
                            or item.get("id")
                            or item.get("metric")
                        ):
                            item["metric_id"] = key_id

                        records.append(item)

                return records

        # ----------------------------------------------------
        # Dictionary keyed directly by metric ID
        # ----------------------------------------------------

        records = []

        for key_id, value in payload.items():

            if not isinstance(value, dict):
                continue

            item = dict(value)

            if not (
                item.get("metric_id")
                or item.get("id")
                or item.get("metric")
            ):
                item["metric_id"] = key_id

            records.append(item)

        return records

    return []


def extract_release_at(record: dict):
    """
    Preserve an exact scheduled release datetime supplied by a fetcher.

    No time is invented. Date-only values are rejected as exact timestamps.
    """
    candidates = [
        record.get("next_release_at"),
        record.get("release_datetime"),
        record.get("release_date_time"),
        record.get("release_at"),
        record.get("scheduled_at"),
        record.get("scheduled_release"),
        record.get("next_release_datetime"),
        record.get("next_release_date_time"),
    ]

    family_result = record.get("family_result")

    if isinstance(family_result, dict):
        candidates.extend(
            [
                family_result.get("next_release_at"),
                family_result.get("release_datetime"),
                family_result.get("release_date_time"),
                family_result.get("release_at"),
                family_result.get("scheduled_at"),
                family_result.get("scheduled_release"),
                family_result.get("next_release_datetime"),
                family_result.get("next_release_date_time"),
            ]
        )

    for value in candidates:
        cleaned = clean_datetime_value(value)
        if cleaned:
            return cleaned

    # If next_release itself is a full datetime, preserve it.
    cleaned = clean_datetime_value(record.get("next_release"))
    if cleaned and (
        "T" in cleaned
        or " " in cleaned
    ):
        return cleaned

    return None


def normalize_record(
    source_name: str,
    record: dict,
):
    """
    Convert a source-specific record into the common schema.
    """

    metric_id = resolve_metric_id(record)

    if metric_id is None:
        return None

    # Preserve original source-specific ID separately.
    source_metric_id = (
        record.get("metric_id")
        or record.get("id")
    )

    # --------------------------------------------------------
    # Release date
    # --------------------------------------------------------

    next_release = (
        record.get("next_release")
        or record.get("next_release_date")
        or record.get("release_date")
    )

    # Some fetchers may use a nested value
    if next_release is None:

        family_result = record.get("family_result")

        if isinstance(family_result, dict):
            next_release = (
                family_result.get("next_release")
                or family_result.get("date")
            )

    # --------------------------------------------------------
    # Metric name
    # --------------------------------------------------------

    metric_name = (
        record.get("metric_name")
        or record.get("metric")
        or metric_id
    )

    # --------------------------------------------------------
    # Family
    # --------------------------------------------------------

    family = (
        record.get("family")
        or record.get("release_family")
        or record.get("family_name")
    )

    # --------------------------------------------------------
    # Status
    # --------------------------------------------------------

    status = (
        record.get("status")
        or record.get("release_status")
    )

    # --------------------------------------------------------
    # Success
    # --------------------------------------------------------

    success = record.get("success")

    if success is None:
        success = bool(next_release)

    # --------------------------------------------------------
    # Official source/evidence
    # --------------------------------------------------------

    official_source = (
        record.get("official_source")
        or record.get("source_url")
        or record.get("release_uri")
        or record.get("official_url")
    )

    official_evidence = (
        record.get("official_evidence")
        or record.get("evidence")
        or record.get("release_title")
        or record.get("error")
    )

    # --------------------------------------------------------
    # Canonical record
    # --------------------------------------------------------

    normalized = {
        "metric_id": metric_id,
        "metric": metric_name,
        "source": source_name,
        "source_metric_id": source_metric_id,
        "family": family,
        "next_release": next_release,
        "next_release_at": extract_release_at(record),
        "release_status": status,
        "success": bool(success),
        "official_source": official_source,
        "official_evidence": official_evidence,
    }

    # --------------------------------------------------------
    # Preserve useful original fields
    # --------------------------------------------------------

    # Series ID
    if record.get("series_id") is not None:
        normalized["series_id"] = record["series_id"]

    # ID
    if record.get("id") is not None:
        normalized["source_id"] = record["id"]

    # Release title
    if record.get("release_title") is not None:
        normalized["release_title"] = record["release_title"]

    # Error
    if record.get("error") is not None:
        normalized["error"] = record["error"]

    return normalized


# ============================================================
# MAIN MERGE
# ============================================================

def main():

    print("=" * 70)
    print("MERGING ECONOMIC CALENDAR RESULTS")
    print("=" * 70)

    all_source_records = []
    source_summary = {}

    # --------------------------------------------------------
    # Load every source
    # --------------------------------------------------------

    for source_name, filename in SOURCE_FILES:

        path = Path(filename)

        print(
            f"\n[{source_name}]"
        )

        if not path.exists():

            print(
                f"  WARNING: file not found -> {filename}"
            )

            source_summary[source_name] = {
                "file": filename,
                "records_loaded": 0,
                "records_accepted": 0,
                "missing_metric_id": 0,
                "missing_file": True,
            }

            continue

        try:
            payload = load_json(path)

        except Exception as exc:

            print(
                f"  ERROR reading {filename}: {exc}"
            )

            source_summary[source_name] = {
                "file": filename,
                "records_loaded": 0,
                "records_accepted": 0,
                "missing_metric_id": 0,
                "read_error": str(exc),
            }

            continue

        records = extract_records(payload)

        accepted = 0
        missing_id = 0

        for record in records:

            if not isinstance(record, dict):
                continue

            normalized = normalize_record(
                source_name,
                record,
            )

            if normalized is None:

                missing_id += 1

                continue

            all_source_records.append(
                normalized
            )

            accepted += 1

        source_summary[source_name] = {
            "file": filename,
            "records_loaded": len(records),
            "records_accepted": accepted,
            "missing_metric_id": missing_id,
        }

        print(
            f"  Loaded records : {len(records)}"
        )

        print(
            f"  Accepted       : {accepted}"
        )

        if missing_id:
            print(
                f"  Missing ID     : {missing_id}"
            )

    # ========================================================
    # DUPLICATE ANALYSIS
    # ========================================================

    by_metric_id = defaultdict(list)

    for record in all_source_records:

        by_metric_id[
            record["metric_id"]
        ].append(record)

    duplicate_ids = {
        metric_id: records
        for metric_id, records
        in by_metric_id.items()
        if len(records) > 1
    }

    # ========================================================
    # SELECT CANONICAL RECORD
    # ========================================================

    canonical_records = []

    for metric_id, records in by_metric_id.items():

        # ----------------------------------------------------
        # If there is only one source record, use it directly.
        # ----------------------------------------------------

        if len(records) == 1:

            canonical_records.append(
                records[0]
            )

            continue

        # ----------------------------------------------------
        # Multiple source records.
        #
        # Prefer the record that has:
        #   1. A release date
        #   2. success=True
        #   3. official source
        #
        # This prevents an empty duplicate from replacing a
        # populated record.
        # ----------------------------------------------------

        def priority(record):

            return (
                bool(record.get("next_release_at")),
                bool(record.get("next_release")),
                bool(record.get("success")),
                bool(record.get("official_source")),
            )

        selected = sorted(
            records,
            key=priority,
            reverse=True,
        )[0]

        canonical_records.append(
            selected
        )

    # --------------------------------------------------------
    # Sort for stable output
    # --------------------------------------------------------

    canonical_records.sort(
        key=lambda x: x["metric_id"]
    )

    # ========================================================
    # SUMMARY COUNTS
    # ========================================================

    total_source_records = len(
        all_source_records
    )

    unique_metrics = len(
        canonical_records
    )

    metrics_with_release = sum(
        1
        for record in canonical_records
        if record.get("next_release")
    )

    metrics_without_release = (
        unique_metrics
        - metrics_with_release
    )

    metrics_with_release_time = sum(
        1
        for record in canonical_records
        if record.get("next_release_at")
    )

    metrics_without_release_time = (
        unique_metrics
        - metrics_with_release_time
    )

    duplicate_metric_count = len(
        duplicate_ids
    )

    duplicate_source_record_count = sum(
        len(records) - 1
        for records in duplicate_ids.values()
    )

    # ========================================================
    # PRINT SUMMARY
    # ========================================================

    print("\n")
    print("=" * 70)
    print("MERGE SUMMARY")
    print("=" * 70)

    print(
        f"Source records       : {total_source_records}"
    )

    print(
        f"Unique metrics       : {unique_metrics}"
    )

    print(
        f"With release date    : {metrics_with_release}"
    )

    print(
        f"Without release date : {metrics_without_release}"
    )

    print(
        f"With release time    : {metrics_with_release_time}"
    )

    print(
        f"Without release time : {metrics_without_release_time}"
    )

    print(
        f"Duplicate metric IDs : {duplicate_metric_count}"
    )

    if duplicate_source_record_count:
        print(
            f"Extra duplicate rows : {duplicate_source_record_count}"
        )

    # ========================================================
    # SOURCE BREAKDOWN
    # ========================================================

    print("\nPer-source breakdown:")

    for source_name, _ in SOURCE_FILES:

        count = sum(
            1
            for record in all_source_records
            if record["source"] == source_name
        )

        with_time = sum(
            1
            for record in all_source_records
            if (
                record["source"] == source_name
                and record.get("next_release_at")
            )
        )

        print(
            f"  {source_name:30s}: "
            f"{count} records, "
            f"{with_time} with release time"
        )

    # ========================================================
    # DUPLICATE DETAILS
    # ========================================================

    if duplicate_ids:

        print("\nDuplicate IDs:")

        for metric_id in sorted(
            duplicate_ids
        ):

            sources = sorted(
                set(
                    record["source"]
                    for record
                    in duplicate_ids[
                        metric_id
                    ]
                )
            )

            print(
                f"  - {metric_id}: "
                f"{', '.join(sources)}"
            )

    # ========================================================
    # OUTPUT
    # ========================================================

    output = {
        "generated_at_utc": datetime.now(
            timezone.utc
        ).isoformat(),

        "total_source_records": (
            total_source_records
        ),

        "unique_metrics": (
            unique_metrics
        ),

        "metrics_with_release_date": (
            metrics_with_release
        ),

        "metrics_without_release_date": (
            metrics_without_release
        ),

        "metrics_with_release_time": (
            metrics_with_release_time
        ),

        "metrics_without_release_time": (
            metrics_without_release_time
        ),

        "duplicate_metric_ids": (
            duplicate_metric_count
        ),

        "duplicate_source_records": (
            duplicate_source_record_count
        ),

        "source_summary": (
            source_summary
        ),

        "duplicates": {
            metric_id: [
                {
                    "source": record[
                        "source"
                    ],
                    "next_release": record[
                        "next_release"
                    ],
                    "next_release_at": record.get(
                        "next_release_at"
                    ),
                }
                for record
                in records
            ]
            for metric_id, records
            in duplicate_ids.items()
        },

        "metrics": canonical_records,
    }

    OUTPUT_FILE.write_text(
        json.dumps(
            output,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        f"\nSaved -> {OUTPUT_FILE}"
    )

    print("=" * 70)


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()