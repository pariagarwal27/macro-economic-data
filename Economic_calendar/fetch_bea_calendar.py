
import json
import re
import requests
from datetime import datetime, date
from bs4 import BeautifulSoup

from release_time_utils import extract_release_time, combine_date_time


# ============================================================
# CONFIG
# ============================================================

BEA_SCHEDULE_URL = "https://www.bea.gov/news/schedule"

OUTPUT_FILE = "bea_fetch_results.json"


# ============================================================
# YOUR METRICS
# ============================================================

METRICS = {

    # --------------------------------------------------------
    # BLS CPI - NOT BEA
    # --------------------------------------------------------

    "us-cpi-other-services": {
        "series_id": "CUSR0000SAS367",
        "release_family": "BLS CPI",
        "source": "BLS"
    },


    # --------------------------------------------------------
    # BEA PERSONAL INCOME AND OUTLAYS / PCE
    # --------------------------------------------------------

    "us-pce": {
        "series_id": "T20804:1",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-core-pce": {
        "series_id": "T20804:25",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-goods": {
        "series_id": "T20804:2",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-durable-goods": {
        "series_id": "T20804:3",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-furnishings": {
        "series_id": "T20804:5",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-clothing": {
        "series_id": "T20804:10",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-food": {
        "series_id": "T20804:9",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-energy": {
        "series_id": "T20804:11",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-services": {
        "series_id": "T20804:13",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-household-services": {
        "series_id": "T20804:14",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-healthcare": {
        "series_id": "T20804:16",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-food-services": {
        "series_id": "T20804:19",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-pce-housing": {
        "series_id": "T20804:29",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-core-pce-mom": {
        "series_id": "T20804:25",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },

    "us-personal-spending": {
        "series_id": "T20600:1",
        "release_family": "Personal Income and Outlays",
        "source": "BEA"
    },


    # --------------------------------------------------------
    # BLS PRODUCTIVITY - NOT BEA
    # --------------------------------------------------------

    "us-unit-labor-cost": {
        "series_id": "ULCNFB",
        "release_family": "BLS Productivity",
        "source": "BLS"
    },


    # --------------------------------------------------------
    # BEA GDP / NIPA
    # --------------------------------------------------------

    "us-real-pce-growth": {
        "series_id": "T10106:2",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-gdp-real": {
        "series_id": "T10101:1",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-pce-goods": {
        "series_id": "T10106:3",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-pce-durable-goods": {
        "series_id": "T10106:4",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-pce-nondurable-goods": {
        "series_id": "T10106:5",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-pce-services": {
        "series_id": "T10106:6",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-private-investment": {
        "series_id": "T10106:7",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-fixed-investment": {
        "series_id": "T10106:8",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-nonresidential-investment": {
        "series_id": "T10106:9",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-structures": {
        "series_id": "T10106:10",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-equipment": {
        "series_id": "T10106:11",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-ipp": {
        "series_id": "T10106:12",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-residential-investment": {
        "series_id": "T10106:13",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-inventories": {
        "series_id": "T10106:14",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-net-exports": {
        "series_id": "T10106:15",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-exports": {
        "series_id": "T10106:16",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-export-goods": {
        "series_id": "T10106:17",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-export-services": {
        "series_id": "T10106:18",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-imports": {
        "series_id": "T10106:19",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-import-goods": {
        "series_id": "T10106:20",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-import-services": {
        "series_id": "T10106:21",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-government": {
        "series_id": "T10106:22",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-federal-government": {
        "series_id": "T10106:23",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-defense": {
        "series_id": "T10106:24",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-nondefense": {
        "series_id": "T10106:25",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },

    "us-real-state-local": {
        "series_id": "T10106:26",
        "release_family": "GDP / NIPA",
        "source": "BEA"
    },


    # --------------------------------------------------------
    # NOT BEA
    # --------------------------------------------------------

    "ea-inflation-comp-5y5y": {
        "series_id": "EA_INFL_COMP_5Y5Y",
        "release_family": "Not BEA",
        "source": "Other"
    },
}


