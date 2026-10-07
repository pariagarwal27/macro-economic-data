import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests

from release_time_utils import preserve_datetime


# ============================================================
# CONFIG
# ============================================================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/139.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# ONS current Search / Release API
RELEASE_API = "https://api.beta.ons.gov.uk/v1/search/releases"

OUTPUT_FILE = "ons_fetch_results.json"

REQUEST_TIMEOUT = 30
SLEEP_BETWEEN_REQUESTS = 0.25


# ============================================================
# ONS METRICS
# ============================================================

ONS_METRICS = {
    # --------------------------------------------------------
    # CPI / CPIH / RPI
    # --------------------------------------------------------
    "uk-cpi-yoy": "D7G7",
    "uk-cpih-yoy": "L550",
    "uk-alcohol-cpi-yoy": "D7G9",
    "uk-clothing-cpi-yoy": "D7GA",
    "uk-furniture-cpi-yoy": "D7GC",
    "uk-health-cpi-yoy": "D7GD",
    "uk-transport-cpi-yoy": "D7GE",
    "uk-communication-cpi-yoy": "D7GF",
    "uk-recreation-cpi-yoy": "D7GG",
    "uk-education-cpi-yoy": "D7GH",
    "uk-restaurants-hotels-cpi-yoy": "D7GI",
    "uk-miscellaneous-cpi-yoy": "D7GJ",

    "uk-alcohol-cpih-yoy": "L55Q",
    "uk-clothing-cpih-yoy": "L55R",
    "uk-furniture-cpih-yoy": "L55T",
    "uk-health-cpih-yoy": "L55U",
    "uk-transport-cpih-yoy": "L55V",
    "uk-communication-cpih-yoy": "L55W",
    "uk-recreation-cpih-yoy": "L55X",
    "uk-education-cpih-yoy": "L55Y",
    "uk-restaurants-hotels-cpih-yoy": "L55Z",
    "uk-miscellaneous-cpih-yoy": "L562",

    "uk-core-cpi-yoy": "DKO8",
    "uk-cpi-mom": "D7OE",
    "uk-core-cpi-mom": "DKC6",

    "uk-services-cpi-yoy": "D7NN",
    "uk-services-cpi-mom": "D7MV",
    "uk-goods-cpi-yoy": "D7NM",
    "uk-goods-cpi-mom": "D7MU",

    "uk-food-cpi-yoy": "D7G8",
    "uk-energy-cpi-yoy": "D7GT",
    "uk-housing-cpi-yoy": "D7GB",

    "uk-rpi-yoy": "CZBH",

    "uk-cpih-mom": "L59C",
    "uk-core-cpih-yoy": "L5LQ",
    "uk-food-cpih-yoy": "L55P",
    "uk-food-cpih-mom": "L59D",
    "uk-housing-cpih-yoy": "L55S",
    "uk-housing-cpih-mom": "L5PG",

    # --------------------------------------------------------
    # PPI
    # --------------------------------------------------------
    "uk-ppi-output-yoy": "GB7S",
    "uk-ppi-input-yoy": "GHIP",

    # --------------------------------------------------------
    # Labour / Earnings
    # --------------------------------------------------------
    "uk-awe-regular-yoy": "KAI9",
    "uk-paye-median-pay-mom": "PAYE_MEDIAN_PAY",
    "uk-awe-regular-mom": "KAI7",
    "uk-unemployment": "MGSX",
    "uk-employment-level": "MGRZ",
    "uk-awe-total-yoy": "KAC3",
    "uk-vacancies": "AP2Y",
    "uk-payrolled-employees-level": "PAYE_EMP_LEVEL",
    "uk-employment-change": "PAYE_EMP_CHANGE",
    "uk-employment-rate": "MGSR",
    "uk-inactivity-rate": "I46G",

    # --------------------------------------------------------
    # GDP
    # --------------------------------------------------------
    "uk-gdp-yoy": "IHYR",
    "uk-gdp-qoq": "IHYQ",
    "uk-gdp-mom": "ECYX",
    "uk-gdp-3m-yoy": "ED9T",
    "uk-household-consumption-level": "ABJR",

    # --------------------------------------------------------
    # Net trade
    # These are National Accounts / quarterly GDP-family
    # metrics, NOT the standalone monthly UK Trade release.
    # --------------------------------------------------------
    "uk-net-trade-qoq": "ZZ5U",
    "uk-net-trade-yoy": "ZZ6D",

    # --------------------------------------------------------
    # Industrial production
    # --------------------------------------------------------
    "uk-industrial-production": "K222",

    # --------------------------------------------------------
    # Retail sales
    # --------------------------------------------------------
    "uk-retail-sales": "J5EK",
    "uk-retail-sales-mom": "J5EC",
    "uk-retail-sales-total-ex-fuel": "J5EC",
    "uk-retail-food-stores": "EAPT",
    "uk-retail-non-food-stores": "EAPV",
    "uk-retail-nonstore": "J5DZ",
    "uk-retail-automotive-fuel": "J05A",

    # --------------------------------------------------------
    # National Accounts / Expenditure
    # --------------------------------------------------------
    "uk-household-consumption-qoq": "A24M",
    "uk-household-consumption-yoy": "ZZ65",
    "uk-gfcf-level": "NPQT",
    "uk-gfcf-yoy": "KG7T",
    "uk-gfcf-qoq": "KG7Q",
    "uk-business-investment-qoq": "KG7P",
    "uk-business-investment-yoy": "KG7S",
    "uk-government-consumption-level": "NMRY",
}


