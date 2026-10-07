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
from fetch_nyfed_sce_philly_spf_calendar import extract_calendar_release, month_sequence, month_url

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

    if not soup.find("table"):
        raise RuntimeError("ISM response contains no release-calendar table (blocked, redirected, or changed markup).")

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

                if metric_id in out and out[metric_id]["next_release"] <= d.isoformat():
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


def parse_ism_nyfed(today: date | None = None) -> dict[str, dict]:
    """Use the Federal Reserve's published calendar if ISM blocks retrieval."""
    today = today or date.today()
    targets = {
        "us-ism-manufacturing-pmi": "ISM Manufacturing",
        "us-ism-services-pmi": "ISM Non-Manufacturing",
    }
    out = {}
    for year, month in month_sequence(today, 3):
        try:
            html = fetch(month_url(year, month))
        except Exception:
            continue
        for metric_id, title in targets.items():
            if metric_id in out:
                continue
            release = extract_calendar_release(html, year, month, title)
            if release and release["date"] >= today:
                out[metric_id] = {
                    "next_release": release["date"].isoformat(),
                    "next_release_at": release["release_at"],
                    "status": "official_date",
                    "official_source": release["official_source"],
                    "official_evidence": f"NY Fed published indicators calendar: {release['official_evidence']}; ISM primary calendar could not be retrieved.",
                }
        if len(out) == len(targets):
            break
    return out


def parse_sp() -> dict[str, dict]:
    html = fetch(SP_URL)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    today = date.today()

    # Calendar dates are headings shared by many individual UTC entries.
    # Bound each product by the next time, rather than attaching the first
    # time of the day to every title in the block.
    month_re = r"January|February|March|April|May|June|July|August|September|October|November|December"
    date_pattern = re.compile(rf"\b({month_re})\s+(\d{{1,2}})(?:\s+(20\d{{2}}))?\s+(?=\d{{1,2}}:\d{{2}}\s+UTC)", re.I)
    entry_pattern = re.compile(r"\b(\d{1,2}:\d{2})\s+UTC\s+(.+?)(?=\b\d{1,2}:\d{2}\s+UTC|$)", re.I)
    out: dict[str, dict] = {}
    headings = list(date_pattern.finditer(text))
    if not headings:
        raise RuntimeError("S&P response contains no dated UTC release entries (blocked or changed markup).")
    for index, match in enumerate(headings):
        years = re.findall(r"\b(20\d{2})\b", text[:match.start()])
        year = int(match.group(3)) if match.group(3) else (int(years[-1]) if years else today.year)
        try:
            d = date(year, MONTHS[match.group(1).lower()], int(match.group(2)))
        except ValueError:
            continue
        if d < today:
            continue
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        for entry in entry_pattern.finditer(text[match.end():end]):
            utc_time, title = entry.group(1), " ".join(entry.group(2).split())
            if "flash" in title.lower():
                continue
            hour, minute = map(int, utc_time.split(":"))
            if hour > 23 or minute > 59:
                continue
            matched = {metric_id for metric_id, pattern in SP_PATTERNS.items() if pattern.search(title)}
            # The final Eurozone Composite release contains its Services
            # Business Activity index; UK Services includes Composite.
            if "ea-sp-global-composite-pmi" in matched:
                matched.add("ea-sp-global-services-pmi")
            if "uk-sp-global-services-pmi" in matched:
                matched.add("uk-sp-global-composite-pmi")
            for metric_id in matched:
                item = {
                    "next_release": d.isoformat(),
                    "next_release_at": f"{d.isoformat()}T{hour:02d}:{minute:02d}:00+00:00",
                    "status": "official_date",
                    "official_source": SP_URL,
                    "official_evidence": f"S&P Global official PMI calendar: {d.isoformat()} {utc_time} UTC — {title}",
                }
                if metric_id not in out or item["next_release_at"] < out[metric_id]["next_release_at"]:
                    out[metric_id] = item

    return out


def main():
    results: list[dict] = []
    errors = {}

    try:
        ism = parse_ism()
    except Exception as exc:
        print(f"[ISM] calendar fetch failed: {exc}")
        errors["ISM"] = str(exc)
        ism = {}

    if len(ism) < 2:
        fallback = parse_ism_nyfed()
        for metric_id, item in fallback.items():
            ism.setdefault(metric_id, item)

    try:
        sp = parse_sp()
    except Exception as exc:
        print(f"[S&P Global] calendar fetch failed: {exc}")
        errors["SP"] = str(exc)
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
                    "status": "fetch_failed" if provider in errors else "not_found",
                    "official_source": ISM_URL if provider == "ISM" else SP_URL,
                    "official_evidence": errors.get(provider, "No future matching release was found on the official calendar."),
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
