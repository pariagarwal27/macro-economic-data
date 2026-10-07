"""
Evergreen calendar fetcher for 37 special macro metrics.

Version 3 fixes over-escaped date regexes, scopes the Atlanta BIE parser to its release-date section, and uses browser-like HTTP headers for sources such as OECD.

Families:
- CLEVELAND_CPI
- CLEVELAND_SOFIE
- ATLANTA_CPI
- ATLANTA_WAGE
- ATLANTA_GDPNOW
- ATLANTA_BIE
- UMICH_CONSUMERS
- FED_G17
- FED_BREAKEVENS
- DALLAS_BUSINESS_ACTIVITY
- CHICAGO_CFNAI
- ADP_NER
- JOBLESS_CLAIMS
- OECD_CLI_BCI
- OECD_UNEMPLOYMENT

Principles:
- No release date/year is hardcoded.
- Family-level dates are assigned to all metrics in that family.
- Official schedules/pages are used where available.
- If an official future date is not announced, the result is null rather
  than an invented date.
- Daily/weekly series are explicitly marked as non-discrete schedules.

Output:
    special_us_macro_fetch_results.json
"""

from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from functools import lru_cache
from fetch_nyfed_sce_philly_spf_calendar import extract_calendar_release, month_url
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse

from release_time_utils import combine_date_time, extract_release_time


TIMEOUT = 20
OUTPUT_FILE = Path("special_us_macro_fetch_results.json")


METRICS = [
    # Cleveland Fed / SoFIE
    ("us-cleveland-median-cpi", "Cleveland Fed Median CPI YoY", "CLEVELAND_CPI"),
    ("us-cleveland-trimmed-cpi", "Cleveland Fed 16% Trimmed-Mean CPI", "CLEVELAND_CPI"),
    ("us-cleveland-inflation-exp-1y", "Cleveland Fed Expected Inflation 1-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-2y", "Cleveland Fed Expected Inflation 2-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-3y", "Cleveland Fed Expected Inflation 3-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-5y", "Cleveland Fed Expected Inflation 5-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-5-10y", "Cleveland Fed Expected Inflation 5–10 Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-10y", "Cleveland Fed Expected Inflation 10-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-inflation-exp-30y", "Cleveland Fed Expected Inflation 30-Year", "CLEVELAND_INFLATION_EXPECTATIONS"),
    ("us-cleveland-sofie-1y", "Cleveland Fed SoFIE Expected CPI Inflation 1-Year", "CLEVELAND_SOFIE"),
    ("us-cleveland-sofie-5y", "Cleveland Fed SoFIE Expected CPI Inflation 5-Year", "CLEVELAND_SOFIE"),

    # Atlanta Fed
    ("us-atlanta-sticky-cpi", "Atlanta Fed Sticky CPI YoY", "ATLANTA_CPI"),
    ("us-atlanta-core-sticky-cpi", "Atlanta Fed Core Sticky CPI YoY", "ATLANTA_CPI"),
    ("us-atlanta-flexible-cpi", "Atlanta Fed Flexible CPI YoY", "ATLANTA_CPI"),
    ("us-atlanta-wage-growth", "Atlanta Fed Wage Growth Tracker", "ATLANTA_WAGE"),
    ("us-gdpnow", "Atlanta Fed GDPNow", "ATLANTA_GDPNOW"),
    ("us-atlanta-bie-1y", "Atlanta Fed Business Inflation Expectations 1-Year", "ATLANTA_BIE"),
    ("us-atlanta-bie-unit-cost-1y", "Atlanta Fed BIE Expected Unit-Cost Growth 1-Year", "ATLANTA_BIE"),

    # University of Michigan
    ("us-umich-inflation-exp-1y", "UMich Expected Inflation 1-Year", "UMICH_CONSUMERS"),
    ("us-umich-inflation-exp-5y", "UMich Expected Inflation 5-Year", "UMICH_CONSUMERS"),
    ("us-umich-sentiment", "University of Michigan Consumer Sentiment", "UMICH_CONSUMERS"),

    # Federal Reserve Board
    ("us-breakeven-1y", "1-Year Breakeven Inflation Rate", "FED_BREAKEVENS"),
    ("us-breakeven-2y", "2-Year Breakeven Inflation Rate", "FED_BREAKEVENS"),
    ("us-breakeven-5y", "5-Year Breakeven Inflation Rate", "FED_BREAKEVENS"),
    ("us-breakeven-10y", "10-Year Breakeven Inflation Rate", "FED_BREAKEVENS"),
    ("us-breakeven-5y5y", "5Y5Y Forward Inflation Expectation", "FED_BREAKEVENS"),
    ("us-industrial-production", "Industrial Production YoY", "FED_G17"),
    ("us-capacity-utilization", "Capacity Utilization", "FED_G17"),

    # Regional Fed / private payroll
    ("us-dallas-business-activity", "Dallas Fed Business Activity Index", "DALLAS_BUSINESS_ACTIVITY"),
    ("us-chicago-cfnai", "Chicago Fed National Activity Index", "CHICAGO_CFNAI"),
    ("us-adp-employment-change", "ADP Nonfarm Private Employment Change", "ADP_NER"),
    ("us-adp-employment-level", "ADP Nonfarm Private Employment Level", "ADP_NER"),
    ("us-initial-jobless-claims", "Initial Jobless Claims", "JOBLESS_CLAIMS"),
    ("us-continuing-jobless-claims", "Continuing Jobless Claims", "JOBLESS_CLAIMS"),

    # OECD
    ("uk-oecd-cli", "UK OECD Composite Leading Indicator", "OECD_CLI_BCI"),
    ("uk-business-confidence", "UK Business Confidence", "OECD_CLI_BCI"),
    ("de-unemployment-rate", "Germany Unemployment Rate", "OECD_UNEMPLOYMENT"),
]


