import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

import requests

from release_time_utils import combine_date_time


# ============================================================
# CONFIG
# ============================================================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/139.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json",
}

REQUEST_TIMEOUT = 30
OUTPUT_FILE = "ecb_fetch_results.json"

# Official ECB pages
ECB_STATS_CALENDAR_URL = (
    "https://www.ecb.europa.eu/press/calendars/statscal/html/index.en.html"
)

ECB_SPF_URL = (
    "https://www.ecb.europa.eu/stats/ecb_surveys/"
    "survey_of_professional_forecasters/html/index.en.html"
)

ECB_CES_URL = (
    "https://www.ecb.europa.eu/stats/ecb_surveys/"
    "consumer_exp_survey/html/index.en.html"
)

# ============================================================
# ECB METRICS
# ============================================================

ECB_METRICS = {
    "ea-safe-input-cost-exp-1y": "SAFE_INPUT_COST_EXP_1Y",
    "ea-safe-selling-price-exp-1y": "SAFE_SELLING_PRICE_EXP_1Y",
    "ea-spf-current-year": "SPF_HICP_CURRENT_YEAR",
    "ea-spf-hicp-1y": "SPF_HICP_P12M",
    "ea-wage-tracker": "EWT.M.U2.N.WT.INWS._T.4F0.GY",
    "ea-wage-tracker-ex-oneoff": "EWT.M.U2.N.WT.INWX._T.4F0.GY",
    "ea-inflation-exp-1y": "SPF_HICP_P12M",
    "ea-safe-wage-exp-1y": "SAFE_WAGE_EXP_1Y",
    "ea-ces-inflation-exp-1y": "CES_HICP_1Y",
    "ea-core-inflation-exp-1y": "SPF_CORE_P12M",
    "ea-spf-wage-exp-1y": "SPF_ASSU_LAB_P12M",
    "ea-inflation-exp-lt": "SPF_HICP_LT",
    "ea-ces-inflation-exp-3y": None,
    "ea-ces-inflation-exp-5y": None,
    "ea-ces-inflation-uncertainty": None,
    "ea-safe-inflation-exp-1y": None,
    "ea-safe-inflation-exp-3y": None,
    "ea-safe-inflation-exp-5y": None,
    "ea-spf-hicp-2y": None,
    "ea-spf-hicp-lt": None,
    "ea-spf-hicpx-1y": None,
    "ea-inflation-comp-1y": None,
    "ea-inflation-comp-2y": None,
    "ea-inflation-comp-5y": None,
    "ea-inflation-comp-10y": None,
    "ea-inflation-comp-5y5y": None,
}


# ============================================================
# RELEASE FAMILIES
#
# SPF:
#   all SPF horizons / inflation / core / wage assumptions
#
# CES:
#   all CES inflation expectation horizons + uncertainty
#
# SAFE:
#   all SAFE inflation and wage expectations
#
# INFLATION_COMPENSATION:
#   market-based ECB financial-market data.
#   These are not a scheduled survey release; they update
#   on a daily business-day basis.
# ============================================================