# ============================================================
# RELEASE FAMILIES
#
# IMPORTANT:
# We fetch ONE release date per family.
# Then assign that date to every metric in that family.
# ============================================================

RELEASE_FAMILIES = {

    "AWE": {
        # The official UK Labour Market calendar release explicitly includes
        # average weekly earnings alongside employment and vacancies.
        "query": "UK Labour Market",
        "title_regex": r"^UK Labour Market:",
    },

    # --------------------------------------------------------
    # Inflation
    # CPI + CPIH + RPI
    # --------------------------------------------------------
    "CPI": {
        "query": "Consumer price inflation",
        "title_regex": r"^Consumer price inflation,\s*UK:",
    },

    # --------------------------------------------------------
    # Producer prices
    # Input + output PPI are same publication
    # --------------------------------------------------------
    "PPI": {
        "query": "Producer price inflation",
        "title_regex": r"^Producer price inflation,\s*UK:",
    },

    # --------------------------------------------------------
    # Labour market overview
    # unemployment, employment, vacancies, employment rate,
    # inactivity
    # --------------------------------------------------------
    "LABOUR_MARKET": {
        "query": "UK Labour Market",
        "title_regex": r"^UK Labour Market:",
    },

    # --------------------------------------------------------
    # PAYE RTI
    # payrolled employees + median pay + employment change
    # --------------------------------------------------------
    "PAYE_RTI": {
        "query": "Earnings and employment from Pay As You Earn Real Time Information",
        "title_regex": (
            r"^Earnings and employment from Pay As You Earn "
            r"Real Time Information,\s*UK:" 
        ),
    },

    # --------------------------------------------------------
    # Quarterly GDP / National Accounts
    # GDP qoq/yoy + net trade + government consumption
    # --------------------------------------------------------
    "GDP_QUARTERLY": {
        "query": "GDP quarterly national accounts",
        "title_regex": r"^GDP quarterly national accounts,\s*UK:",
    },

    # --------------------------------------------------------
    # Monthly GDP
    # GDP mom + 3-month-on-3-month/year-ago type series
    # --------------------------------------------------------
    "GDP_MONTHLY": {
        "query": "GDP monthly estimate",
        "title_regex": r"^GDP monthly estimate,\s*UK:",
    },

    # --------------------------------------------------------
    # Industrial production
    # --------------------------------------------------------
    "INDUSTRIAL_PRODUCTION": {
        "query": "Index of Production",
        "title_regex": r"^Index of Production,\s*UK:",
    },

    # --------------------------------------------------------
    # Retail sales
    # All retail sub-components including automotive fuel
    # --------------------------------------------------------
    "RETAIL_SALES": {
        "query": "Retail sales Great Britain",
        "title_regex": r"^Retail sales,\s*Great Britain:",
    },

    # --------------------------------------------------------
    # Household consumption
    # --------------------------------------------------------
    "CONSUMER_TRENDS": {
        "query": "Consumer trends",
        "title_regex": r"^Consumer trends,\s*UK:",
    },

    # --------------------------------------------------------
    # GFCF + Business Investment
    # --------------------------------------------------------
    "BUSINESS_INVESTMENT": {
        "query": "Business Investment in the UK",
        "title_regex": r"^Business Investment in the UK:",
    },
}