URLS = {
    "BLS_CPI": "https://www.bls.gov/schedule/news_release/cpi.htm",
    "CLEVELAND_INFLATION_EXPECTATIONS": "https://www.clevelandfed.org/indicators-and-data/inflation-expectations",
    "CLEVELAND_CPI": "https://www.clevelandfed.org/indicators-and-data/median-cpi",
    "CLEVELAND_SOFIE": "https://www.clevelandfed.org/indicators-and-data/survey-of-firms-inflation-expectations",
    "CLEVELAND_SITEMAP": "https://www.clevelandfed.org/ess-html-sitemap",
    "ATLANTA_CPI": "https://www.atlantafed.org/research-and-data/data/sticky-price-cpi",
    "ATLANTA_WAGE": "https://www.atlantafed.org/research-and-data/data/wage-growth-tracker",
    "ATLANTA_GDPNOW": "https://www.atlantafed.org/research-and-data/data/gdpnow",
    "ATLANTA_BIE": "https://www.atlantafed.org/research-and-data/surveys/business-inflation-expectations",
    "UMICH": "https://www.sca.isr.umich.edu/",
    "FED_CALENDAR_BASE": "https://www.federalreserve.gov/newsevents",
    "FED_G17": "https://www.federalreserve.gov/releases/g17/current/default.htm",
    "FED_BREAKEVENS": "https://www.federalreserve.gov/releases/h15/",
    "DALLAS": "https://www.dallasfed.org/research/surveys/tmos",
    "CHICAGO": "https://www.chicagofed.org/research/data/data-release-calendar",
    "ADP": "https://adpemploymentreport.com/",
    "DOL_CLAIMS": "https://oui.doleta.gov/unemploy/claims.asp",
    "OECD_CLI": "https://www.oecd.org/en/data/datasets/oecd-composite-leading-indicators-clis.html",
    "OECD_RELEASES": "https://www.oecd.org/en/data/insights/statistical-releases/release-dates-for-oecd-statistics-news-releases.html",
}


class TextParser(HTMLParser):
    SKIP = {"script", "style", "noscript"}

    def __init__(self):
        super().__init__()
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.SKIP:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag.lower() in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            s = " ".join(data.split())
            if s:
                self.parts.append(s)

    def text(self):
        return " ".join(self.parts)


def fetch(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/140.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        },
    )
    with urlopen(req, timeout=TIMEOUT) as r:
        enc = r.headers.get_content_charset() or "utf-8"
        return r.read().decode(enc, errors="replace")


