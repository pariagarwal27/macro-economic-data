# fetch_all_fred_bls_release_dates.py

import json
import os
import requests
from datetime import date

from release_time_utils import combine_date_time


# ============================================================
# CONFIG
# ============================================================

FRED_API_KEY = os.getenv("FRED_API_KEY", "")

BASE_URL = "https://api.stlouisfed.org/fred"

OUTPUT_FILE = "fred_bls_release_dates.json"


# ============================================================
# YOUR 49 BLS METRICS
# ============================================================

BLS_METRICS = {

    # --------------------------------------------------------
    # CPI
    # --------------------------------------------------------

    "us-cpi": {
        "release_family": "CPI"
    },

    "us-cpi-mom": {
        "release_family": "CPI"
    },

    "us-cpi-core": {
        "release_family": "CPI"
    },

    "us-core-goods-cpi-yoy": {
        "release_family": "CPI"
    },

    "us-core-goods-cpi-mom": {
        "release_family": "CPI"
    },

    "us-services-cpi-yoy": {
        "release_family": "CPI"
    },

    "us-services-cpi-mom": {
        "release_family": "CPI"
    },

    "us-cpi-nsa": {
        "release_family": "CPI"
    },

    "us-cpi-core-nsa": {
        "release_family": "CPI"
    },

    "us-cpi-food": {
        "release_family": "CPI"
    },

    "us-cpi-energy": {
        "release_family": "CPI"
    },

    "us-cpi-apparel": {
        "release_family": "CPI"
    },

    "us-cpi-new-vehicles": {
        "release_family": "CPI"
    },

    "us-cpi-used-cars": {
        "release_family": "CPI"
    },

    "us-cpi-medical-commodities": {
        "release_family": "CPI"
    },

    "us-cpi-recreation-commodities": {
        "release_family": "CPI"
    },

    "us-cpi-education-commodities": {
        "release_family": "CPI"
    },
        "us-unit-labor-cost": {
        "release_family": "Productivity and Costs"
    },

    "us-cpi-other-goods": {
        "release_family": "CPI"
    },

    "us-cpi-shelter": {
        "release_family": "CPI"
    },

    "us-cpi-medical-services": {
        "release_family": "CPI"
    },

    "us-cpi-recreation-services": {
        "release_family": "CPI"
    },

    "us-cpi-transport-services": {
        "release_family": "CPI"
    },

    "us-cpi-education-services": {
        "release_family": "CPI"
    },

    "us-cpi-other-services": {
        "release_family": "CPI"
    },


    # --------------------------------------------------------
    # PPI
    # --------------------------------------------------------

    "us-ppi-final-demand": {
        "release_family": "PPI"
    },

    "us-ppi-core": {
        "release_family": "PPI"
    },


    # --------------------------------------------------------
    # EMPLOYMENT SITUATION
    # --------------------------------------------------------

    "us-ahe": {
        "release_family": "Employment Situation"
    },

    "us-ahe-mom": {
        "release_family": "Employment Situation"
    },

    "us-nfp": {
        "release_family": "Employment Situation"
    },

    "us-payrolls-level": {
        "release_family": "Employment Situation"
    },

    "us-unemployment": {
        "release_family": "Employment Situation"
    },

    "us-u6": {
        "release_family": "Employment Situation"
    },

    "us-participation": {
        "release_family": "Employment Situation"
    },

    "us-employment-population": {
        "release_family": "Employment Situation"
    },

    "us-unemployed-persons": {
        "release_family": "Employment Situation"
    },

    "us-long-term-unemployed": {
        "release_family": "Employment Situation"
    },

    "us-private-payrolls": {
        "release_family": "Employment Situation"
    },

    "us-government-payrolls": {
        "release_family": "Employment Situation"
    },

    "us-civilian-labor-force": {
        "release_family": "Employment Situation"
    },

    "us-not-in-labor-force": {
        "release_family": "Employment Situation"
    },

    "us-average-weekly-earnings": {
        "release_family": "Employment Situation"
    },


    # --------------------------------------------------------
    # JOLTS
    # --------------------------------------------------------

    "us-jolts-openings": {
        "release_family": "JOLTS"
    },

    "us-jolts-quits": {
        "release_family": "JOLTS"
    },

    "us-jolts-hires": {
        "release_family": "JOLTS"
    },

    "us-jolts-layoffs": {
        "release_family": "JOLTS"
    },

    "us-jolts-hires-level": {
        "release_family": "JOLTS"
    },

    "us-jolts-quits-level": {
        "release_family": "JOLTS"
    },

    "us-jolts-layoffs-level": {
        "release_family": "JOLTS"
    },

    "us-jolts-total-separations": {
        "release_family": "JOLTS"
    },

    # --------------------------------------------------------
    # Additional official-release families used by FRED-backed
    # catalog metrics. FRED supplies the release date; the live
    # value still comes from the project's official adapter.
    # --------------------------------------------------------

    "us-avg-workweek": {
        "release_family": "Employment Situation"
    },

    "us-mfg-employment": {
        "release_family": "Employment Situation"
    },

    "us-temp-help": {
        "release_family": "Employment Situation"
    },

    "us-eci-total": {
        "release_family": "Employment Cost Index"
    },

    "us-eci-wages": {
        "release_family": "Employment Cost Index"
    },

    "us-housing-starts": {
        "release_family": "New Residential Construction"
    },

    "us-building-permits": {
        "release_family": "New Residential Construction"
    },

    "us-durable-goods": {
        "release_family": "Advance Report on Durable Goods"
    },

    "us-import-prices": {
        "release_family": "U.S. Import and Export Price Indexes"
    },

    "us-manufacturers-new-orders": {
        "release_family": "Manufacturers' Shipments, Inventories, and Orders"
    },

    "us-empire-state": {
        "release_family": "Empire State Manufacturing Survey"
    },

}