RELEASE_FAMILIES = {
    "WAGE_TRACKER": {
        "kind": "stats_calendar",
        "release_title": "ECB Wage Tracker",
        "source_url": ECB_STATS_CALENDAR_URL,
    },
    "SPF": {
        "kind": "web_page",
        "url": ECB_SPF_URL,
        "pattern": (
            r"next release will be published on\s+"
            r"(\d{1,2}\s+\w+\s+\d{4})"
        ),
        "date_format": "%d %B %Y",
        "release_title": "ECB Survey of Professional Forecasters",
        "source_url": ECB_SPF_URL,
    },

    "CES": {
        "kind": "web_page",
        "url": ECB_CES_URL,
        "pattern": (
            r"Next publication of CES results and press release:\s*"
            r"(\d{1,2}\s+\w+\s+\d{4})"
        ),
        "date_format": "%d %B %Y",
        "release_title": "ECB Consumer Expectations Survey",
        "source_url": ECB_CES_URL,
    },

    "SAFE": {
        "kind": "stats_calendar",
        "query": "Survey on the access to finance of enterprises",
        "release_title": "Survey on the access to finance of enterprises",
        "source_url": ECB_STATS_CALENDAR_URL,
    },

    "INFLATION_COMPENSATION": {
        "kind": "daily_market_data",
        "release_title": "ECB inflation compensation / market-based data",
        "source_url": "https://data.ecb.europa.eu/",
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


add_family(
    "SPF",
    [
        "ea-spf-current-year",
        "ea-spf-hicp-1y",
        "ea-inflation-exp-1y",
        "ea-core-inflation-exp-1y",
        "ea-spf-wage-exp-1y",
        "ea-inflation-exp-lt",
        "ea-spf-hicp-2y",
        "ea-spf-hicp-lt",
        "ea-spf-hicpx-1y",
    ],
)

add_family(
    "CES",
    [
        "ea-ces-inflation-exp-1y",
        "ea-ces-inflation-exp-3y",
        "ea-ces-inflation-exp-5y",
        "ea-ces-inflation-uncertainty",
    ],
)

add_family(
    "SAFE",
    [
        "ea-safe-input-cost-exp-1y",
        "ea-safe-selling-price-exp-1y",
        "ea-safe-wage-exp-1y",
        "ea-safe-inflation-exp-1y",
        "ea-safe-inflation-exp-3y",
        "ea-safe-inflation-exp-5y",
    ],
)

add_family(
    "WAGE_TRACKER",
    ["ea-wage-tracker", "ea-wage-tracker-ex-oneoff"],
)

add_family(
    "INFLATION_COMPENSATION",
    [
        "ea-inflation-comp-1y",
        "ea-inflation-comp-2y",
        "ea-inflation-comp-5y",
        "ea-inflation-comp-10y",
        "ea-inflation-comp-5y5y",
    ],
)


# ============================================================
# VALIDATION
# ============================================================

missing = sorted(set(ECB_METRICS) - set(METRIC_FAMILY))
extra = sorted(set(METRIC_FAMILY) - set(ECB_METRICS))

if missing:
    raise ValueError(
        "Metrics missing family mapping:\n" + "\n".join(missing)
    )

if extra:
    raise ValueError(
        "Family mapping contains unknown metrics:\n" + "\n".join(extra)
    )


# ============================================================
# HELPERS
# ============================================================

class TextExtractor(HTMLParser):
    """Small dependency-free HTML -> text extractor."""

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data and data.strip():
            self.parts.append(data.strip())

    def get_text(self):
        return " ".join(self.parts)


def fetch_text(url):
    response = requests.get(
        url,
        headers=HEADERS,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    parser = TextExtractor()
    parser.feed(response.text)

    return parser.get_text()


def parse_date(value, fmt):
    return datetime.strptime(value, fmt).date().isoformat()


def next_weekday(start_date=None):
    """
    Return next Monday-Friday date.

    Inflation compensation is market data, not a scheduled
    statistical bulletin. ECB financial-market series are
    updated on business days, so this is represented as the
    next business-day update rather than a fixed release event.
    """

    if start_date is None:
        d = datetime.now(timezone.utc).date()
    else:
        d = start_date

    d += timedelta(days=1)

    while d.weekday() >= 5:
        d += timedelta(days=1)

    return d.isoformat()


def extract_first_date_from_pattern(text, pattern, date_format):
    match = re.search(
        pattern,
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        return None

    return parse_date(
        match.group(1),
        date_format,
    )


# ============================================================
# FETCH SPF
# ============================================================

def fetch_spf():
    print("\n🔎 SPF")
    print(f"   {ECB_SPF_URL}")

    try:
        text = fetch_text(ECB_SPF_URL)

        date_value = extract_first_date_from_pattern(
            text,
            RELEASE_FAMILIES["SPF"]["pattern"],
            RELEASE_FAMILIES["SPF"]["date_format"],
        )

        if not date_value:
            raise RuntimeError(
                "Could not find SPF next-release date on official page."
            )

        print(
            f"   ✅ {date_value} | "
            f"{RELEASE_FAMILIES['SPF']['release_title']}"
        )

        return {
            "success": True,
            "next_release": date_value,
            "next_release_at": None,
            "release_title": RELEASE_FAMILIES["SPF"]["release_title"],
            "update_type": "scheduled_survey_release",
            "source_url": ECB_SPF_URL,
            "error": None,
        }

    except Exception as exc:
        print(f"   ❌ {exc}")

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "update_type": "scheduled_survey_release",
            "source_url": ECB_SPF_URL,
            "error": str(exc),
        }


# ============================================================
# FETCH CES
# ============================================================

def fetch_ces():
    print("\n🔎 CES")
    print(f"   {ECB_CES_URL}")

    try:
        text = fetch_text(ECB_CES_URL)

        date_value = extract_first_date_from_pattern(
            text,
            RELEASE_FAMILIES["CES"]["pattern"],
            RELEASE_FAMILIES["CES"]["date_format"],
        )

        if not date_value:
            raise RuntimeError(
                "Could not find CES next-publication date on official page."
            )

        print(
            f"   ✅ {date_value} | "
            f"{RELEASE_FAMILIES['CES']['release_title']}"
        )

        return {
            "success": True,
            "next_release": date_value,
            "next_release_at": None,
            "release_title": RELEASE_FAMILIES["CES"]["release_title"],
            "update_type": "scheduled_survey_release",
            "source_url": ECB_CES_URL,
            "error": None,
        }

    except Exception as exc:
        print(f"   ❌ {exc}")

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "update_type": "scheduled_survey_release",
            "source_url": ECB_CES_URL,
            "error": str(exc),
        }


# ============================================================
# FETCH SAFE FROM ECB STATISTICAL CALENDAR
# ============================================================

def fetch_safe():
    print("\n🔎 SAFE")
    print(f"   {ECB_STATS_CALENDAR_URL}")

    try:
        text = fetch_text(ECB_STATS_CALENDAR_URL)

        # The ECB statistical calendar currently uses dates like:
        # 26/10/2026 10:00
        # Survey on the access to finance of enterprises (Dataset: SAFE)
        #
        # We match the event title and capture the closest date
        # before it.
        pattern = re.compile(
            r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})"
            r"(?:(?!\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}).){0,500}?"
            r"Survey on the access to finance of enterprises"
            r"\s+\(Dataset:\s*SAFE\)",
            flags=re.IGNORECASE | re.DOTALL,
        )

        matches = list(pattern.finditer(text))

        today = datetime.now(timezone.utc).date()

        future_events = []

        for match in matches:
            d = datetime.strptime(
                match.group(1),
                "%d/%m/%Y",
            ).date()

            if d >= today:
                future_events.append(
                    (d, match.group(2))
                )

        if not future_events:
            raise RuntimeError(
                "No future SAFE event found in ECB statistical calendar."
            )

        selected_date, selected_time = min(
            future_events,
            key=lambda x: x[0],
        )

        selected = selected_date.isoformat()

        print(
            f"   ✅ {selected} | "
            f"{RELEASE_FAMILIES['SAFE']['release_title']}"
        )

        return {
            "success": True,
            "next_release": selected,
            "next_release_at": combine_date_time(
                selected_date,
                selected_time,
                "Europe/Berlin",
            ),
            "release_title": RELEASE_FAMILIES["SAFE"]["release_title"],
            "update_type": "scheduled_survey_release",
            "source_url": ECB_STATS_CALENDAR_URL,
            "error": None,
        }

    except Exception as exc:
        print(f"   ❌ {exc}")

        return {
            "success": False,
            "next_release": None,
            "release_title": None,
            "update_type": "scheduled_survey_release",
            "source_url": ECB_STATS_CALENDAR_URL,
            "error": str(exc),
        }