def visible_text(html: str) -> str:
    p = TextParser()
    p.feed(html)
    return p.text()


def parse_month_day_year(s: str) -> date | None:
    patterns = [
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2}),?\s+(\d{4})\b",
        r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{4})\b",
    ]
    month_map = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }

    for p in patterns:
        m = re.search(p, s, re.I)
        if not m:
            continue

        try:
            if m.group(1).isdigit():
                day = int(m.group(1))
                month_text = m.group(2).rstrip(".").lower()[:3]
                year = int(m.group(3))
            else:
                month_text = m.group(1).rstrip(".").lower()[:3]
                day = int(m.group(2))
                year = int(m.group(3))

            if month_text in month_map:
                return date(year, month_map[month_text], day)
        except ValueError:
            pass

    return None


def next_date_from_bls_cpi() -> dict:
    html = fetch(URLS["BLS_CPI"])
    text = visible_text(html)
    today = date.today()

    # BLS schedule rows look like:
    # September 2026 | Oct. 14, 2026 | 08:30 AM
    # Parse every explicit release-date token and select the nearest future
    # one. The page is specifically the CPI schedule, so no other release
    # family can be selected.
    dates = []

    for m in re.finditer(
        r"\b(?:Jan\.?|Feb\.?|Mar\.?|Apr\.?|May|Jun\.?|Jul\.?|Aug\.?|"
        r"Sep\.?|Oct\.?|Nov\.?|Dec\.?|January|February|March|April|June|"
        r"July|August|September|October|November|December)\s+"
        r"\d{1,2},?\s+\d{4}\b",
        text,
        re.I,
    ):
        d = parse_month_day_year(m.group(0))
        if d and d >= today:
            dates.append(d)

    if not dates:
        raise RuntimeError("Could not parse future BLS CPI date.")

    d = min(dates)
    return result(
        d,
        URLS["BLS_CPI"],
        f"BLS Consumer Price Index release schedule: {d.isoformat()}",
        release_time="08:30",
        timezone_name="America/New_York",
    )


def fetch_cpi_derived(family: str) -> dict:
    d = date.fromisoformat(next_date_from_bls_cpi()["date"])
    descriptions = {
        "ATLANTA_CPI": "Atlanta Fed publishes sticky-price CPI by 11:00 a.m. ET on the CPI release day; this is a deadline, not an exact release time.",
        "CLEVELAND_CPI": "Cleveland Fed derives median/trimmed CPI from the monthly BLS CPI report; no exact publication time established.",
        "CLEVELAND_INFLATION_EXPECTATIONS": "Cleveland Fed runs the inflation expectations model on CPI release day and publishes before 4 p.m.; this is a deadline, not an exact release time.",
    }
    value = result(d, URLS[family], descriptions[family])
    if family in {"ATLANTA_CPI", "CLEVELAND_INFLATION_EXPECTATIONS"}:
        try:
            policy = visible_text(fetch(URLS[family]))
        except Exception:
            value["official_evidence"] = "BLS CPI release day confirmed; the provider's publication-time policy could not be retrieved."
            return value
        match = re.search(r"\b(by|before)\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)", policy, re.I)
        if match:
            value["release_deadline_at"] = combine_date_time(d, extract_release_time(match.group(2)), "America/New_York")
            value["release_time_kind"] = match.group(1).lower()
            value["official_evidence"] = f"BLS CPI release day confirmed; provider publication policy: {match.group(0)} Eastern time (deadline, not an exact release time)."
        else:
            value["official_evidence"] = "BLS CPI release day confirmed; no exact time or publication deadline was found on the provider page."
    return value


def result(
    d: date | None,
    source: str,
    evidence: str,
    status: str = "official_date",
    release_time: str | None = None,
    timezone_name: str | None = None,
) -> dict:
    return {
        "date": d.isoformat() if d else None,
        "next_release_at": combine_date_time(
            d,
            release_time,
            timezone_name,
        ),
        "status": status,
        "official_source": source,
        "official_evidence": evidence,
    }