# ============================================================
# RELEASE NAMES
# ============================================================

RELEASE_NAME_MAP = {
    "CPI": "Consumer Price Index",
    "PPI": "Producer Price Index",
    "Employment Situation": "Employment Situation",
    "JOLTS": "Job Openings and Labor Turnover Survey",
    "Productivity and Costs": "Productivity and Costs",
    "Employment Cost Index": "Employment Cost Index",
    "New Residential Construction": "New Residential Construction",
    "Advance Report on Durable Goods": "Advance Report on Durable Goods",
    "U.S. Import and Export Price Indexes": "U.S. Import and Export Price Indexes",
    "Manufacturers' Shipments, Inventories, and Orders": "Manufacturers' Shipments, Inventories, and Orders",
    "Empire State Manufacturing Survey": "Empire State Manufacturing Survey",
}

# Official BLS release times. BLS publishes CPI, PPI, Employment
# Situation and Productivity and Costs at 8:30 a.m. ET; JOLTS at
# 10:00 a.m. ET. The date remains sourced from the existing release
# calendar lookup.
BLS_RELEASE_TIMES = {
    "CPI": "08:30",
    "PPI": "08:30",
    "Employment Situation": "08:30",
    "JOLTS": "10:00",
    "Productivity and Costs": "08:30",
    "Employment Cost Index": "08:30",
    "New Residential Construction": "08:30",
    "Advance Report on Durable Goods": "08:30",
    "U.S. Import and Export Price Indexes": "08:30",
    "Manufacturers' Shipments, Inventories, and Orders": "08:30",
    "Empire State Manufacturing Survey": "08:30",
}

BLS_RELEASE_TIMEZONE = "America/New_York"

# ============================================================
# FRED API HELPERS
# ============================================================

def fred_get(endpoint, params):
    """
    Make a GET request to the FRED API.
    """

    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is not configured for the calendar refresh.")

    params = {
        "api_key": FRED_API_KEY,
        "file_type": "json",
        **params
    }

    url = f"{BASE_URL}/{endpoint}"

    response = requests.get(
        url,
        params=params,
        timeout=30
    )

    response.raise_for_status()

    data = response.json()

    return data


# ============================================================
# FIND RELEASE IDs
# ============================================================