# ============================================================
# METRIC -> FAMILY
# ============================================================

METRIC_FAMILY = {}


def add_family(family, metrics):
    for metric_id in metrics:
        if metric_id in METRIC_FAMILY:
            raise ValueError(
                f"Metric assigned to multiple families: {metric_id}"
            )
        METRIC_FAMILY[metric_id] = family


# CPI / CPIH / RPI
add_family(
    "CPI",
    [
        "uk-cpi-yoy",
        "uk-cpih-yoy",
        "uk-alcohol-cpi-yoy",
        "uk-clothing-cpi-yoy",
        "uk-furniture-cpi-yoy",
        "uk-health-cpi-yoy",
        "uk-transport-cpi-yoy",
        "uk-communication-cpi-yoy",
        "uk-recreation-cpi-yoy",
        "uk-education-cpi-yoy",
        "uk-restaurants-hotels-cpi-yoy",
        "uk-miscellaneous-cpi-yoy",
        "uk-alcohol-cpih-yoy",
        "uk-clothing-cpih-yoy",
        "uk-furniture-cpih-yoy",
        "uk-health-cpih-yoy",
        "uk-transport-cpih-yoy",
        "uk-communication-cpih-yoy",
        "uk-recreation-cpih-yoy",
        "uk-education-cpih-yoy",
        "uk-restaurants-hotels-cpih-yoy",
        "uk-miscellaneous-cpih-yoy",
        "uk-core-cpi-yoy",
        "uk-cpi-mom",
        "uk-core-cpi-mom",
        "uk-services-cpi-yoy",
        "uk-services-cpi-mom",
        "uk-goods-cpi-yoy",
        "uk-goods-cpi-mom",
        "uk-food-cpi-yoy",
        "uk-energy-cpi-yoy",
        "uk-housing-cpi-yoy",
        "uk-rpi-yoy",
        "uk-cpih-mom",
        "uk-core-cpih-yoy",
        "uk-food-cpih-yoy",
        "uk-food-cpih-mom",
        "uk-housing-cpih-yoy",
        "uk-housing-cpih-mom",
    ],
)

# PPI
add_family(
    "PPI",
    [
        "uk-ppi-output-yoy",
        "uk-ppi-input-yoy",
    ],
)

# AWE
add_family(
    "AWE",
    [
        "uk-awe-regular-yoy",
        "uk-awe-regular-mom",
        "uk-awe-total-yoy",
    ],
)

# Labour market
add_family(
    "LABOUR_MARKET",
    [
        "uk-unemployment",
        "uk-employment-level",
        "uk-vacancies",
        "uk-employment-rate",
        "uk-inactivity-rate",
    ],
)

# PAYE
add_family(
    "PAYE_RTI",
    [
        "uk-paye-median-pay-mom",
        "uk-payrolled-employees-level",
        "uk-employment-change",
    ],
)

# Quarterly GDP / National Accounts
add_family(
    "GDP_QUARTERLY",
    [
        "uk-gdp-yoy",
        "uk-gdp-qoq",
        "uk-net-trade-qoq",
        "uk-net-trade-yoy",
        "uk-government-consumption-level",
    ],
)

# Monthly GDP
add_family(
    "GDP_MONTHLY",
    [
        "uk-gdp-mom",
        "uk-gdp-3m-yoy",
    ],
)

# Industrial production
add_family(
    "INDUSTRIAL_PRODUCTION",
    [
        "uk-industrial-production",
    ],
)

# Retail
add_family(
    "RETAIL_SALES",
    [
        "uk-retail-sales",
        "uk-retail-sales-mom",
        "uk-retail-sales-total-ex-fuel",
        "uk-retail-food-stores",
        "uk-retail-non-food-stores",
        "uk-retail-nonstore",
        "uk-retail-automotive-fuel",
    ],
)