def parse_explicit_next_update(text: str, label: str) -> date | None:
    # "Next update: September 30, 2026"
    m = re.search(
        r"Next\s+(?:update|release|data release)\s*:\s*"
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4})",
        text,
        re.I,
    )
    if m:
        return parse_month_day_year(m.group(1))

    # "Next data release: Friday, October 09, 2026"
    m = re.search(
        r"Next\s+data\s+release\s*:\s*(?:\w+,\s*)?"
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4})",
        text,
        re.I,
    )
    if m:
        return parse_month_day_year(m.group(1))

    return None


def fetch_gdpnow() -> dict:
    text = visible_text(fetch(URLS["ATLANTA_GDPNOW"]))
    d = parse_explicit_next_update(text, "GDPNow")
    if d:
        return result(d, URLS["ATLANTA_GDPNOW"], f"Atlanta Fed GDPNow: next update {d.isoformat()}")
    return result(None, URLS["ATLANTA_GDPNOW"], "No explicit future GDPNow update date found.", "not_announced")


@lru_cache(maxsize=24)
def fetch_nyfed_calendar(year: int, month: int) -> str:
    return fetch(month_url(year, month))


def result_with_calendar_time(d: date, source: str, evidence: str, titles: tuple[str, ...]) -> dict:
    try:
        html = fetch_nyfed_calendar(d.year, d.month)
        for title in titles:
            entry = extract_calendar_release(html, d.year, d.month, title)
            if entry and entry["date"] == d and entry.get("release_time"):
                return result(
                    d, entry["official_source"], evidence + "; " + entry["official_evidence"],
                    release_time=entry["release_time"], timezone_name="America/New_York",
                )
    except (HTTPError, URLError, TimeoutError, OSError):
        pass
    return result(d, source, evidence)


def fetch_umich() -> dict:
    text = visible_text(fetch(URLS["UMICH"]))
    m = re.search(
        r"Next\s+data\s+release:\s*(?:\w+,\s*)?"
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4})",
        text,
        re.I,
    )
    if m:
        d = parse_month_day_year(m.group(1))
        if d and d >= date.today():
            return result_with_calendar_time(d, URLS["UMICH"], f"University of Michigan Surveys of Consumers: next data release {d.isoformat()}", ("Michigan Consumer Survey (Preliminary)", "Michigan Consumer Survey (Final)"))
    return result(None, URLS["UMICH"], "No explicit future consumer-survey release date found.", "not_announced")


def fetch_bie() -> dict:
    html = fetch(URLS["ATLANTA_BIE"])
    text = visible_text(html)
    today = date.today()

    # Restrict parsing to the official "Survey Release Dates" section.
    # The page also contains many historical article dates, so scanning the
    # whole page can incorrectly select an unrelated date.
    marker = "Survey Release Dates"
    pos = text.lower().find(marker.lower())
    if pos < 0:
        return result(None, URLS["ATLANTA_BIE"], "Survey Release Dates section not found.", "not_announced")

    # Read only the explicitly labelled year schedule; linked articles
    # after it must not contribute candidate dates.
    schedule = re.search(
        rf"Survey Release Dates.*?<h[23]\b[^>]*>\s*(?:<strong>\s*)?{today.year}\s*(?:</strong>\s*)?</h[23]>(.*?)(?=<a\b|<h[1-6]\b|$)",
        html, re.I | re.S,
    )
    if not schedule:
        return result(None, URLS["ATLANTA_BIE"], "Current-year BIE schedule not found.", "not_announced")
    section = visible_text(schedule.group(1))
    year = today.year
    dates = []
    month_names = (
        "January|February|March|April|May|June|July|August|September|"
        "October|November|December"
    )
    for m in re.finditer(rf"\b({month_names})\s+(\d{{1,2}})\b", section, re.I):
        try:
            d = datetime.strptime(
                f"{m.group(1)} {m.group(2)} {year}", "%B %d %Y"
            ).date()
        except ValueError:
            continue
        if d >= today:
            dates.append(d)

    if dates:
        d = min(dates)
        return result(
            d,
            URLS["ATLANTA_BIE"],
            f"Atlanta Fed BIE Survey Release Dates section: {d.isoformat()}",
        )

    return result(None, URLS["ATLANTA_BIE"], "No future BIE release date parsed.", "not_announced")


