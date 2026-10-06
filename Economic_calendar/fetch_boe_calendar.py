
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from html.parser import HTMLParser

from release_time_utils import extract_release_time, combine_date_time


# ============================================================
# CONFIG
# ============================================================

OUTPUT_FILE = "boe_fetch_results.json"

BOE_BASE = "https://www.bankofengland.co.uk"
BOE_LATEST_URL = BOE_BASE + "/news/latest-and-upcoming"
BOE_IAS_SITEMAP = BOE_BASE + "/sitemap/inflation-attitudes-survey"
BOE_MARKETS_SITEMAP = BOE_BASE + "/sitemap/markets"
BOE_AGENTS_SITEMAP = BOE_BASE + "/sitemap/agents-summary"
BOE_RELEASE_TIMEZONE = "Europe/London"

# Official BoE statistical release convention: 09:30 UK unless
# the publication explicitly states a different time.
# IAS/DMP/Agents are covered by this convention.
# MaPS is left explicit-only because its pages do not publish a
# standard release time in the source text.
BOE_STANDARD_RELEASE_TIME_BY_FAMILY = {
    "IAS": "09:30",
    "DMP": "09:30",
    "AGENTS": "09:30",
}

TIMEOUT = (5, 15)

# Limit how many publication pages are opened after sitemap discovery.
# This prevents a historical sitemap from causing a long serial crawl.
MAX_SITEMAP_CANDIDATES = 6
MAX_LATEST_CANDIDATES = 6

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120 Safari/537.36"
    )
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ============================================================
# METRICS
# ============================================================

METRICS = [
    {"metric": "uk-inflation-exp-1y", "id": "IAS_Q2A", "family": "IAS"},
    {"metric": "uk-inflation-exp-5y", "id": "IAS_Q2C", "family": "IAS"},
    {"metric": "uk-dmp-wage-growth-3m", "id": "DMP_WAGE_REALISED_3M", "family": "DMP"},
    {"metric": "uk-dmp-wage-exp-1y-3m", "id": "DMP_WAGE_EXPECTED_3M", "family": "DMP"},
    {"metric": "uk-dmp-wage-exp-1y", "id": None, "family": "DMP"},
    {"metric": "uk-agents-pay-settlement-exp-1y", "id": None, "family": "AGENTS"},
    {"metric": "uk-inflation-exp-2y", "id": None, "family": "IAS"},
    {"metric": "uk-citi-yougov-inflation-exp-1y", "id": None, "family": "CITI_YOUGOV"},
    {"metric": "uk-citi-yougov-inflation-exp-5-10y", "id": None, "family": "CITI_YOUGOV"},
    {"metric": "uk-dmp-inflation-exp-1y", "id": None, "family": "DMP"},
    {"metric": "uk-dmp-inflation-exp-3y", "id": None, "family": "DMP"},
    {"metric": "uk-dmp-own-price-exp-1y", "id": None, "family": "DMP"},
    {"metric": "uk-maps-inflation-1y", "id": None, "family": "MAPS"},
    {"metric": "uk-maps-inflation-2y", "id": None, "family": "MAPS"},
    {"metric": "uk-maps-inflation-3y", "id": None, "family": "MAPS"},
    {"metric": "uk-maps-inflation-5y", "id": None, "family": "MAPS"},
    {"metric": "uk-inflation-comp-1y", "id": None, "family": "INFLATION_COMPENSATION"},
    {"metric": "uk-inflation-comp-5y", "id": None, "family": "INFLATION_COMPENSATION"},
    {"metric": "uk-inflation-comp-10y", "id": None, "family": "INFLATION_COMPENSATION"},
    {"metric": "uk-inflation-comp-5y5y", "id": None, "family": "INFLATION_COMPENSATION"},
]


# ============================================================
# HTML UTILITIES
# ============================================================

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.href = None
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        attrs = dict(attrs)
        self.href = attrs.get("href")
        self.parts = []

    def handle_data(self, data):
        if self.href is not None:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "a" or self.href is None:
            return

        title = " ".join("".join(self.parts).split())
        href = self.href

        if href and href.startswith("/"):
            href = urljoin(BOE_BASE, href)

        if href and href.startswith(BOE_BASE) and title:
            self.links.append({"title": title, "url": href})

        self.href = None
        self.parts = []


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data)


