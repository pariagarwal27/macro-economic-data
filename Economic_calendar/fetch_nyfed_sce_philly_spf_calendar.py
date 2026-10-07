"""
FINAL v2: New York Fed SCE + Philadelphia Fed SPF calendar fetcher.

Families:
    SCE          -> 14 metrics
    PHILLY_SPF   -> 10 metrics

Total:
    24 metrics

Uses the official New York Fed Economic Indicators Calendar.
No release date/year is hardcoded.

Output:
    nyfed_sce_philly_spf_fetch_results.json
"""

from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime

from release_time_utils import extract_release_time, combine_date_time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CALENDAR_BASE = "https://www.newyorkfed.org/research/calendars"
OUTPUT_FILE = Path("nyfed_sce_philly_spf_fetch_results.json")
TIMEOUT = 20
MONTHS_TO_CHECK = 15


SCE_METRICS = [
    {"metric_id": "us-nyfed-sce-inflation-exp-1y", "metric": "NY Fed SCE Inflation Expectations (1-Year)", "source_id": "SCE_INFLATION_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-inflation-exp-3y", "metric": "NY Fed SCE Inflation Expectations (3-Year)", "source_id": "SCE_INFLATION_3Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-inflation-exp-5y", "metric": "NY Fed SCE Inflation Expectations (5-Year)", "source_id": "SCE_INFLATION_5Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-1y", "metric": "NY Fed SCE Inflation Expectations 1-Year", "source_id": None, "family": "SCE"},
    {"metric_id": "us-nyfed-sce-3y", "metric": "NY Fed SCE Inflation Expectations 3-Year", "source_id": None, "family": "SCE"},
    {"metric_id": "us-nyfed-sce-5y", "metric": "NY Fed SCE Inflation Expectations 5-Year", "source_id": None, "family": "SCE"},
    {"metric_id": "us-nyfed-sce-1y-uncertainty", "metric": "NY Fed SCE Inflation Uncertainty 1-Year", "source_id": None, "family": "SCE"},
    {"metric_id": "us-nyfed-sce-labor-earnings-1y", "metric": "NY Fed SCE Earnings Growth Expectations (1-Year)", "source_id": "SCE_LABOR_EARNINGS_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-labor-job-separation-1y", "metric": "NY Fed SCE Job Separation Probability (1-Year)", "source_id": "SCE_LABOR_JOB_SEPARATION_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-labor-job-finding-1y", "metric": "NY Fed SCE Job Finding Probability (1-Year)", "source_id": "SCE_LABOR_JOB_FINDING_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-labor-unemployment-1y", "metric": "NY Fed SCE Unemployment Expectations (1-Year)", "source_id": "SCE_LABOR_UNEMPLOYMENT_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-finance-income-1y", "metric": "NY Fed SCE Household Income Growth Expectations (1-Year)", "source_id": "SCE_FINANCE_INCOME_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-finance-spending-1y", "metric": "NY Fed SCE Household Spending Growth Expectations (1-Year)", "source_id": "SCE_FINANCE_SPENDING_1Y", "family": "SCE"},
    {"metric_id": "us-nyfed-sce-finance-tax-1y", "metric": "NY Fed SCE Tax Change Expectations (1-Year)", "source_id": "SCE_FINANCE_TAX_1Y", "family": "SCE"},
]

