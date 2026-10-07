"""
Evergreen Census Bureau calendar fetcher for US retail-sales metrics.

Family:
    US_RETAIL_SALES

Official sources used at runtime:
1) Census Monthly Retail Trade release schedule
2) Census Economic Indicator Release Schedule (List View) as fallback

No release date or year is hardcoded.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime

from release_time_utils import extract_release_time, combine_date_time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from bs4 import BeautifulSoup


RELEASE_SCHEDULE_URL = "https://www.census.gov/retail/release_schedule.html"
ECONOMIC_CALENDAR_URL = "https://www.census.gov/economic-indicators/calendar-listview.html"

OUTPUT_FILE = Path("census_retail_fetch_results.json")
TIMEOUT = 20

METRICS = [
    {
        "metric_id": "us-retail-sales",
        "metric": "US Retail Sales — Total",
        "census_id": "44X72",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-sales-ex-auto",
        "metric": "US Retail Sales — Total ex Autos",
        "census_id": "44X72",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-motor-vehicles",
        "metric": "US Retail Sales — Motor Vehicles",
        "census_id": "441",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-gasoline",
        "metric": "US Retail Sales — Gasoline Stations",
        "census_id": "447",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-food-beverage",
        "metric": "US Retail Sales — Food & Beverage",
        "census_id": "445",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-general-merchandise",
        "metric": "US Retail Sales — General Merchandise",
        "census_id": "452",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-nonstore",
        "metric": "US Retail Sales — Nonstore",
        "census_id": "454",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-food-services",
        "metric": "US Retail Sales — Food Services",
        "census_id": "722",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-sales-total",
        "metric": "US Retail Sales — Total",
        "census_id": "44X72",
        "family": "US_RETAIL_SALES",
    },
    {
        "metric_id": "us-retail-total-ex-auto-gas",
        "metric": "US Retail Sales — Total ex Autos & Gas",
        "census_id": "44W72",
        "family": "US_RETAIL_SALES",
    },
]


class TableParser(HTMLParser):
    """Collect HTML table rows without third-party packages."""

    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.current_cell = []
        self.current_row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()

        if tag == "table":
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag):
        tag = tag.lower()

        if tag in ("td", "th") and self.in_cell:
            self.current_row.append(
                " ".join("".join(self.current_cell).split())
            )
            self.current_cell = []
            self.in_cell = False

        elif tag == "tr" and self.in_row:
            if self.current_row:
                self.rows.append(self.current_row)
            self.current_row = []
            self.in_row = False

        elif tag == "table":
            self.in_table = False

    def handle_data(self, data):
        if self.in_table and self.in_row and self.in_cell:
            self.current_cell.append(data)


class TextParser(HTMLParser):
    """Extract visible text in document order as a fallback."""

    SKIP_TAGS = {"script", "style", "noscript"}

    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.SKIP_TAGS:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in self.SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth:
            text = " ".join(data.split())
            if text:
                self.parts.append(text)

    def text(self):
        return " ".join(self.parts)


def fetch_html(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/131 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )

    with urlopen(request, timeout=TIMEOUT) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_date(value: str) -> date | None:
    match = re.search(
        r"\b("
        r"January|February|March|April|May|June|July|August|"
        r"September|October|November|December"
        r")\s+(\d{1,2}),\s+(\d{4})\b",
        value,
        flags=re.IGNORECASE,
    )

    if not match:
        return None

    try:
        return datetime.strptime(
            f"{match.group(1)} {match.group(2)} {match.group(3)}",
            "%B %d %Y",
        ).date()
    except ValueError:
        return None


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def is_advance_retail_label(text: str) -> bool:
    text = normalize(text).lower()
    return (
        "advance monthly retail trade report" in text
        or "advance monthly sales for retail and food services" in text
    )


def extract_from_release_schedule(html: str) -> list[dict]:
    """
    Parse the dedicated Monthly Retail Trade release schedule.

    The Census page currently exposes rows such as:
      September 2026 | October 15, 2026
    under Advance Monthly Retail Trade Report.
    """
    candidates = []
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find(lambda tag: tag.name in ("h1", "h2", "h3", "h4") and is_advance_retail_label(tag.get_text(" ", strip=True)))
    table = heading.find_next("table") if heading else None
    if table is None:
        return []
    header_time = extract_release_time(table.find("tr").get_text(" ", strip=True)) if table.find("tr") else None
    for tr in table.find_all("tr"):
        row = [cell.get_text(" ", strip=True) for cell in tr.find_all(["td", "th"])]
        row_text = " | ".join(row)

        dates = [parse_date(cell) for cell in row]
        dates = [d for d in dates if d is not None]

        if not dates:
            continue

        # A release row has the release date as the date that is closest
        # to the report row. Use the first parsed date in the row.
        release_date = dates[-1]

        candidates.append(
            {
                "date": release_date,
                "release_time": extract_release_time(row_text) or header_time,
                "report_type": "Advance Monthly Retail Trade Report",
                "source": RELEASE_SCHEDULE_URL,
                "evidence": f"Advance Monthly Retail Trade Report | {row_text} | Release time {header_time}",
            }
        )

    return candidates


def extract_from_calendar_listview(html: str) -> list[dict]:
    """
    Fallback parser for the Census Economic Indicator Calendar.

    It looks for the exact Census indicator title and the release date
    in the same table row.
    """
    parser = TableParser()
    parser.feed(html)

    candidates = []

    for row in parser.rows:
        row_text = " | ".join(row)

        if "advance monthly sales for retail and food services" not in row_text.lower():
            continue

        dates = [parse_date(cell) for cell in row]
        dates = [d for d in dates if d is not None]

        if not dates:
            continue

        candidates.append(
            {
                "date": dates[0],
                "release_time": extract_release_time(row_text),
                "report_type": "Advance Monthly Sales for Retail and Food Services",
                "source": ECONOMIC_CALENDAR_URL,
                "evidence": row_text,
            }
        )

    return candidates


def extract_from_plain_text(html: str) -> list[dict]:
    """
    Last-resort parser.

    This is useful if Census changes table markup but keeps the visible
    schedule text. It searches for the Advance Monthly Retail Trade section
    and date pairs without depending on a particular table structure.
    """
    parser = TextParser()
    parser.feed(html)
    text = parser.text()

    # The schedule section is followed by Monthly Retail Trade Report.
    section_match = re.search(
        r"Advance Monthly Retail Trade Report(.*?)(?:Monthly Retail Trade Report|Quarterly Retail E-Commerce Report)",
        text,
        flags=re.IGNORECASE,
    )

    if not section_match:
        return []

    section = section_match.group(1)

    # Census displays month/year followed by the release date.
    pattern = re.compile(
        r"\b("
        r"January|February|March|April|May|June|July|August|"
        r"September|October|November|December"
        r")\s+\d{4}\s+"
        r"("
        r"January|February|March|April|May|June|July|August|"
        r"September|October|November|December"
        r")\s+\d{1,2},\s+\d{4}\b",
        flags=re.IGNORECASE,
    )

    results = []

    for match in pattern.finditer(section):
        release_date = parse_date(match.group(0))

        if release_date:
            results.append(
                {
                    "date": release_date,
                    "release_time": extract_release_time(section),
                    "report_type": "Advance Monthly Retail Trade Report",
                    "source": RELEASE_SCHEDULE_URL,
                    "evidence": match.group(0),
                }
            )

    return results


def choose_next(candidates: list[dict]) -> dict | None:
    today = date.today()

    future = [
        item for item in candidates
        if item["date"] >= today
    ]

    if not future:
        return None

    return min(future, key=lambda item: item["date"])


def find_next_release() -> dict:
    errors = []

    # Primary: dedicated retail release schedule.
    try:
        html = fetch_html(RELEASE_SCHEDULE_URL)

        candidates = extract_from_release_schedule(html)

        # If table markup changes, use visible-text fallback on the same
        # official page.
        if not candidates:
            candidates = extract_from_plain_text(html)

        selected = choose_next(candidates)

        if selected:
            return {
                "date": selected["date"].isoformat(),
                "release_time": selected.get("release_time"),
                "release_at": combine_date_time(
                    selected["date"],
                    selected.get("release_time"),
                    "America/New_York",
                ),
                "report_type": selected["report_type"],
                "official_source": selected["source"],
                "official_evidence": selected["evidence"],
            }

    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        errors.append(f"release schedule: {exc}")

    # Fallback: official Census Economic Indicator calendar.
    try:
        html = fetch_html(ECONOMIC_CALENDAR_URL)
        candidates = extract_from_calendar_listview(html)
        selected = choose_next(candidates)

        if selected:
            return {
                "date": selected["date"].isoformat(),
                "release_time": selected.get("release_time"),
                "release_at": combine_date_time(
                    selected["date"],
                    selected.get("release_time"),
                    "America/New_York",
                ),
                "report_type": selected["report_type"],
                "official_source": selected["source"],
                "official_evidence": selected["evidence"],
            }

    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        errors.append(f"economic calendar: {exc}")

    detail = "; ".join(errors)

    raise RuntimeError(
        "No future Census retail release date could be parsed from the "
        f"official schedules. {detail}"
    )


def main():
    print(f"US Census retail metrics loaded: {len(METRICS)}")
    print("\nFetching official next-release date...\n")

    release = find_next_release()

    print("US_RETAIL_SALES...")
    print(f"  {release['report_type']} -> {release['date']}")
    print(f"  {release['official_evidence']}")
    print(f"  {release['official_source']}")

    results = [
        {
            **metric,
            "next_release_date": release["date"],
            "next_release_at": release.get("release_at"),
            "official_source": release["official_source"],
            "official_evidence": release["official_evidence"],
        }
        for metric in METRICS
    ]

    payload = {
        "source": "US Census Bureau",
        "source_family": "Monthly Retail Trade",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "family_release_dates": {
            "US_RETAIL_SALES": release["date"]
        },
        "metrics": results,
    }

    OUTPUT_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print("\n--------------------------------")
    print(f"Total metrics: {len(METRICS)}")
    print(f"Official dates: {len(results)}")
    print("--------------------------------")
    print(f"Saved -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
