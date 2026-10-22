# fetch_all_fred_bls_release_dates.py

import json
import os
from pathlib import Path
import requests
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup

from release_time_utils import combine_date_time, extract_release_time


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
    # Canonical catalog IDs as well as legacy component aliases.
    "us-cpi-yoy": {"release_family": "CPI"},
    "us-core-cpi-yoy": {"release_family": "CPI"},
    "us-core-cpi-mom": {"release_family": "CPI"},

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
    "us-ppi-final-demand-mom": {"release_family": "PPI"},
    "us-ppi-core-mom": {"release_family": "PPI"},

    "us-ppi-goods-yoy": {"release_family": "PPI"},
    "us-ppi-foods-yoy": {"release_family": "PPI"},
    "us-ppi-energy-yoy": {"release_family": "PPI"},
    "us-ppi-goods-ex-food-energy-yoy": {"release_family": "PPI"},
    "us-ppi-services-yoy": {"release_family": "PPI"},
    "us-ppi-services-ex-trade-yoy": {"release_family": "PPI"},
    "us-ppi-construction-yoy": {"release_family": "PPI"},
    "us-ppi-goods-mom": {"release_family": "PPI"},
    "us-ppi-foods-mom": {"release_family": "PPI"},
    "us-ppi-energy-mom": {"release_family": "PPI"},
    "us-ppi-goods-ex-food-energy-mom": {"release_family": "PPI"},
    "us-ppi-services-mom": {"release_family": "PPI"},
    "us-ppi-services-ex-trade-mom": {"release_family": "PPI"},
    "us-ppi-construction-mom": {"release_family": "PPI"},
    "us-ppi-final-demand-trade-yoy": {"release_family": "PPI"},
    "us-ppi-final-demand-trade-mom": {"release_family": "PPI"},
    "us-ppi-final-demand-transport-yoy": {"release_family": "PPI"},
    "us-ppi-final-demand-transport-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-1-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-1-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-2-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-2-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-3-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-3-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-4-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-stage-4-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-processed-goods-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-processed-goods-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-unprocessed-goods-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-unprocessed-goods-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-services-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-services-mom": {"release_family": "PPI"},
    "us-ppi-intermediate-construction-yoy": {"release_family": "PPI"},
    "us-ppi-intermediate-construction-mom": {"release_family": "PPI"},


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

PPI_MANIFEST = Path(__file__).resolve().parents[1] / 'src' / 'catalog' / 'us-ppi-series.json'
for series in json.loads(PPI_MANIFEST.read_text(encoding='utf-8'))['series']:
    metric_id = ('us-ppi-final-demand' if series['key'] == 'headline' else
                 'us-ppi-core' if series['key'] == 'core' else f"us-ppi-{series['key']}-yoy")
    mom_id = ('us-ppi-final-demand-mom' if series['key'] == 'headline' else
              'us-ppi-core-mom' if series['key'] == 'core' else f"us-ppi-{series['key']}-mom")
    BLS_METRICS[metric_id] = {'release_family': 'PPI'}
    BLS_METRICS[mom_id] = {'release_family': 'PPI'}

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
    "Manufacturers' Shipments, Inventories, and Orders": "10:00",
    "Empire State Manufacturing Survey": "08:30",
}

BLS_RELEASE_TIMEZONE = "America/New_York"

CENSUS_M3_URL = "https://www.census.gov/manufacturing/m3/release_schedule.html"
BLS_TIME_SOURCE = "https://www.bls.gov/schedule/news_release/"
BLS_PPI_SCHEDULE_URL = "https://www.bls.gov/schedule/news_release/ppi.htm"
BLS_SCHEDULE_URLS = {
    "CPI": "https://www.bls.gov/schedule/news_release/cpi.htm",
    "PPI": BLS_PPI_SCHEDULE_URL,
}
RELEASE_TIME_SOURCES = {
    family: BLS_TIME_SOURCE for family in (
        "CPI", "PPI", "Employment Situation", "JOLTS",
        "Productivity and Costs", "Employment Cost Index",
        "U.S. Import and Export Price Indexes",
    )
}
RELEASE_TIME_SOURCES["PPI"] = BLS_PPI_SCHEDULE_URL
RELEASE_TIME_SOURCES.update({
    "New Residential Construction": "https://www.census.gov/construction/nrc/about_the_surveys/release_schedule.html",
    "Advance Report on Durable Goods": CENSUS_M3_URL,
    "Manufacturers' Shipments, Inventories, and Orders": CENSUS_M3_URL,
    "Empire State Manufacturing Survey": "https://www.newyorkfed.org/survey/empire/empiresurvey_overview.html",
})