# Household consumption
# Household consumption
add_family(
    "CONSUMER_TRENDS",
    [
        "uk-household-consumption-level",
        "uk-household-consumption-qoq",
        "uk-household-consumption-yoy",
    ],
)

# GFCF / business investment
add_family(
    "BUSINESS_INVESTMENT",
    [
        "uk-gfcf-level",
        "uk-gfcf-yoy",
        "uk-gfcf-qoq",
        "uk-business-investment-qoq",
        "uk-business-investment-yoy",
    ],
)


# ============================================================
# VALIDATION
# ============================================================

missing_family_mapping = sorted(
    set(ONS_METRICS.keys()) - set(METRIC_FAMILY.keys())
)

extra_family_mapping = sorted(
    set(METRIC_FAMILY.keys()) - set(ONS_METRICS.keys())
)

if missing_family_mapping:
    raise ValueError(
        "Metrics missing family mapping:\n"
        + "\n".join(missing_family_mapping)
    )

if extra_family_mapping:
    raise ValueError(
        "Family mapping contains unknown metrics:\n"
        + "\n".join(extra_family_mapping)
    )


# ============================================================
# HELPERS
# ============================================================

def parse_release_date(value):
    """
    Convert ONS release_date into YYYY-MM-DD.

    Handles:
      2026-10-21T07:00:00Z
      2026-10-21
    """

    if not value:
        return None

    value = str(value).strip()

    match = re.search(r"(\d{4}-\d{2}-\d{2})", value)

    if not match:
        return None

    return match.group(1)


def get_release_items(payload):
    """
    ONS Search API response compatibility.
    """

    if not isinstance(payload, dict):
        return []

    for key in ("releases", "items", "results"):
        value = payload.get(key)

        if isinstance(value, list):
            return value

    return []


def normalize_release(item):
    """
    Normalize possible ONS release object structures.
    """

    if not isinstance(item, dict):
        return None

    title = (
        item.get("title")
        or item.get("name")
        or item.get("description", {}).get("title")
        or ""
    )

    release_date = (
        item.get("release_date")
        or item.get("releaseDate")
        or item.get("date")
        or item.get("description", {}).get("release_date")
        or item.get("description", {}).get("releaseDate")
    )

    uri = item.get("uri")

    parsed_date = parse_release_date(release_date)

    if not title or not parsed_date:
        return None

    return {
        "title": title.strip(),
        "release_date": parsed_date,
        "release_at": preserve_datetime(
            str(release_date),
            "Europe/London",
        ),
        "uri": uri,
    }


# ============================================================
# FETCH ONE FAMILY RELEASE DATE
# ============================================================

def fetch_family_release(family_name, config):
    """
    Fetch ONE upcoming ONS release for a family.

    We deliberately do not query individual metric series.
    """

    params = {
        "query": config["query"],
        "release-type": "type-upcoming",
        "sort": "release_date_asc",
        "limit": 100,
    }

    url = RELEASE_API + "?" + urlencode(params)

    print(f"\n🔎 {family_name}")
    print(f"   Query: {config['query']}")

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )

        response.raise_for_status()

        payload = response.json()

    except Exception as exc:
        print(f"   ❌ API request failed: {exc}")

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "error": str(exc),
        }

    raw_items = get_release_items(payload)

    normalized = []

    for item in raw_items:
        release = normalize_release(item)

        if release:
            normalized.append(release)

    if not normalized:
        print("   ❌ No usable upcoming releases returned")

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "error": "No usable release records returned",
        }

    # Exact title matching
    pattern = re.compile(
        config["title_regex"],
        re.IGNORECASE,
    )

    candidates = [
        item
        for item in normalized
        if pattern.search(item["title"])
    ]

    if not candidates:
        print("   ❌ No title match found")

        # Print useful debugging information
        for item in normalized[:10]:
            print(
                f"      candidate: "
                f"{item['release_date']} | {item['title']}"
            )

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "error": "No title regex match",
        }

    # Sort by date
    candidates.sort(
        key=lambda x: x["release_date"]
    )

    # Prefer the actual bulletin over "time series"
    non_timeseries = [
        x
        for x in candidates
        if "time series" not in x["title"].lower()
    ]

    if non_timeseries:
        selected = non_timeseries[0]
    else:
        selected = candidates[0]

    print(
        f"   ✅ {selected['next_release'] if 'next_release' in selected else selected['release_date']}"
        f" | {selected['title']}"
    )

    return {
        "success": True,
        "next_release": selected["release_date"],
        "next_release_at": selected.get("release_at"),
        "release_title": selected["title"],
        "release_uri": selected.get("uri"),
        "error": None,
    }