def fetch_fed_g17() -> dict:
    today = date.today()

    for offset in range(0, 4):
        base_month = today.month - 1 + offset
        year = today.year + base_month // 12
        month = base_month % 12 + 1

        month_name = calendar.month_name[month].lower()
        url = f"{URLS['FED_CALENDAR_BASE']}/{year}-{month_name}.htm"

        try:
            html = fetch(url)
        except Exception:
            continue

        target = "G.17 - Industrial Production and Capacity Utilization"
        # Read the Board's title, release-date and time columns from the
        # same row. An absent date must not borrow another event's number.
        for candidate in re.finditer(
            r'<div\b[^>]*class="[^"]*col-xs-2[^"]*"[^>]*>(.*?)</div>\s*'
            r'<div\b[^>]*class="[^"]*col-xs-7[^"]*"[^>]*>(.*?)</div>\s*'
            r'<div\b[^>]*class="[^"]*col-xs-3[^"]*"[^>]*>(.*?)</div>',
            html, re.I | re.S,
        ):
            if visible_text(candidate.group(2)).strip().casefold() == target.casefold():
                entry = candidate
                break
        else:
            continue
        day_text = visible_text(entry.group(3)).strip()
        if not re.fullmatch(r"[0-9]{1,2}", day_text):
            continue
        day = int(day_text)
        release_time = extract_release_time(visible_text(entry.group(1)))

        try:
            d = date(year, month, day)
        except ValueError:
            continue

        if d >= today:
            return result(
                d,
                url,
                f"Federal Reserve Board G.17 calendar entry: {d.isoformat()}",
                release_time=release_time,
                timezone_name="America/New_York",
            )

    return result(
        None,
        URLS["FED_G17"],
        "No future G.17 calendar date parsed.",
        "not_announced",
    )


def fetch_dallas() -> dict:
    text = visible_text(fetch(URLS["DALLAS"]))
    today = date.today()

    # Search the official 2026 release-date table.
    for month_num in range(today.month, 13):
        month = calendar.month_name[month_num]
        pattern = (
            rf"\b{month}\b\s+"
            rf"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+"
            rf"{month}\s+(\d{{1,2}})"
        )
        m = re.search(pattern, text, re.I)
        if m:
            d = date(today.year, month_num, int(m.group(1)))
            if d > today:
                return result_with_calendar_time(d, URLS["DALLAS"], f"Dallas Fed Texas Manufacturing Outlook Survey next release date: {d.isoformat()}", ("Dallas Fed Manufacturing Survey",))

    return result(None, URLS["DALLAS"], "No future Dallas Fed TMOS date parsed.", "not_announced")


def fetch_chicago() -> dict:
    text = visible_text(fetch(URLS["CHICAGO"]))
    today = date.today()

    marker = "Chicago Fed National Activity Index (CFNAI) Releases"
    pos = text.lower().find(marker.lower())
    if pos < 0:
        return result(None, URLS["CHICAGO"], "CFNAI release section not found.", "not_announced")

    window = text[pos:]
    stop_markers = [
        "Chicago Fed Survey of Economic Conditions (CFSEC) Releases",
        "National Financial Conditions Index (NFCI) Releases",
    ]
    stops = [window.lower().find(x.lower()) for x in stop_markers]
    stops = [x for x in stops if x >= 0]
    if stops:
        window = window[:min(stops)]

    dates = []
    for m in re.finditer(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+\d{1,2},\s+\d{4}", window, re.I):
        d = parse_month_day_year(m.group(0))
        if d and d > today:
            dates.append(d)

    if dates:
        d = min(dates)
        return result(
            d,
            URLS["CHICAGO"],
            f"Chicago Fed CFNAI release calendar: {d.isoformat()}",
            release_time="08:30",
            timezone_name="America/New_York",
        )
    return result(None, URLS["CHICAGO"], "No future CFNAI date parsed.", "not_announced")

def fetch_adp_announcement() -> dict | None:
    listing_url = "https://mediacenter.adp.com/press-releases"
    html = fetch(listing_url)
    for link in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.I | re.S):
        title = visible_text(link.group(2))
        if not re.match(r"ADP National Employment Report:\s*Private[- ]Sector Employment", title, re.I):
            continue
        url = urljoin(listing_url, link.group(1))
        if urlparse(url).hostname != "mediacenter.adp.com":
            continue
        text = visible_text(fetch(url))
        announcement = re.search(
            r"ADP National Employment Report\s+will be released on\s+"
            r"([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+at\s+"
            r"(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*(?:ET|Eastern)",
            text, re.I,
        )
        if announcement:
            d = parse_month_day_year(announcement.group(1))
            if d and d >= date.today():
                return result(d, url, announcement.group(0), release_time=extract_release_time(announcement.group(2)), timezone_name="America/New_York")
        # The newest monthly release is enough; avoid stale announcements.
        break
    return None