# ============================================================
# INFLATION COMPENSATION
# ============================================================

def fetch_inflation_compensation():
    print("\n🔎 INFLATION_COMPENSATION")

    print("   ℹ️ Market-data family; no announced scheduled release.")

    return {
        "success": True,
        "next_release": None,
        "next_release_at": None,
        "release_title": (
            RELEASE_FAMILIES["INFLATION_COMPENSATION"]["release_title"]
        ),
        "update_type": "daily_business_day",
        "source_url": RELEASE_FAMILIES[
            "INFLATION_COMPENSATION"
        ]["source_url"],
        "error": None,
        "note": (
            "Market-based inflation compensation is not a "
            "quarterly/monthly scheduled survey release. "
            "The dashboard should refresh this family on "
            "business days rather than wait for a bulletin date."
        ),
    }


# ============================================================
# FETCH ALL FAMILY DATES
# ============================================================

def fetch_wage_tracker():
    """Accept an EWT announcement only, never the separate INW release."""
    result = {
        "success": False,
        "next_release": None,
        "next_release_at": None,
        "release_title": "ECB Wage Tracker",
        "update_type": "scheduled_statistical_release",
        "source_url": ECB_STATS_CALENDAR_URL,
        "status": "not_announced",
        "error": None,
        "note": "No future ECB Wage Tracker event announced in the official statistical calendar.",
    }
    try:
        text = fetch_text(ECB_STATS_CALENDAR_URL)
        pattern = re.compile(
            r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})"
            r"(?:(?!\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}).){0,500}?"
            r"(?:ECB\s+)?Wage Tracker\s+\(Dataset:\s*EWT\)",
            re.I | re.S,
        )
        today = datetime.now(timezone.utc).date()
        candidates = []
        for match in pattern.finditer(text):
            release_date = datetime.strptime(match.group(1), "%d/%m/%Y").date()
            if release_date >= today:
                candidates.append((release_date, match.group(2)))
        if candidates:
            release_date, release_time = min(candidates)
            result.update({
                "success": True,
                "next_release": release_date.isoformat(),
                "next_release_at": combine_date_time(release_date, release_time, "Europe/Berlin"),
                "status": "success",
                "note": None,
            })
    except Exception as exc:
        result.update({"status": "error", "error": str(exc), "note": None})
    return result