# ============================================================
# FETCH ALL FAMILY DATES
# ============================================================

def fetch_all_family_dates():
    family_results = {}

    total = len(RELEASE_FAMILIES)

    print("\n" + "=" * 70)
    print("FETCHING ONS RELEASE FAMILY DATES")
    print("=" * 70)

    for index, (family_name, config) in enumerate(
        RELEASE_FAMILIES.items(),
        start=1,
    ):
        print(f"\n[{index}/{total}]")

        family_results[family_name] = fetch_family_release(
            family_name,
            config,
        )

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return family_results


# ============================================================
# BUILD METRIC RESULTS
# ============================================================

def build_metric_results(family_results):

    results = []

    for metric_id, series_id in ONS_METRICS.items():

        family = METRIC_FAMILY[metric_id]

        family_result = family_results.get(family)

        if not family_result:
            results.append({
                "metric_id": metric_id,
                "series_id": series_id,
                "release_family": family,
                "next_release": None,
                "release_title": None,
                "success": False,
                "error": "Family result missing",
            })
            continue

        results.append({
            "metric_id": metric_id,
            "series_id": series_id,
            "release_family": family,
            "next_release": family_result.get("next_release"),
            "next_release_at": family_result.get("next_release_at"),
            "release_title": family_result.get("release_title"),
            "success": bool(
                family_result.get("success")
                and family_result.get("next_release")
            ),
            "error": family_result.get("error"),
        })

    return results


# ============================================================
# SAVE JSON
# ============================================================

def save_results(results, family_results):

    output = {
        "source": "ONS",
        "generated_at_utc": datetime.now(
            timezone.utc
        ).isoformat(),

        "total_metrics": len(results),

        "successful_metrics": sum(
            1
            for x in results
            if x["success"]
        ),

        "failed_metrics": sum(
            1
            for x in results
            if not x["success"]
        ),

        "family_results": family_results,

        "metrics": results,
    }

    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            output,
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(
        f"\n💾 Saved: {OUTPUT_FILE}"
    )


# ============================================================
# PRINT SUMMARY
# ============================================================

def print_summary(results):

    successful = [
        x for x in results
        if x["success"]
    ]

    failed = [
        x for x in results
        if not x["success"]
    ]

    print("\n" + "=" * 70)
    print("ONS CALENDAR SUMMARY")
    print("=" * 70)

    print(
        f"Total metrics : {len(results)}"
    )

    print(
        f"Successful    : {len(successful)}"
    )

    print(
        f"Failed        : {len(failed)}"
    )

    print("\nFamily dates:")

    seen = set()

    for item in results:

        family = item["release_family"]

        if family in seen:
            continue

        seen.add(family)

        print(
            f"  {family:25s} -> "
            f"{item['next_release']}"
        )

    if failed:

        print("\n❌ Failed metrics:")

        for item in failed:
            print(
                f"  - {item['metric_id']} "
                f"({item['series_id']}) "
                f"| family={item['release_family']} "
                f"| {item['error']}"
            )

    else:
        print(
            "\n✅ ALL METRICS HAVE A NEXT RELEASE DATE"
        )


# ============================================================
# MAIN
# ============================================================

def main():

    print(
        f"ONS metrics loaded: {len(ONS_METRICS)}"
    )

    print(
        f"ONS release families: {len(RELEASE_FAMILIES)}"
    )

    family_results = fetch_all_family_dates()

    results = build_metric_results(
        family_results
    )

    save_results(
        results,
        family_results,
    )

    print_summary(results)


if __name__ == "__main__":
    main()