def fetch_adp() -> dict:
    try:
        announcement = fetch_adp_announcement()
        if announcement:
            return announcement
    except (HTTPError, URLError, TimeoutError, OSError):
        pass
    # ADP publishes two calendars on the same page:
    #   1) monthly National Employment Report
    #   2) weekly NER pulse
    # We isolate the monthly block and support both human-readable and
    # ISO/date attributes so the parser survives minor HTML changes.
    html = fetch(URLS["ADP"])
    text = visible_text(html)
    today = date.today()

    def extract_calendar_block(source: str) -> str:
        low = source.lower()
        starts = [
            low.find("upcoming reports:"),
            low.find("upcoming reports"),
        ]
        starts = [x for x in starts if x >= 0]
        if not starts:
            return ""
        pos = min(starts)
        block = source[pos:]
        for marker in (
            "upcoming reports (weekly ner pulse)",
            "weekly ner pulse",
            "technical notes",
        ):
            stop = block.lower().find(marker)
            if stop > 0:
                block = block[:stop]
                break
        return block

    blocks = [extract_calendar_block(text), extract_calendar_block(html)]
    dates = []

    for section in blocks:
        if not section:
            continue

        # Human-readable dates, e.g. September 30, 2026
        for m in re.finditer(
            r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)"
            r"\s+\d{1,2}\s*,?\s+\d{4}\b",
            section,
            re.I,
        ):
            d = parse_month_day_year(m.group(0))
            if d and d > today:
                dates.append(d)

        # ISO dates, if the page exposes them in datetime/data attributes.
        for m in re.finditer(r"\b(20\d{2}-\d{2}-\d{2})\b", section):
            try:
                d = datetime.strptime(m.group(1), "%Y-%m-%d").date()
            except ValueError:
                continue
            if d > today:
                dates.append(d)

    if dates:
        d = min(set(dates))
        return result(
            d,
            URLS["ADP"],
            f"ADP National Employment Report monthly upcoming-report calendar: {d.isoformat()}",
        )

    return result(
        None,
        URLS["ADP"],
        "No future monthly ADP National Employment Report date parsed from the official calendar.",
        "not_announced",
    )


def fetch_oecd_cli_bci() -> dict:
    text = visible_text(fetch(URLS["OECD_CLI"]))
    today = date.today()
    low = text.lower()
    pos = low.find("dataset update dates")
    if pos < 0:
        return result(None, URLS["OECD_CLI"], "OECD CLI Dataset update dates section not found.", "not_announced")

    window = text[pos:]
    stop = window.lower().find("countries and area totals covered")
    if stop >= 0:
        window = window[:stop]

    dates = []
    for m in re.finditer(
        r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b",
        window, re.I):
        try:
            d = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %B %Y").date()
        except ValueError:
            continue
        if d >= today:
            dates.append(d)

    if dates:
        d = min(dates)
        value = result(d, URLS["OECD_CLI"], f"OECD CLI/BCI dataset update date: {d.isoformat()}")
        published_time = re.search(r"updated\s+at\s+(\d{1,2}:\d{2})\s+CET\b", window, re.I)
        if published_time:
            # Preserve the published CET rule (UTC+1), rather than assuming CEST.
            value["next_release_at"] = combine_date_time(d, published_time.group(1), "Etc/GMT-1")
            value["official_evidence"] += f"; OECD specifies {published_time.group(1)} CET for CLIs, standardised BCIs and CCIs."
        return value
    return result(None, URLS["OECD_CLI"], "No future OECD CLI/BCI update date parsed.", "not_announced")