def find_release_ids():
    """
    Get all FRED releases and identify the release IDs
    for CPI, PPI, Employment Situation and JOLTS.
    """

    print("\nFetching FRED release list...")

    data = fred_get(
        "releases",
        {
            "limit": 1000
        }
    )

    releases = data.get("releases", [])

    found = {}

    for family, release_name in RELEASE_NAME_MAP.items():

        matches = [
            r for r in releases
            if r.get("name", "").strip().lower()
            == release_name.lower()
        ]

        if not matches:

            # fallback: partial matching
            matches = [
                r for r in releases
                if release_name.lower()
                in r.get("name", "").lower()
            ]

        if matches:

            release = matches[0]

            found[family] = {
                "release_id": release["id"],
                "release_name": release["name"],
                "release_link": release.get("link")
            }

            print(
                f"{family:<25} "
                f"release_id={release['id']} "
                f"name={release['name']}"
            )

        else:

            print(
                f"{family:<25} NOT FOUND"
            )

    return found


# ============================================================
# GET NEXT RELEASE DATE
# ============================================================

def fetch_next_release(release_id):
    """
    Fetch future/current release dates for a FRED release
    and return the next date from today onward.
    """

    today = date.today().isoformat()

    data = fred_get(
        "release/dates",
        {
            "release_id": release_id,

            # Important:
            # This allows future scheduled dates to be returned.
            "include_release_dates_with_no_data": "true",

            "realtime_start": today,

            "limit": 10000,

            "sort_order": "asc"
        }
    )

    release_dates = data.get("release_dates", [])

    future_dates = []

    for item in release_dates:

        release_date = item.get("date")

        if not release_date:
            continue

        if release_date >= today:
            future_dates.append(release_date)

    if not future_dates:

        return None

    return future_dates[0]


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("FRED BLS RELEASE CALENDAR FETCH")
    print("=" * 70)

    # --------------------------------------------------------
    # 1. Find FRED release IDs
    # --------------------------------------------------------

    releases = find_release_ids()

    print("\n" + "=" * 70)
    print("FETCHING NEXT RELEASE DATES")
    print("=" * 70)

    # --------------------------------------------------------
    # 2. Fetch next date once per release family
    # --------------------------------------------------------

    family_dates = {}

    for family, release_info in releases.items():

        release_id = release_info["release_id"]

        print(
            f"\nFamily : {family}"
        )

        print(
            f"Release: {release_info['release_name']}"
        )

        print(
            f"ID     : {release_id}"
        )

        try:

            next_release = fetch_next_release(
                release_id
            )

            family_dates[family] = {
                **release_info,
                "next_release": next_release,
                "next_release_at": combine_date_time(
                    next_release,
                    BLS_RELEASE_TIMES.get(family),
                    BLS_RELEASE_TIMEZONE,
                ),
            }

            print(
                f"NEXT RELEASE: {next_release}"
            )

        except Exception as e:

            family_dates[family] = {
                **release_info,
                "next_release": None,
                "next_release_at": None,
                "error": str(e)
            }

            print(
                f"ERROR: {e}"
            )


    # --------------------------------------------------------
    # 3. Build metric-level output
    # --------------------------------------------------------

    results = {}

    for metric_id, metric_info in BLS_METRICS.items():

        family = metric_info["release_family"]

        family_info = family_dates.get(family)

        if family_info is None:

            results[metric_id] = {
                "success": False,
                "release_family": family,
                "next_release": None,
                "error": "Release family not found in FRED"
            }

            continue


        next_release = family_info.get(
            "next_release"
        )

        next_release_at = family_info.get(
            "next_release_at"
        )

        results[metric_id] = {

            "success": next_release is not None,

            "metric_id": metric_id,

            "release_family": family,

            "release_id": family_info.get(
                "release_id"
            ),

            "release_name": family_info.get(
                "release_name"
            ),

            "next_release": next_release,
            "next_release_at": next_release_at
        }


    # --------------------------------------------------------
    # 4. Save JSON
    # --------------------------------------------------------

    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            results,
            f,
            indent=2,
            ensure_ascii=False
        )


    # --------------------------------------------------------
    # 5. Summary
    # --------------------------------------------------------

    successful = sum(
        1
        for x in results.values()
        if x.get("success")
    )

    failed = len(results) - successful

    print("\n" + "=" * 70)

    print(
        f"Metrics processed : {len(results)}"
    )

    print(
        f"Successful        : {successful}"
    )

    print(
        f"Failed            : {failed}"
    )

    print(
        f"Saved             : {OUTPUT_FILE}"
    )

    print("=" * 70)


if __name__ == "__main__":
    main()