def fetch_html(url):
    response = SESSION.get(url, timeout=TIMEOUT)
    response.raise_for_status()
    return response.text


def request_page(url):
    """Fetch a BoE page with a bounded connection/read timeout."""
    return fetch_html(url)


def extract_links(html):
    parser = LinkParser()
    parser.feed(html)
    return parser.links


def html_to_text(html):
    parser = TextParser()
    parser.feed(html)
    return " ".join(" ".join(parser.parts).split())


# ============================================================
# DATE EXTRACTION
# ============================================================

MONTHS = (
    "January|February|March|April|May|June|July|August|"
    "September|October|November|December"
)

DATE_PATTERN = rf"\d{{1,2}}\s+(?:{MONTHS})\s+\d{{4}}"
ISO_DATE_PATTERN = r"20\d{2}-\d{2}-\d{2}"

DATE_RE = re.compile(DATE_PATTERN, re.IGNORECASE)
ISO_DATE_RE = re.compile(ISO_DATE_PATTERN)


def parse_date(value):
    value = value.strip()

    for fmt in ("%d %B %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass

    return None


def explicit_release_date(text):
    """
    Return a date ONLY when the official page explicitly states a
    future release/publication date.

    No cadence calculation.
    No adding weeks/months.
    No inference.
    """

    patterns = [
        rf"next\s+release\s+date[^.]{{0,220}}?"
        rf"(?:will\s+be|is|:)\s*({DATE_PATTERN})",

        rf"next\s+(?:publication|release)\s+date[^.]{{0,220}}?"
        rf"(?:will\s+be|is|:)\s*({DATE_PATTERN})",

        rf"will\s+be\s+published\s+on\s*:?\s*({DATE_PATTERN})",

        rf"published\s+on\s+({DATE_PATTERN})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)

        if match:
            parsed = parse_date(match.group(1))

            if parsed and parsed >= date.today():
                return parsed

    for raw in ISO_DATE_RE.findall(text):
        parsed = parse_date(raw)

        if parsed and parsed >= date.today():
            return parsed

    return None


def explicit_date_phrase(text):
    """
    Return the official sentence containing the release date so the
    JSON can be audited later.
    """

    patterns = [
        rf"[^.]*next\s+(?:publication|release)\s+date[^.]*"
        rf"{DATE_PATTERN}[^.]*\.",

        rf"[^.]*will\s+be\s+published\s+on[^.]*"
        rf"{DATE_PATTERN}[^.]*\.",

        rf"[^.]*published\s+on[^.]*"
        rf"{DATE_PATTERN}[^.]*\.",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)

        if match:
            return " ".join(match.group(0).split())

    return None


def explicit_release_time(text):
    """
    Extract a publication time only when the official page ties it
    explicitly to the publication/release statement.
    """
    patterns = [
        r"(?:will\s+be\s+published|published|publication|release)"
        r".{0,250}?\bat\s+"
        r"(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))",
        r"(?:release|publication).{0,250}?\("
        r"(\d{1,2}:\d{2})\)",
    ]

    for pattern in patterns:
        match = re.search(
            pattern,
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            return extract_release_time(match.group(1))

    return None


# ============================================================
# OFFICIAL BOE DISCOVERY
# ============================================================

def latest_boe_links(keyword_groups):
    """
    Search the official BoE latest/upcoming page and return ALL matching
    publication links.

    We deliberately do not assume the first matching link is the current
    publication. The page ordering can change, and multiple historical or
    upcoming entries can match the same family.
    """

    html = fetch_html(BOE_LATEST_URL)
    links = extract_links(html)

    candidates = []
    seen = set()

    for item in links:
        title = item["title"].lower()

        matched = any(
            all(keyword.lower() in title for keyword in group)
            for group in keyword_groups
        )

        if matched and item["url"] not in seen:
            seen.add(item["url"])
            candidates.append(item)

    return candidates


def fetch_explicit_next_date_from_page(url, family=None):
    text = html_to_text(fetch_html(url))

    release_date = explicit_release_date(text)
    evidence = explicit_date_phrase(text)
    release_time = explicit_release_time(
        evidence or text
    )

    # If the page gives only the date, use the official BoE standard
    # release time for families where that convention applies.
    if not release_time and family in BOE_STANDARD_RELEASE_TIME_BY_FAMILY:
        release_time = BOE_STANDARD_RELEASE_TIME_BY_FAMILY[family]

    return {
        "date": release_date,
        "release_time": release_time,
        "release_at": combine_date_time(
            release_date,
            release_time,
            "Europe/London",
        ),
        "source_url": url,
        "evidence": evidence,
    }


def title_period(title):
    """Extract a sortable year/month from a publication title when present.

    Examples: "November 2026", "September 2026",
    or "18 September 2026".
    Returns None when no year/month is present.
    """
    month_map = {
        name.lower(): index
        for index, name in enumerate(
            (
                "January", "February", "March", "April",
                "May", "June", "July", "August",
                "September", "October", "November", "December",
            ),
            start=1,
        )
    }

    match = re.search(
        rf"(?:{DATE_PATTERN}|(?:{MONTHS})\s+20\d{{2}})",
        title,
        re.IGNORECASE,
    )
    if not match:
        return None

    value = match.group(0)
    year_match = re.search(r"20\d{2}", value)
    month_match = re.search(
        rf"(?:{MONTHS})",
        value,
        re.IGNORECASE,
    )

    if not year_match or not month_match:
        return None

    return (
        int(year_match.group(0)),
        month_map[month_match.group(0).lower()],
    )


def filter_future_sitemap_candidates(candidates):
    """Keep only current/future titled entries and sort nearest first.

    Historical sitemap entries are never opened. If a title has no
    detectable period, it is kept only as a small fallback set.
    """
    today = date.today()
    current_period = (today.year, today.month)

    dated = []
    undated = []

    for item in candidates:
        period = title_period(item["title"])
        if period is None:
            undated.append(item)
            continue

        if period >= current_period:
            dated.append((period, item))

    dated.sort(key=lambda x: x[0])

    selected = [item for _, item in dated[:MAX_SITEMAP_CANDIDATES]]

    # Only use undated entries if there were no usable dated entries.
    if not selected:
        selected = undated[:MAX_SITEMAP_CANDIDATES]

    return selected


def discover_future_release_from_sitemap(sitemap_url, title_keywords, family=None):
    """
    Search an official BoE sitemap without crawling its historical archive.

    The sitemap itself contains entries going back many years. We first
    identify current/future publication titles, then inspect only a small
    bounded number of the nearest candidates. A date is accepted ONLY if
    the official publication page explicitly states it.
    """

    html = fetch_html(sitemap_url)
    links = extract_links(html)

    candidates = []
    seen = set()

    for item in links:
        title = item["title"].lower()

        if all(k.lower() in title for k in title_keywords):
            if item["url"] not in seen:
                seen.add(item["url"])
                candidates.append(item)

    candidates = filter_future_sitemap_candidates(candidates)

    if not candidates:
        return None

    print(f"  inspecting {len(candidates)} current/future sitemap candidate(s)")

    future = []

    for item in candidates:
        try:
            print(f"    -> {item['title']}")
            result = fetch_explicit_next_date_from_page(item["url"], family=family)

            if result["date"] and result["date"] >= date.today():
                future.append(
                    {
                        "date": result["date"],
                        "release_time": result.get("release_time"),
                        "release_at": result.get("release_at"),
                        "source_url": item["url"],
                        "evidence": result["evidence"],
                        "title": item["title"],
                    }
                )

        except requests.RequestException as exc:
            print(f"    request failed: {exc}")
            continue

    if not future:
        return None

    future.sort(key=lambda x: x["date"])
    return future[0]


# ============================================================
# FAMILY FETCHERS
# ============================================================

def fetch_ias_date():
    """
    IAS:
    Find the next IAS publication page in the official BoE sitemap
    and read the date explicitly stated on that page.
    """

    return discover_future_release_from_sitemap(
        BOE_IAS_SITEMAP,
        ["inflation attitudes survey"],
        family="IAS",
    )


def fetch_latest_family_explicit_date(keyword_groups):
    """
    Resolve a family from the official BoE Latest & Upcoming page.

    Only a bounded set of the most recent matching publication entries is
    opened, so a change in page ordering cannot create a long serial crawl.
    """

    items = latest_boe_links(keyword_groups)
    if not items:
        return None

    dated = []
    undated = []

    for item in items:
        period = title_period(item["title"])
        if period is None:
            undated.append(item)
        else:
            dated.append((period, item))

    dated.sort(key=lambda x: x[0], reverse=True)
    selected = [item for _, item in dated[:MAX_LATEST_CANDIDATES]]

    if not selected:
        selected = undated[:MAX_LATEST_CANDIDATES]

    print(f"  inspecting {len(selected)} recent publication candidate(s)")

    candidates = []

    for item in selected:
        try:
            print(f"    -> {item['title']}")
            result = fetch_explicit_next_date_from_page(item["url"], family=family)
            if result["date"] and result["date"] >= date.today():
                candidates.append(
                    {
                        "date": result["date"],
                        "release_time": result.get("release_time"),
                        "release_at": result.get("release_at"),
                        "source_url": result["source_url"],
                        "evidence": result["evidence"],
                        "title": item["title"],
                    }
                )
        except requests.RequestException as exc:
            print(f"    request failed: {exc}")
            continue

    if not candidates:
        return None

    candidates.sort(key=lambda x: x["date"])
    return candidates[0]


def fetch_monthly_boE_page_date(path_prefix, title_prefix, months_ahead=4, family=None):
    """
    Inspect the current month and a few following monthly publication URLs
    directly. This is used for families whose future publication page can
    exist before publication and therefore does not reliably appear in the
    Latest & Upcoming listing.

    Only an explicit future publication date written on the official page is
    accepted. No date is calculated from historical frequency.
    """

    today = date.today()
    candidates = []

    for offset in range(months_ahead + 1):
        year = today.year + (today.month - 1 + offset) // 12
        month = (today.month - 1 + offset) % 12 + 1
        month_name = date(year, month, 1).strftime("%B").lower()
        url = f"{BOE_BASE}{path_prefix}/{year}/{month_name}-{year}"
        candidates.append((year, month, url))

    print(f"  inspecting {len(candidates)} monthly publication URL candidate(s)")

    future = []

    for year, month, url in candidates:
        try:
            print(f"    -> {title_prefix} {date(year, month, 1).strftime('%B')} {year}")
            result = fetch_explicit_next_date_from_page(url, family=family)

            if result["date"] and result["date"] >= today:
                future.append(
                    {
                        "date": result["date"],
                        "release_time": result.get("release_time"),
                        "release_at": result.get("release_at"),
                        "source_url": result["source_url"],
                        "evidence": result["evidence"],
                        "title": f"{title_prefix} {date(year, month, 1).strftime('%B')} {year}",
                    }
                )

        except requests.RequestException:
            continue

    if not future:
        return None

    future.sort(key=lambda x: x["date"])
    return future[0]


def fetch_dmp_date():
    """
    DMP:
    The Bank's current/future DMP pages can exist before publication, so
    inspect the current month and a few following monthly URLs directly.
    The page itself explicitly states the publication date.
    """

    return fetch_monthly_boE_page_date(
        "/decision-maker-panel",
        "Monthly Decision Maker Panel data",
        months_ahead=4,
        family="DMP",
    )


def fetch_agents_date():
    """
    Agents:
    Inspect all matching official Agents' Summary publication pages and
    return the nearest future date explicitly announced by the Bank.
    """

    return discover_future_release_from_sitemap(
        BOE_AGENTS_SITEMAP,
        ["agents summary of business conditions"],
        family="AGENTS",
    )


def fetch_maps_date():
    """
    MaPS / Market Participants Survey:

    Search the official BoE Markets sitemap for a future survey-results
    page and accept only a date explicitly published by the Bank.

    We deliberately do NOT calculate a date from MPC dates.
    """

    return discover_future_release_from_sitemap(
        BOE_MARKETS_SITEMAP,
        ["market participants survey results"],
        family="MAPS",
    )


def fetch_citi_yougov_date():
    """
    Citi/YouGov is not a BoE publication.

    Do not infer a monthly release date from historical frequency.
    Do not use Reuters/Bloomberg/other secondary sources.

    If Citi or YouGov publishes an official future release date,
    this function can be connected to that official source.

    Until an official future date exists, return None.
    """

    return None


def fetch_inflation_compensation_date():
    """
    Inflation compensation is market-based rather than a scheduled
    BoE statistical publication.

    Therefore there is no scheduled release date to calculate.
    """

    return None


# ============================================================
# FAMILY DISPATCH
# ============================================================

def fetch_family_dates():
    family_dates = {}

    print("\nFetching official next-release dates...\n")

    fetchers = {
        "IAS": fetch_ias_date,
        "DMP": fetch_dmp_date,
        "AGENTS": fetch_agents_date,
        "CITI_YOUGOV": fetch_citi_yougov_date,
        "MAPS": fetch_maps_date,
        "INFLATION_COMPENSATION": fetch_inflation_compensation_date,
    }

    for family, fetcher in fetchers.items():
        print(f"{family}...")

        try:
            family_dates[family] = fetcher()
        except Exception as exc:
            print(f"  ERROR: {exc}")
            family_dates[family] = None

    return family_dates


# ============================================================
# BUILD RESULTS
# ============================================================

def build_results(family_dates):
    results = []

    for metric in METRICS:
        family = metric["family"]
        family_result = family_dates.get(family)

        if family_result:
            release_date = family_result["date"]
            status = "success"
            source_url = family_result.get("source_url")
            evidence = family_result.get("evidence")

        else:
            release_date = None
            source_url = None
            evidence = None

            if family == "INFLATION_COMPENSATION":
                status = "not_scheduled"
            elif family == "CITI_YOUGOV":
                status = "not_announced"
            else:
                status = "not_found"

        results.append(
            {
                "metric": metric["metric"],
                "id": metric["id"],
                "family": family,
                "next_release": (
                    release_date.isoformat()
                    if release_date
                    else None
                ),
                "next_release_at": (
                    family_result.get("release_at")
                    if family_result
                    else None
                ),
                "status": status,
                "official_source": source_url,
                "official_evidence": evidence,
            }
        )

    return results


# ============================================================
# MAIN
# ============================================================

def main():
    print("BoE metrics loaded:", len(METRICS))

    family_dates = fetch_family_dates()

    print("\nFamily release dates:\n")

    for family in sorted(family_dates):
        result = family_dates[family]

        if result:
            print(f"{family} -> {result['date'].isoformat()}")

            if result.get("release_time"):
                print(f"   Release time: {result['release_time']} {BOE_RELEASE_TIMEZONE}")

            if result.get("evidence"):
                print(f"   {result['evidence']}")

            if result.get("source_url"):
                print(f"   {result['source_url']}")

        else:
            print(f"{family} -> NOT AVAILABLE")

    results = build_results(family_dates)

    successful = sum(
        1
        for result in results
        if result["status"] == "success"
    )

    not_scheduled = sum(
        1
        for result in results
        if result["status"] == "not_scheduled"
    )

    not_announced = sum(
        1
        for result in results
        if result["status"] == "not_announced"
    )

    not_found = sum(
        1
        for result in results
        if result["status"] == "not_found"
    )

    output = {
        "source": "Bank of England / official publisher pages only",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rule": (
            "next_release is populated only when an official source "
            "explicitly publishes the future release/publication date; "
            "no dates are calculated or inferred"
        ),
        "total_metrics": len(results),
        "successful": successful,
        "not_scheduled": not_scheduled,
        "not_announced": not_announced,
        "not_found": not_found,
        "family_dates": {
            family: (
                result["date"].isoformat()
                if result
                else None
            )
            for family, result in family_dates.items()
        },
        "results": results,
    }

    Path(OUTPUT_FILE).write_text(
        json.dumps(
            output,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("\n--------------------------------")
    print("Total metrics:", len(results))
    print("Official dates:", successful)
    print("Not scheduled:", not_scheduled)
    print("Not announced:", not_announced)
    print("Not found:", not_found)
    print("--------------------------------")
    print(f"\nSaved -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