def fetch_oecd_unemployment() -> dict:
    # The catalog ingests Germany's LRHUTTTTDEM156S from FRED (OECD
    # Main Economic Indicators), not the OECD aggregate unemployment
    # press release. That press calendar cannot establish when this
    # individual FRED series will update. FRED publishes no next date.
    return result(
        None,
        "https://fred.stlouisfed.org/series/LRHUTTTTDEM156S",
        "FRED LRHUTTTTDEM156S (OECD Main Economic Indicators): next release date unavailable; the OECD aggregate press calendar is not a series update schedule.",
        "not_announced",
    )


def weekly_claims_result() -> dict:
    today = date.today()

    # U.S. unemployment-insurance claims are released weekly on Thursday
    # at 08:30 ET.  IMPORTANT: keep TODAY when today is Thursday.
    #
    # The previous implementation always advanced Thursday -> next Thursday.
    # If the calendar was refreshed after 08:30 ET on release day, that caused
    # the current release to disappear from the calendar and the dispatcher
    # could jump straight to the following week's release.
    #
    # Keeping today's scheduled release for the whole Thursday is deliberate:
    # the release-dispatcher can then see it as due and either ingest it or
    # retry until the official value is available.  Starting Friday, the next
    # Thursday is used.
    if today.weekday() == 3:  # Thursday
        d = today
        evidence = (
            f"U.S. Department of Labor weekly Unemployment Insurance claims "
            f"cadence; release day: {d.isoformat()}"
        )
    else:
        days_until_thursday = (3 - today.weekday()) % 7
        d = today + timedelta(days=days_until_thursday)
        evidence = (
            f"U.S. Department of Labor weekly Unemployment Insurance claims "
            f"cadence; next Thursday: {d.isoformat()}"
        )

    return result(
        d,
        URLS["DOL_CLAIMS"],
        evidence,
        "weekly_cadence",
        release_time="08:30",
        timezone_name="America/New_York",
    )


def daily_result() -> dict:
    return result(
        None,
        URLS["FED_BREAKEVENS"],
        "Federal Reserve H.15 market rates are daily market-data series; no discrete future release date.",
        "daily_series",
    )


def sofie_result() -> dict:
    """
    Try to discover a future Cleveland Fed SoFIE press release from the
    official sitemap. If none exists yet, return not_announced.
    """
    try:
        text = visible_text(fetch(URLS["CLEVELAND_SITEMAP"]))
    except Exception:
        return result(None, URLS["CLEVELAND_SOFIE"], "Could not inspect Cleveland Fed sitemap.", "not_announced")

    today = date.today()
    dates = []

    # Sitemap contains URLs such as pr-20260810-... .
    for m in re.finditer(
        r"/collections/press-releases/(\d{4})/pr-(\d{8})-[^ \n]+",
        text,
        re.I,
    ):
        slug = m.group(0)
        if "survey-ceo-inflation-expectations" not in slug.lower():
            continue
        try:
            d = datetime.strptime(m.group(2), "%Y%m%d").date()
        except ValueError:
            continue
        if d >= today:
            dates.append((d, "https://www.clevelandfed.org" + slug))

    if dates:
        d, url = min(dates, key=lambda x: x[0])
        return result(d, url, f"Cleveland Fed SoFIE future press release discovered in official sitemap: {d.isoformat()}")

    return result(
        None,
        URLS["CLEVELAND_SOFIE"],
        "SoFIE is quarterly, but no future official publication date is currently announced on the discoverable Cleveland Fed sources.",
        "not_announced",
    )


def not_announced(source: str, evidence: str) -> dict:
    return result(None, source, evidence, "not_announced")