def parse_census_m3_schedule(html, today=None):
    """Use each official M3 column's dates/time, leaving TBD unpublished."""
    today = today or date.today()
    out = {}
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [c.get_text(" ", strip=True) for c in rows[0].find_all(["td", "th"])]
        families = {}
        for column, label in enumerate(headers):
            if "Advance Report on Durable Goods" in label:
                families[column] = "Advance Report on Durable Goods"
            elif "Full Report" in label:
                families[column] = "Manufacturers' Shipments, Inventories, and Orders"
        for row in rows[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
            for column, family in families.items():
                if column >= len(cells):
                    continue
                try:
                    release_date = datetime.strptime(cells[column], "%m/%d/%Y").date()
                except ValueError:
                    continue
                if release_date < today:
                    continue
                item = {
                    "next_release": release_date.isoformat(),
                    "next_release_at": combine_date_time(release_date, extract_release_time(headers[column]), BLS_RELEASE_TIMEZONE),
                    "release_name": family,
                    "official_source": CENSUS_M3_URL,
                    "official_evidence": " | ".join(cells) + " | " + headers[column],
                }
                if family not in out or item["next_release"] < out[family]["next_release"]:
                    out[family] = item
    return out


def parse_bls_schedule(html, family, today=None, now=None):
    """Read only dated BLS schedule rows, advancing after the publication time."""
    if now is None and today is None:
        now = datetime.now(timezone.utc)
    today = today or now.astimezone(ZoneInfo(BLS_RELEASE_TIMEZONE)).date()
    soup = BeautifulSoup(html, "html.parser")
    result = None
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [cell.get_text(" ", strip=True).lower() for cell in rows[0].find_all(["th", "td"])]
        if not any("reference month" in value for value in headers) or not any("release date" in value for value in headers):
            continue
        for row in rows[1:]:
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
            if len(cells) < 3:
                continue
            release_text = cells[1].replace(".", "")
            try:
                release_date = datetime.strptime(release_text, "%b %d, %Y").date()
            except ValueError:
                try:
                    release_date = datetime.strptime(release_text, "%B %d, %Y").date()
                except ValueError:
                    continue
            if release_date < today:
                continue
            release_at = combine_date_time(release_date, extract_release_time(cells[2]), BLS_RELEASE_TIMEZONE)
            if now and release_at and datetime.fromisoformat(release_at) <= now:
                continue
            item = {
                "next_release": release_date.isoformat(),
                "next_release_at": release_at,
                "release_name": RELEASE_NAME_MAP[family],
                "official_source": BLS_SCHEDULE_URLS[family],
                "official_evidence": " | ".join(cells),
            }
            if result is None or item["next_release"] < result["next_release"]:
                result = item
    return {family: result} if result else {}


def parse_bls_ppi_schedule(html, today=None, now=None):
    return parse_bls_schedule(html, "PPI", today=today, now=now)


def fetch_official_family_dates():
    dates = {}
    for family, url in BLS_SCHEDULE_URLS.items():
        try:
            response = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            response.raise_for_status()
            parsed = parse_bls_schedule(response.text, family)
            if not parsed:
                raise RuntimeError("No future dated release row in the official schedule")
            dates.update(parsed)
        except Exception as exc:
            dates[family] = {
                "next_release": None, "next_release_at": None,
                "release_name": RELEASE_NAME_MAP[family], "official_source": url,
                "error": f"Official BLS schedule fetch/parse failed: {exc}",
            }
    return dates

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

    return min(future_dates)


# ============================================================
# MAIN
# ============================================================

def collect_family_dates():
    family_dates = fetch_official_family_dates()
    try:
        releases = find_release_ids()
    except Exception as exc:
        print(f"FRED release lookup unavailable; keeping official schedules: {exc}")
        releases = {}
    try:
        response = requests.get(CENSUS_M3_URL, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        family_dates.update(parse_census_m3_schedule(response.text))
    except Exception as exc:
        print(f"Census M3 schedule unavailable: {exc}")
    for family, release_info in releases.items():

        if family in family_dates:
            continue

        if family == "PPI":
            family_dates[family] = {
                **release_info,
                "next_release": None,
                "next_release_at": None,
                "official_source": BLS_PPI_SCHEDULE_URL,
                "error": "Official BLS PPI release schedule could not be read; no secondary date fallback used.",
            }
            continue

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


    return family_dates


def main():
    family_dates = collect_family_dates()

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
            "next_release_at": next_release_at,
            "official_source": family_info.get("official_source", family_info.get("release_link")),
            "official_evidence": family_info.get("official_evidence"),
            "error": family_info.get("error"),
            "official_time_source": RELEASE_TIME_SOURCES.get(family),
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