# ============================================================
# BEA RELEASE FAMILY KEYWORDS
# ============================================================

FAMILY_KEYWORDS = {

    "Personal Income and Outlays": [
        "Personal Income and Outlays"
    ],

    "GDP / NIPA": [
        "GDP",
        "Gross Domestic Product"
    ]
}


# ============================================================
# DATE PARSER
# ============================================================

MONTHS = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12
}


def extract_schedule_year(soup, fallback_year=None):
    """Extract the calendar year shown by the BEA schedule page."""
    page_text = soup.get_text(" ", strip=True)

    matches = re.findall(r"\bYear\s+(20\d{2})\b", page_text, flags=re.IGNORECASE)
    if matches:
        # Prefer the first explicit schedule year.
        return int(matches[0])

    # Some BEA page variants may omit the heading in extracted text.
    # The caller only uses this fallback for the dynamically selected
    # current/next-year schedule pages.
    return fallback_year


def parse_date(text, schedule_year=None):
    """
    Parse a BEA schedule date using the year belonging to the schedule page.

    The old implementation used datetime.now().year, which could silently
    assign the wrong year when BEA exposes a next-year schedule.
    """
    if not text or not schedule_year:
        return None

    text = text.strip()

    match = re.search(
        r"(January|February|March|April|May|June|July|August|"
        r"September|October|November|December)\s+"
        r"(\d{1,2})",
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        return None

    month_name = match.group(1).title()
    day = int(match.group(2))

    month = MONTHS[month_name]

    try:
        return date(int(schedule_year), month, day)
    except ValueError:
        return None


# ============================================================
# FETCH BEA SCHEDULE
# ============================================================

def fetch_schedule_page(url, fallback_year=None):
    """Fetch one official BEA schedule page and parse its rows."""
    response = requests.get(
        url,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    schedule_year = extract_schedule_year(
        soup,
        fallback_year=fallback_year,
    )

    if not schedule_year:
        raise RuntimeError(
            f"Could not determine schedule year from BEA page: {url}"
        )

    schedule = []

    tables = soup.find_all("table")

    for table in tables:
        rows = table.find_all("tr")

        for row in rows:
            cells = row.find_all(["td", "th"])

            values = [
                c.get_text(" ", strip=True)
                for c in cells
            ]

            if len(values) < 2:
                continue

            row_text = " ".join(values)
            release_date = parse_date(
                row_text,
                schedule_year=schedule_year,
            )

            if not release_date:
                continue

            release_time = extract_release_time(row_text)

            schedule.append({
                "date": release_date.isoformat(),
                "release_time": release_time,
                "release_at": combine_date_time(
                    release_date,
                    release_time,
                    "America/New_York",
                ),
                "text": row_text,
                "schedule_year": schedule_year,
                "schedule_url": url,
            })

    return schedule, schedule_year


def fetch_bea_schedule():
    """
    Fetch the current BEA schedule plus the official Next Year schedule.

    BEA publishes forthcoming release dates in advance and maintains a
    dedicated Next Year schedule. We discover the year dynamically rather
    than assuming datetime.now().year for every row.
    """
    print("\nFetching BEA official release schedule...")

    today = date.today()
    current_year = today.year

    current_schedule, detected_current_year = fetch_schedule_page(
        BEA_SCHEDULE_URL,
        fallback_year=current_year,
    )

    schedules = list(current_schedule)

    print(
        f"Current schedule year: {detected_current_year} | "
        f"rows: {len(current_schedule)}"
    )

    # BEA exposes a dedicated Next Year tab. Its URL is stable even though
    # the actual calendar year changes automatically.
    next_year_urls = [
        "https://www.bea.gov/news/schedule/next-year/next-year",
        f"https://www.bea.gov/news/schedule/full-{current_year + 1}/next-year",
    ]

    next_year_schedule = None

    for next_url in next_year_urls:
        try:
            parsed, detected_year = fetch_schedule_page(
                next_url,
                fallback_year=current_year + 1,
            )

            # Only accept a genuinely future schedule year.
            if detected_year > today.year:
                next_year_schedule = parsed
                print(
                    f"Next-year schedule year: {detected_year} | "
                    f"rows: {len(parsed)}"
                )
                break
        except Exception as exc:
            print(
                f"   Next-year schedule unavailable at {next_url}: {exc}"
            )

    if next_year_schedule:
        schedules.extend(next_year_schedule)

    return schedules


# ============================================================
# FIND NEXT RELEASE
# ============================================================

def find_next_release(
    schedule,
    family
):

    today = date.today()

    keywords = FAMILY_KEYWORDS.get(
        family,
        []
    )

    candidates = []

    for item in schedule:

        release_date = date.fromisoformat(
            item["date"]
        )

        if release_date < today:
            continue

        text = item["text"].lower()

        matched = False

        for keyword in keywords:

            if keyword.lower() in text:

                matched = True
                break

        if matched:

            candidates.append(
                item
            )

    if not candidates:
        return None

    candidates.sort(
        key=lambda x: x["date"]
    )

    return candidates[0]


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("BEA RELEASE CALENDAR FETCH")
    print("=" * 70)

    # --------------------------------------------------------
    # Fetch official BEA schedule
    # --------------------------------------------------------

    try:

        schedule = fetch_bea_schedule()

        print(
            f"Schedule rows found: {len(schedule)}"
        )

    except Exception as e:

        print(
            f"ERROR fetching BEA schedule: {e}"
        )

        return


    # --------------------------------------------------------
    # Find dates for BEA families
    # --------------------------------------------------------

    family_results = {}

    for family in [
        "Personal Income and Outlays",
        "GDP / NIPA"
    ]:

        result = find_next_release(
            schedule,
            family
        )

        family_results[family] = result

        print("\n" + "-" * 70)

        print(
            f"Family: {family}"
        )

        if result:

            print(
                f"Next release: {result['date']}"
            )

            print(
                f"Schedule row: {result['text']}"
            )

        else:

            print(
                "Next release: NOT FOUND"
            )


    # --------------------------------------------------------
    # Build metric-level results
    # --------------------------------------------------------

    results = {}

    for metric_id, info in METRICS.items():

        source = info["source"]
        family = info["release_family"]

        # ----------------------------------------------------
        # BEA metrics
        # ----------------------------------------------------

        if source == "BEA":

            family_result = family_results.get(
                family
            )

            if family_result:

                results[metric_id] = {

                    "success": True,

                    "metric_id": metric_id,

                    "series_id": info[
                        "series_id"
                    ],

                    "source": "BEA",

                    "release_family": family,

                    "next_release": family_result[
                        "date"
                    ],
                    "next_release_at": family_result.get(
                        "release_at"
                    )
                }

            else:

                results[metric_id] = {

                    "success": False,

                    "metric_id": metric_id,

                    "series_id": info[
                        "series_id"
                    ],

                    "source": "BEA",

                    "release_family": family,

                    "next_release": None,

                    "error": "BEA release not found"
                }


        # ----------------------------------------------------
        # Non-BEA metrics
        # ----------------------------------------------------

        else:

            results[metric_id] = {

                "success": False,

                "metric_id": metric_id,

                "series_id": info[
                    "series_id"
                ],

                "source": source,

                "release_family": family,

                "next_release": None,

                "error": (
                    "This metric is not released "
                    "by BEA. Use its original source "
                    "calendar."
                )
            }


    # --------------------------------------------------------
    # Save JSON
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
    # Summary
    # --------------------------------------------------------

    bea_metrics = [
        x
        for x in results.values()
        if x["source"] == "BEA"
    ]

    successful = sum(
        1
        for x in bea_metrics
        if x["success"]
    )

    failed = len(bea_metrics) - successful

    print("\n" + "=" * 70)

    print(
        f"Total metrics     : {len(results)}"
    )

    print(
        f"BEA metrics       : {len(bea_metrics)}"
    )

    print(
        f"BEA successful    : {successful}"
    )

    print(
        f"BEA failed        : {failed}"
    )

    print(
        f"Saved             : {OUTPUT_FILE}"
    )

    print("=" * 70)


if __name__ == "__main__":
    main()