def main():
    print(f"Metrics loaded: {len(METRICS)}")
    print("\nFetching official next-release dates...\n")

    family_results = {}

    jobs = {
        "CLEVELAND_CPI": lambda: fetch_cpi_derived("CLEVELAND_CPI"),
        "CLEVELAND_INFLATION_EXPECTATIONS": lambda: fetch_cpi_derived("CLEVELAND_INFLATION_EXPECTATIONS"),
        "CLEVELAND_SOFIE": sofie_result,
        "ATLANTA_CPI": lambda: fetch_cpi_derived("ATLANTA_CPI"),
        "ATLANTA_WAGE": lambda: not_announced(
            URLS["ATLANTA_WAGE"],
            "Atlanta Fed says the Wage Growth Tracker is usually updated by the second Friday of the month; exact timing depends on Census CPS microdata availability.",
        ),
        "ATLANTA_GDPNOW": fetch_gdpnow,
        "ATLANTA_BIE": fetch_bie,
        "UMICH_CONSUMERS": fetch_umich,
        "FED_G17": fetch_fed_g17,
        "FED_BREAKEVENS": daily_result,
        "DALLAS_BUSINESS_ACTIVITY": fetch_dallas,
        "CHICAGO_CFNAI": fetch_chicago,
        "ADP_NER": fetch_adp,
        "JOBLESS_CLAIMS": weekly_claims_result,
        "OECD_CLI_BCI": fetch_oecd_cli_bci,
        "OECD_UNEMPLOYMENT": fetch_oecd_unemployment,
    }

    for family, fn in jobs.items():
        print(f"{family}...")
        try:
            family_results[family] = fn()
        except Exception as exc:
            source_by_family = {
                "CLEVELAND_CPI": URLS["CLEVELAND_CPI"],
                "CLEVELAND_INFLATION_EXPECTATIONS": URLS["CLEVELAND_INFLATION_EXPECTATIONS"],
                "CLEVELAND_SOFIE": URLS["CLEVELAND_SOFIE"],
                "ATLANTA_CPI": URLS["BLS_CPI"],
                "ATLANTA_WAGE": URLS["ATLANTA_WAGE"],
                "ATLANTA_GDPNOW": URLS["ATLANTA_GDPNOW"],
                "ATLANTA_BIE": URLS["ATLANTA_BIE"],
                "UMICH_CONSUMERS": URLS["UMICH"],
                "FED_G17": URLS["FED_G17"],
                "FED_BREAKEVENS": URLS["FED_BREAKEVENS"],
                "DALLAS_BUSINESS_ACTIVITY": URLS["DALLAS"],
                "CHICAGO_CFNAI": URLS["CHICAGO"],
                "ADP_NER": URLS["ADP"],
                "JOBLESS_CLAIMS": URLS["DOL_CLAIMS"],
                "OECD_CLI_BCI": URLS["OECD_CLI"],
                "OECD_UNEMPLOYMENT": URLS["OECD_RELEASES"],
            }
            family_results[family] = result(
                None,
                source_by_family.get(family, ""),
                f"Fetch/parse error: {exc}",
                "error",
            )

        r = family_results[family]
        print(f"  -> {r['date'] or 'NOT AVAILABLE'}")
        print(f"     status: {r['status']}")
        print(f"     {r['official_source']}")

    output_metrics = []
    for metric_id, metric, family in METRICS:
        r = family_results[family]
        output_metrics.append({
            "metric_id": metric_id,
            "metric": metric,
            "family": family,
            "next_release_date": r["date"],
            "next_release_at": r.get("next_release_at"),
            "release_deadline_at": r.get("release_deadline_at"),
            "release_time_kind": r.get("release_time_kind"),
            "release_status": r["status"],
            "official_source": r["official_source"],
            "official_evidence": r["official_evidence"],
        })

    payload = {
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "metrics": output_metrics,
        "family_release_dates": {
            family: value["date"]
            for family, value in family_results.items()
        },
        "family_status": {
            family: value["status"]
            for family, value in family_results.items()
        },
    }

    OUTPUT_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    official = sum(1 for x in output_metrics if x["release_status"] == "official_date")
    weekly = sum(1 for x in output_metrics if x["release_status"] == "weekly_cadence")
    daily = sum(1 for x in output_metrics if x["release_status"] == "daily_series")
    unavailable = len(output_metrics) - official - weekly - daily

    print("\n--------------------------------")
    print(f"Total metrics: {len(output_metrics)}")
    print(f"Official dates: {official}")
    print(f"Weekly cadence: {weekly}")
    print(f"Daily series: {daily}")
    print(f"Not announced / other: {unavailable}")
    print("--------------------------------")
    print(f"Saved -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
