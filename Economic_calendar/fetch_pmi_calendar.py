"""
Official PMI release-calendar fetcher.

Sources:
- ISM's official Manufacturing/Services report calendar.
- S&P Global's official PMI release calendar.

Only future dates explicitly published by the provider are emitted.
No release date is invented from a generic cadence when the provider has
not published a calendar entry.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

from release_time_utils import combine_date_time

OUTPUT_FILE = Path("pmi_calendar_fetch_results.json")
TIMEOUT = 30

ISM_URL = "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/"
SP_URL = "https://pmi.spglobal.com/Public/Release/ReleaseDates?language=en"

MONTHS = {
    name.lower(): i
    for i, name in enumerate(
        (
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ),
        start=1,
    )
}

METRICS = {
    "us-ism-manufacturing-pmi": ("ISM Manufacturing PMI", "ISM"),
    "us-ism-services-pmi": ("ISM Services PMI", "ISM"),
    "us-sp-global-manufacturing-pmi": ("S&P Global US Manufacturing PMI", "SP"),
    "us-sp-global-services-pmi": ("S&P Global US Services PMI", "SP"),
    "uk-sp-global-manufacturing-pmi": ("S&P Global UK Manufacturing PMI", "SP"),
    "uk-sp-global-services-pmi": ("S&P Global UK Services PMI", "SP"),
    "uk-sp-global-composite-pmi": ("S&P Global UK Composite PMI", "SP"),
    "ea-sp-global-manufacturing-pmi": ("S&P Global Eurozone Manufacturing PMI", "SP"),
    "ea-sp-global-services-pmi": ("S&P Global Eurozone Services PMI", "SP"),
    "ea-sp-global-composite-pmi": ("S&P Global Eurozone Composite PMI", "SP"),
}

SP_PATTERNS = {
    "us-sp-global-manufacturing-pmi": re.compile(r"\bS&P Global (?:US|United States) Manufacturing PMI\b", re.I),
    "us-sp-global-services-pmi": re.compile(r"\bS&P Global (?:US|United States) Services PMI\b", re.I),
    "us-sp-global-composite-pmi": re.compile(r"\bS&P Global (?:US|United States) (?:Composite PMI|Composite Output PMI)\b", re.I),
    "uk-sp-global-manufacturing-pmi": re.compile(r"\bS&P Global UK Manufacturing PMI\b", re.I),
    "uk-sp-global-services-pmi": re.compile(r"\bS&P Global UK Services PMI\b", re.I),
    "uk-sp-global-composite-pmi": re.compile(r"\bS&P Global UK (?:Composite PMI|Composite Output PMI)\b", re.I),
    "ea-sp-global-manufacturing-pmi": re.compile(r"\bS&P Global (?:Eurozone|Euro Area) Manufacturing PMI\b", re.I),
    "ea-sp-global-services-pmi": re.compile(r"\bS&P Global (?:Eurozone|Euro Area) Services PMI\b", re.I),
    "ea-sp-global-composite-pmi": re.compile(r"\bS&P Global (?:Eurozone|Euro Area) (?:Composite PMI|Composite Output PMI)\b", re.I),
}

def fetch(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; MacroHub calendar refresh)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urlopen(req, timeout=TIMEOUT) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_ism() -> dict[str, dict]:
    html = fetch(ISM_URL)
    soup = BeautifulSoup(html, "html.parser")
    today = date.today()
    out: dict[str, dict] = {}

    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = [" ".join(c.stripped_strings) for c in tr.find_all(["th", "td"])]
            if len(cells) < 3:
                continue

            m = re.search(
                r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b",
                cells[0],
                re.I,
            )
            if not m:
                continue

            month = MONTHS[m.group(1).lower()]
            year = int(m.group(2))
            values = []
            for cell in cells[1:3]:
                n = re.search(r"\b(\d{1,2})\b", cell)
                if n:
                    values.append(int(n.group(1)))
                else:
                    values.append(None)

            for metric_id, col in (
                ("us-ism-manufacturing-pmi", 0),
                ("us-ism-services-pmi", 1),
            ):
                if col >= len(values) or values[col] is None:
                    continue
                try:
                    d = date(year, month, values[col])
                except ValueError:
                    continue
                if d < today:
                    continue

                out[metric_id] = {
                    "next_release": d.isoformat(),
                    "next_release_at": combine_date_time(
                        d, "10:00", "America/New_York"
                    ),
                    "status": "official_date",
                    "official_source": ISM_URL,
                    "official_evidence": f"ISM official release calendar: {d.isoformat()}",
                }

    return out


def parse_sp() -> dict[str, dict]:
    html = fetch(SP_URL)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    today = date.today()

    # The official calendar exposes lines such as:
    # "June 23 13:45 UTC S&P Global Flash US PMI".
    # We intentionally match only the final monthly products used by this
    # project, not the flash releases.
    month_re = (
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)"
    )
    pat = re.compile(
        rf"\b{month_re}\s+(\d{{1,2}})\s+(\d{{2}}:\d{{2}})\s+UTC\s+"
        r"([^;|]+?)(?=(?:\b(?:January|February|March|April|May|June|July|August|"
        r"September|October|November|December)\s+\d{1,2}\s+\d{2}:\d{2}\s+UTC)|$)",
        re.I,
    )

    out: dict[str, dict] = {}

    # Determine a year from the closest preceding explicit year. The page
    # normally contains one calendar year in the current/upcoming section.
    for match in pat.finditer(text):
        before = text[max(0, match.start() - 160):match.start()]
        years = re.findall(r"\b(20\d{2})\b", before)
        year = int(years[-1]) if years else today.year
        month = MONTHS[match.group(1).lower()]
        day = int(match.group(2))
        utc_time = match.group(3)
        title = " ".join(match.group(4).split())

        try:
            d = date(year, month, day)
        except ValueError:
            continue
        if d < today:
            continue

        for metric_id, pattern in SP_PATTERNS.items():
            if not pattern.search(title):
                continue
            # Exclude Flash PMI entries; this catalog stores the standard
            # monthly manufacturing/services/composite release.
            if "flash" in title.lower():
                continue

            out.setdefault(
                metric_id,
                {
                    "next_release": d.isoformat(),
                    "next_release_at": f"{d.isoformat()}T{utc_time}:00+00:00",
                    "status": "official_date",
                    "official_source": SP_URL,
                    "official_evidence": f"S&P Global official PMI calendar: {d.isoformat()} {utc_time} UTC — {title}",
                },
            )

    return out


def main():
    results: list[dict] = []

    try:
        ism = parse_ism()
    except Exception as exc:
        print(f"[ISM] calendar fetch failed: {exc}")
        ism = {}

    try:
        sp = parse_sp()
    except Exception as exc:
        print(f"[S&P Global] calendar fetch failed: {exc}")
        sp = {}

    for metric_id, (name, provider) in METRICS.items():
        source = ism if provider == "ISM" else sp
        item = source.get(metric_id)
        if item is None:
            results.append(
                {
                    "metric_id": metric_id,
                    "metric": name,
                    "source": provider,
                    "next_release": None,
                    "next_release_at": None,
                    "status": "not_found",
                    "official_source": ISM_URL if provider == "ISM" else SP_URL,
                    "official_evidence": "No future matching release was found on the official calendar.",
                }
            )
        else:
            results.append(
                {
                    "metric_id": metric_id,
                    "metric": name,
                    "source": provider,
                    **item,
                }
            )

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "metrics": results,
    }
    OUTPUT_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Saved -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