def fetch_all_family_dates():
    return {
        "WAGE_TRACKER": fetch_wage_tracker(),
        "SPF": fetch_spf(),
        "CES": fetch_ces(),
        "SAFE": fetch_safe(),
        "INFLATION_COMPENSATION": fetch_inflation_compensation(),
    }


# ============================================================
# BUILD METRIC RESULTS
# ============================================================

def build_metric_results(family_results):
    results = []

    for metric_id, ecb_id in ECB_METRICS.items():

        family = METRIC_FAMILY[metric_id]
        family_result = family_results[family]

        results.append({
            "metric_id": metric_id,
            "ecb_id": ecb_id,
            "release_family": family,
            "next_release": family_result.get("next_release"),
            "next_release_at": family_result.get("next_release_at"),
            "release_title": family_result.get("release_title"),
            "update_type": family_result.get("update_type"),
            "status": family_result.get("status"),
            "source_url": family_result.get("source_url"),
            "success": bool(
                family_result.get("success")
                and family_result.get("next_release")
            ),
            "error": family_result.get("error"),
            "note": family_result.get("note"),
        })

    return results


# ============================================================
# SAVE JSON
# ============================================================

def save_results(results, family_results):

    output = {
        "source": "ECB",
        "generated_at_utc": datetime.now(
            timezone.utc
        ).isoformat(),

        "total_metrics": len(results),

        "successful_metrics": sum(
            1 for x in results if x["success"]
        ),

        "failed_metrics": sum(
            1 for x in results if not x["success"]
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

    print(f"\n💾 Saved: {OUTPUT_FILE}")


# ============================================================
# SUMMARY
# ============================================================

def print_summary(results):

    successful = [
        x for x in results if x["success"]
    ]

    failed = [
        x for x in results if not x["success"]
    ]

    print("\n" + "=" * 70)
    print("ECB CALENDAR SUMMARY")
    print("=" * 70)

    print(f"Total metrics : {len(results)}")
    print(f"Successful    : {len(successful)}")
    print(f"Failed        : {len(failed)}")

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
                f"({item['ecb_id']}) "
                f"| family={item['release_family']} "
                f"| {item['error']}"
            )
    else:
        print("\n✅ ALL METRICS HAVE A NEXT UPDATE DATE")


# ============================================================
# MAIN
# ============================================================

def main():

    print(
        f"ECB metrics loaded: {len(ECB_METRICS)}"
    )

    print(
        f"Release families: {len(RELEASE_FAMILIES)}"
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