PHILLY_SPF_METRICS = [
    {"metric_id": "us-philly-spf-cpi-1y", "metric": "Philadelphia Fed SPF CPI 1-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-core-cpi-1y", "metric": "Philadelphia Fed SPF Core CPI 1-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-pce-1y", "metric": "Philadelphia Fed SPF PCE 1-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-core-pce-1y", "metric": "Philadelphia Fed SPF Core PCE 1-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-cpi-5y", "metric": "Philadelphia Fed SPF CPI 5-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-pce-5y", "metric": "Philadelphia Fed SPF PCE 5-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-cpi-10y", "metric": "Philadelphia Fed SPF CPI 10-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-pce-10y", "metric": "Philadelphia Fed SPF PCE 10-Year", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-5y5y-cpi", "metric": "Philadelphia Fed SPF 5Y5Y Forward CPI", "source_id": None, "family": "PHILLY_SPF"},
    {"metric_id": "us-philly-spf-5y5y-pce", "metric": "Philadelphia Fed SPF 5Y5Y Forward PCE", "source_id": None, "family": "PHILLY_SPF"},
]

METRICS = SCE_METRICS + PHILLY_SPF_METRICS


class TextParser(HTMLParser):
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


def month_url(year: int, month: int) -> str:
    month_name = calendar.month_abbr[month].lower()
    return f"{CALENDAR_BASE}/i-{month_name}{str(year)[-2:]}.html"


def month_sequence(start: date, count: int):
    year, month = start.year, start.month
    for _ in range(count):
        yield year, month
        month += 1
        if month == 13:
            month = 1
            year += 1


def find_calendar_day(text: str, target: str) -> int | None:
    """
    Robustly find the calendar day immediately associated with a release.

    The NY Fed page is rendered roughly as:
        17 Advance Retail Sales ... Survey of Professional Forecasters (10:00)

    The previous implementation expected the day number to be at the very
    end of the text immediately before the target. That fails when several
    releases occur on the same day before the target. Here we instead search
    backwards for the most recent standalone 1- or 2-digit day marker.
    """
    positions = list(
        re.finditer(re.escape(target), text, flags=re.IGNORECASE)
    )

    for match in positions:
        before = text[max(0, match.start() - 500):match.start()]

        # Day markers are followed by a release title. Times such as 10:00
        # are not matched because the next character after the digits is ':'.
        day_matches = list(
            re.finditer(r"(?:^|\s)(\d{1,2})(?=\s+[A-Za-z])", before)
        )

        if not day_matches:
            continue

        # Walk backwards and accept the most recent plausible calendar day.
        for day_match in reversed(day_matches):
            day = int(day_match.group(1))
            if 1 <= day <= 31:
                return day

    return None


def extract_family_release(
    html: str,
    year: int,
    month: int,
    family: str,
) -> dict | None:

    targets = {
        "SCE": "Survey of Consumer Expectations",
        "PHILLY_SPF": "Survey of Professional Forecasters",
    }
    if family not in targets:
        raise ValueError(f"Unknown family: {family}")
    target = targets[family]
    return extract_calendar_release(html, year, month, target)


def extract_calendar_release(html: str, year: int, month: int, target: str) -> dict | None:
    day = None
    release_time = None
    # Each official calendar day is one table cell. Navigation links and
    # numbers in preceding releases cannot define this event's date.
    for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", html, re.I | re.S):
        cell_parser = TextParser()
        cell_parser.feed(cell)
        day_match = re.match(r"\s*(\d{1,2})\b", cell_parser.text())
        if not day_match:
            continue
        for entry in re.finditer(r"<a\b[^>]*>(.*?)</a>", cell, re.I | re.S):
            title_parser = TextParser()
            title_parser.feed(entry.group(1))
            if title_parser.text().strip().casefold() != target.casefold():
                continue
            day = int(day_match.group(1))
            # Only accept the time immediately following this title. Stop
            # before the next linked release, even within the same day.
            following = cell[entry.end():].split("<a", 1)[0]
            following_parser = TextParser()
            following_parser.feed(following)
            time_match = re.match(r"\s*\((\d{1,2}:\d{2})\)", following_parser.text())
            release_time = extract_release_time(time_match.group(1)) if time_match else None
            break
        if day is not None:
            break
    if day is None:
        return None

    try:
        release_date = date(year, month, day)
    except ValueError:
        return None

    return {
        "date": release_date,
        "release_time": release_time,
        "release_at": combine_date_time(
            release_date,
            release_time,
            "America/New_York",
        ),
        "release_name": target,
        "official_source": month_url(year, month),
        "official_evidence": (
            f"{release_date.strftime('%B %d, %Y')} — {target}"
        ),
    }


def find_next_family_release(family: str) -> dict:
    today = date.today()
    errors = []

    for year, month in month_sequence(today, MONTHS_TO_CHECK):
        url = month_url(year, month)

        try:
            html = fetch_html(url)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            errors.append(f"{url}: {exc}")
            continue

        result = extract_family_release(html, year, month, family)

        if result and result["date"] >= today:
            return {
                "date": result["date"].isoformat(),
                "release_time": result.get("release_time"),
                "release_at": result.get("release_at"),
                "release_name": result["release_name"],
                "official_source": result["official_source"],
                "official_evidence": result["official_evidence"],
            }

    detail = "; ".join(errors[-3:])
    raise RuntimeError(
        f"No future {family} release was found on the official "
        f"NY Fed Economic Indicators Calendar. {detail}"
    )


def attach_release_date(metrics: list[dict], release: dict) -> list[dict]:
    return [
        {
            **metric,
            "next_release_date": release["date"],
            "next_release_at": release.get("release_at"),
            "official_source": release["official_source"],
            "official_evidence": release["official_evidence"],
        }
        for metric in metrics
    ]


def main():
    print(f"Total metrics loaded: {len(METRICS)}")
    print("  SCE metrics: 14")
    print("  Philadelphia Fed SPF metrics: 10")
    print("\nFetching official next-release dates...\n")

    print("SCE...")
    sce_release = find_next_family_release("SCE")
    print(f"  Survey of Consumer Expectations -> {sce_release['date']}")
    print(f"  {sce_release['official_evidence']}")
    print(f"  {sce_release['official_source']}")

    print("\nPHILLY_SPF...")
    spf_release = find_next_family_release("PHILLY_SPF")
    print(f"  Survey of Professional Forecasters -> {spf_release['date']}")
    print(f"  {spf_release['official_evidence']}")
    print(f"  {spf_release['official_source']}")

    results = (
        attach_release_date(SCE_METRICS, sce_release)
        + attach_release_date(PHILLY_SPF_METRICS, spf_release)
    )

    payload = {
        "source": "Federal Reserve System",
        "calendar_source": "Federal Reserve Bank of New York Economic Indicators Calendar",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "family_release_dates": {
            "SCE": sce_release["date"],
            "PHILLY_SPF": spf_release["date"],
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
    print(f"SCE -> {sce_release['date']} (14 metrics)")
    print(f"PHILLY_SPF -> {spf_release['date']} (10 metrics)")
    print(f"Saved -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
