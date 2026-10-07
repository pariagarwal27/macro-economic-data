import json

import os

import re

from datetime import datetime, date, timezone

from io import BytesIO

from urllib.parse import urljoin, urlparse



import requests

from icalendar import Calendar



from release_time_utils import preserve_datetime, combine_date_time



try:

    from pypdf import PdfReader

except ImportError:

    PdfReader = None





# ============================================================

# EUROSTAT RELEASE CALENDAR

#

# IMPORTANT:

# Eurostat's normal Statistics API gives data/metadata, but the

# scheduled release dates are provided by Eurostat's official

# release calendar. Eurostat exposes that calendar as an

# iCalendar (.ics) feed.

#

# Get the URL once from:

# https://ec.europa.eu/eurostat/web/main/subscribe/ics.format

#

# On that page choose:

#   - no filters

#   - "Copy calendar URL"

#

# Then set the URL below OR:

#   PowerShell:

#   $env:EUROSTAT_ICS_URL="PASTE_ICS_URL_HERE"

# ============================================================



EUROSTAT_ICS_URL = os.getenv(

    "EUROSTAT_ICS_URL",

    "https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=0",

).strip()



OUTPUT_FILE = "eurostat_fetch_results.json"

EUROSTAT_RELEASE_CALENDAR_URL = (

    "https://ec.europa.eu/eurostat/news/release-calendar"

)



EUROSTAT_RELEASE_TIMEZONE = "Europe/Luxembourg"



EUROSTAT_STANDARD_RELEASE_TIME = "11:00"

HEADERS = {

    "User-Agent": (

        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "

        "AppleWebKit/537.36 (KHTML, like Gecko) "

        "Chrome/139.0 Safari/537.36"

    ),

    "Accept": "text/calendar,text/plain,*/*",

}



REQUEST_TIMEOUT = 30





# ============================================================

# METRICS

# ============================================================



EUROSTAT_METRICS = {

    "ea-hicp-yoy": "prc_hicp_minr",

    "ea-core-hicp-yoy": "prc_hicp_minr_core",

    "ea-hicp-mom": "prc_hicp_mmor",

    "ea-core-hicp-mom": "prc_hicp_mmor_core",

    "ea-services-hicp-yoy": "prc_hicp_minr_serv",

    "ea-services-hicp-mom": "prc_hicp_mmor_serv",

    "ea-goods-hicp-yoy": "prc_hicp_minr_goods",

    "ea-food-hicp-yoy": "prc_hicp_minr_food",

    "ea-energy-hicp-yoy": "prc_hicp_minr_nrg",



    "de-cpi-yoy": "prc_hicp_minr_DE",

    "fr-cpi-yoy": "prc_hicp_minr_FR",

    "it-cpi-yoy": "prc_hicp_minr_IT",

    "es-cpi-yoy": "prc_hicp_minr_ES",



    "ea-ppi-yoy": "sts_inpp_m",



    "ea-unemployed-persons": "ei_lmhu_m",



    "ea-gdp-yoy": "ea_gdp_real",

    "ea-gdp-qoq": "ea_gdp_real",



    "ea-industrial-production": "sts_inpr_m",

    "ea-retail-sales": "ei_isrr_m",



    "ea-esi": "ei_bssi_esi",

    "ea-business-confidence": "ei_bssi_ici",



    "ea-unemployment": "une_rt_m",



    "ea-employment-yoy": "lfsi_emp_q_ea",

    "ea-employment-qoq": "lfsi_emp_q_ea",

    "ea-youth-unemployment": "une_rt_m_youth",

    "ea-youth-unemployed-persons": "une_rt_m_youth",

    "ea-employment-rate": "lfsi_emp_q_ea",

    "ea-inactive-population": "ea_inactive_population",

    "ea-inactivity-change": "ea_inactive_population",

    "ea-vacant-posts": "ea_vacant_posts",

    "ea-vacancy-change": "ea_vacant_posts",

    "ea-long-term-unemployment": "ea_long_term_unemployment",

    "ea-employment-change": "lfsi_emp_q_ea",
    "ea-wage-growth": "lc_lci_wage_yoy",

    "ea-wage-growth-qoq": "lc_lci_wage_qoq",
    "ea-retail-sales-mom": "ei_isrr_mom",
    "ea-household-consumption": None,

    "ea-gfcf": None,

    "ea-government-consumption": None,

    "ea-exports": None,

    "ea-imports": None,



    "ea-inactivity": None,

    "ea-job-vacancies": None,



    "ea-retail-food-drinks-tobacco": "ea_retail_food_drinks_tobacco",

    "ea-retail-non-food-ex-fuel": "ea_retail_non_food_ex_fuel",

    "ea-retail-automotive-fuel": "ea_retail_automotive_fuel",

    "ea-retail-sales-total-ex-motor-vehicles": (

        "ea_retail_sales_total_ex_motor_vehicles"

    ),

}

RELEASE_FAMILIES = {
    "HICP": {
    "event_regex": re.compile(
        r"^(?!.*\bflash\b)Inflation\s+\(HICP\).*",
        re.IGNORECASE,
    ),
},
    "PPI": {

        "event_regex": re.compile(

            r"^Industrial producer prices,\s*external & total",

            re.IGNORECASE,

        ),

    },



    "UNEMPLOYMENT": {

        "event_regex": re.compile(

            r"^Unemployment$",

            re.IGNORECASE,

        ),

    },



    "GDP_EMPLOYMENT": {

        # Regular GDP/main-aggregate release.

        # Excludes:

        #   Preliminary flash estimate GDP...

        #   Flash estimate GDP and employment...

        "event_regex": re.compile(

            r"^(?!Preliminary flash estimate)"

            r"(?!Flash estimate)"

            r"(?=.*GDP)"

            r".*(?:employment|GDP main components|GDP up)",

            re.IGNORECASE,

        ),

    },



    "INDUSTRIAL_PRODUCTION": {

        "event_regex": re.compile(

            r"^Industrial production$",

            re.IGNORECASE,

        ),

    },



    "RETAIL_TRADE": {

        "event_regex": re.compile(

            r"^Retail trade$",

            re.IGNORECASE,

        ),

    },



    "ECONOMIC_SENTIMENT": {

        "event_regex": re.compile(

            r"^Economic Sentiment Indicator & Business and Consumer Survey results$",

            re.IGNORECASE,

        ),

    },



    "JOB_VACANCY": {

        "event_regex": re.compile(

            r"^Job vacancy",

            re.IGNORECASE,

        ),

    },



    "LABOUR_COST_INDEX": {

        "event_regex": re.compile(

            r"^Labour cost index$",

            re.IGNORECASE,

        ),

    },



    # Quarterly EU-LFS main indicators have a separate official

    # release calendar. We first try the main Eurostat iCalendar;

    # if it does not expose the LFS event, the code dynamically

    # discovers the current LFS release-calendar PDF from the

    # official LFS information page and extracts the next date.

    "LFS_MAIN_INDICATORS": {

        "event_regex": re.compile(

            r"^(?:LFS main indicators|EU Labour Force Survey.*|LFS.*main indicators.*)$",

            re.IGNORECASE,

        ),

    },



    "SECTOR_ACCOUNTS": {

        "event_regex": re.compile(

            r"^(?:First release sector accounts|Second release sector accounts)",

            re.IGNORECASE,

        ),

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





# HICP / country HICP

add_family(

    "HICP",

    [

        "ea-hicp-yoy",

        "ea-core-hicp-yoy",

        "ea-hicp-mom",

        "ea-core-hicp-mom",

        "ea-services-hicp-yoy",

        "ea-services-hicp-mom",

        "ea-goods-hicp-yoy",

        "ea-food-hicp-yoy",

        "ea-energy-hicp-yoy",

        "de-cpi-yoy",

        "fr-cpi-yoy",

        "it-cpi-yoy",

        "es-cpi-yoy",

    ],

)



# PPI

add_family(

    "PPI",

    [

        "ea-ppi-yoy",

    ],

)



# Unemployment / LFS unemployment-related indicators

add_family(

    "UNEMPLOYMENT",

    [

        "ea-unemployed-persons",

        "ea-unemployment",

        "ea-youth-unemployment",

        "ea-youth-unemployed-persons",

        "ea-long-term-unemployment",

    ],

)



# Quarterly / annual EU Labour Force Survey main indicators

add_family(

    "LFS_MAIN_INDICATORS",

    [

        "ea-employment-yoy",

        "ea-employment-qoq",

        "ea-employment-rate",

        "ea-inactive-population",

        "ea-inactivity-change",

        "ea-employment-change",

        "ea-inactivity",

    ],

)



# Regular GDP / national accounts main aggregates

add_family(

    "GDP_EMPLOYMENT",

    [

        "ea-gdp-yoy",

        "ea-gdp-qoq",

        "ea-household-consumption",

        "ea-gfcf",

        "ea-government-consumption",

        "ea-exports",

        "ea-imports",

    ],

)



# Industrial production

add_family(

    "INDUSTRIAL_PRODUCTION",

    [

        "ea-industrial-production",

    ],

)



# Retail

add_family(

    "RETAIL_TRADE",

    [

        "ea-retail-sales",

        "ea-retail-sales-mom",

        "ea-retail-food-drinks-tobacco",

        "ea-retail-non-food-ex-fuel",

        "ea-retail-automotive-fuel",

        "ea-retail-sales-total-ex-motor-vehicles",

    ],

)



# Economic sentiment / industrial confidence

add_family(

    "ECONOMIC_SENTIMENT",

    [

        "ea-esi",

        "ea-business-confidence",

    ],

)



# Job vacancies

add_family(

    "JOB_VACANCY",

    [

        "ea-vacant-posts",

        "ea-vacancy-change",

        "ea-job-vacancies",

    ],

)



# Labour cost / wages

add_family(

    "LABOUR_COST_INDEX",

    [

        "ea-wage-growth",

        "ea-wage-growth-qoq",

    ],

)





# ============================================================

# VALIDATION

# ============================================================



missing = sorted(

    set(EUROSTAT_METRICS) - set(METRIC_FAMILY)

)



extra = sorted(

    set(METRIC_FAMILY) - set(EUROSTAT_METRICS)

)



if missing:

    raise ValueError(

        "Metrics missing family mapping:\n"

        + "\n".join(missing)

    )



if extra:

    raise ValueError(

        "Family mapping contains unknown metrics:\n"

        + "\n".join(extra)

    )





# ============================================================

# ICS HELPERS

# ============================================================



def decode_ical_value(value):

    if value is None:

        return ""



    try:

        return str(value)

    except Exception:

        return ""





def parse_ical_date(component):

    """

    Return a date from DTSTART.



    Eurostat calendar uses Europe/Luxembourg time.

    We only need the scheduled calendar date.

    """



    dtstart = component.get("dtstart")



    if dtstart is None:

        return None



    value = dtstart.dt



    if isinstance(value, datetime):

        return value.date()



    if isinstance(value, date):

        return value



    return None





def load_calendar():

    if not EUROSTAT_ICS_URL:

        raise RuntimeError(

            "\nEUROSTAT_ICS_URL is empty.\n\n"

            "Open the official Eurostat subscription page:\n"

            "https://ec.europa.eu/eurostat/web/main/subscribe/ics.format\n\n"

            "Click 'Copy calendar URL' with no filters and either:\n"

            "1) paste it into EUROSTAT_ICS_URL in this script, or\n"

            "2) set PowerShell environment variable:\n"

            '$env:EUROSTAT_ICS_URL="PASTE_URL_HERE"\n'

        )



    parsed = urlparse(EUROSTAT_ICS_URL)



    if parsed.scheme not in ("http", "https"):

        raise RuntimeError(

            "EUROSTAT_ICS_URL must be an http/https URL."

        )



    print("\nDownloading official Eurostat release calendar...")

    print(EUROSTAT_ICS_URL)



    response = requests.get(

        EUROSTAT_ICS_URL,

        headers=HEADERS,

        timeout=REQUEST_TIMEOUT,

    )



    response.raise_for_status()



    content = response.content



    if b"BEGIN:VCALENDAR" not in content:

        raise RuntimeError(

            "Downloaded URL did not return an iCalendar feed."

        )



    return Calendar.from_ical(content)





def extract_events(calendar):

    events = []



    for component in calendar.walk():

        if component.name != "VEVENT":

            continue



        summary = decode_ical_value(

            component.get("summary")

        ).strip()



        if not summary:

            continue



        release_date = parse_ical_date(component)



        if release_date is None:

            continue



        dtstart = component.get("dtstart")

        release_at = None



        if dtstart is not None and isinstance(dtstart.dt, datetime):

            release_at = preserve_datetime(

                dtstart.dt.isoformat(),

                "Europe/Luxembourg",

            )



        description = decode_ical_value(

            component.get("description")

        )



        url = decode_ical_value(

            component.get("url")

        )



        events.append({

            "summary": summary,

            "release_date": release_date.isoformat(),

            "release_date_obj": release_date,

            "release_at": release_at,

            "description": description,

            "url": url,

        })



    return events





# ============================================================

# DYNAMIC LFS RELEASE-CALENDAR RESOLVER

# ============================================================



LFS_INFO_URL = (

    "https://ec.europa.eu/eurostat/en/web/lfs/information-data"

)



LFS_RELEASE_PDF_RE = re.compile(
    r'(?:https?:)?//[^<>\s]+LFS_release_announcement\.pdf[^<>\s]*'
    r'|(?:href|url)=["\']?([^<>\s]+LFS_release_announcement\.pdf[^<>\s]*)',
    re.IGNORECASE,
)


LFS_DATE_RE = re.compile(

    r"\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|"

    r"August|September|October|November|December)\s+\d{4})\b",

    re.IGNORECASE,

)





def discover_lfs_release_pdf():

    """Find the current official LFS release-calendar PDF dynamically."""

    response = requests.get(

        LFS_INFO_URL,

        headers={"User-Agent": HEADERS["User-Agent"], "Accept": "text/html,*/*"},

        timeout=REQUEST_TIMEOUT,

    )

    response.raise_for_status()



    html = response.text



    matches = []



    # First look for the stable official PDF filename anywhere in the page HTML.

    for match in re.finditer(

        r'(?:https?:)?//[^<>\s]+LFS_release_announcement\.pdf[^<>\s]*'
        r'|(?:href|url)=["\']?([^<>\s]+LFS_release_announcement\.pdf[^<>\s]*)',

        html,

        re.IGNORECASE,

    ):

        value = match.group(0)

        if "=" in value and value.lower().startswith(("href=", "url=")):

            value = value.split("=", 1)[1].strip("\"\'")

        if value.startswith("//"):

            value = "https:" + value

        elif value.startswith("/"):

            value = urljoin(LFS_INFO_URL, value)

        elif not value.lower().startswith(("http://", "https://")):

            value = urljoin(LFS_INFO_URL, value)

        matches.append(value)



    # De-duplicate while preserving order.

    seen = set()

    matches = [x for x in matches if not (x in seen or seen.add(x))]



    if not matches:

        raise RuntimeError(

            "Could not discover the current official LFS release-calendar PDF "

            f"from {LFS_INFO_URL}"

        )



    return matches[0]





def extract_lfs_next_release():

    """

    Dynamically resolve the next EU-LFS main-indicator release date.



    No year, quarter, UUID, or publication date is hardcoded.

    """

    if PdfReader is None:

        raise RuntimeError(

            "Missing dependency 'pypdf'. Install it with:\n"

            "pip install pypdf"

        )



    pdf_url = discover_lfs_release_pdf()



    response = requests.get(

        pdf_url,

        headers={"User-Agent": HEADERS["User-Agent"], "Accept": "application/pdf,*/*"},

        timeout=REQUEST_TIMEOUT,

    )

    response.raise_for_status()



    if not response.content.startswith(b"%PDF"):

        raise RuntimeError(

            "Discovered LFS release-calendar URL did not return a PDF: "

            + pdf_url

        )



    reader = PdfReader(BytesIO(response.content))

    text_parts = []



    for page in reader.pages:

        try:

            page_text = page.extract_text() or ""

        except Exception:

            page_text = ""

        if page_text:

            text_parts.append(page_text)



    pdf_text = "\n".join(text_parts)



    # The official LFS PDF contains a table headed by

    # "Results for" and "Planned publication date". Restrict

    # parsing to that section so metadata/document dates do not

    # become false release dates.

    lower = pdf_text.lower()

    table_start = lower.find("results for")

    if table_start >= 0:

        pdf_text = pdf_text[table_start:]



    dates = []

    for raw_date in LFS_DATE_RE.findall(pdf_text):

        try:

            parsed = datetime.strptime(

                raw_date,

                "%d %B %Y",

            ).date()

        except ValueError:

            try:

                parsed = datetime.strptime(

                    raw_date.title(),

                    "%d %B %Y",

                ).date()

            except ValueError:

                continue



        dates.append(parsed)



    today = datetime.now(timezone.utc).date()

    future_dates = sorted({d for d in dates if d >= today})



    if not future_dates:

        raise RuntimeError(

            "No future LFS publication date found in the current official "

            f"release calendar PDF: {pdf_url}"

        )



    next_date = future_dates[0]

    # The LFS PDF announces publication dates, not news-release times.
    next_release_at = None

    return {
        "success": True,
        "next_release": next_date.isoformat(),
        "next_release_at": next_release_at,
        "release_title": "EU Labour Force Survey: LFS main indicators",
        "release_url": pdf_url,
        "error": None,
    }





# ============================================================

# FAMILY MATCHING

# ============================================================

def resolve_release_at(event, family_name):

    """

    Get the exact release timestamp.



    Eurostat's iCalendar often provides only the release date.

    Eurostat euro-indicator releases are scheduled for 11:00

    in the Europe/Luxembourg timezone.



    If the ICS feed ever provides an explicit time, use that

    instead of the standard time.

    """



    # 1. Prefer an explicit time from Eurostat ICS

    explicit = event.get("release_at")



    if explicit:

        return explicit

    if family_name in {"LFS_MAIN_INDICATORS", "ECONOMIC_SENTIMENT"}:
        return None



    # 2. Otherwise use Eurostat's standard release time

    release_date = event.get("release_date")



    if not release_date:

        return None



    return combine_date_time(

        release_date,

        EUROSTAT_STANDARD_RELEASE_TIME,

        EUROSTAT_RELEASE_TIMEZONE,

    )

def parse_ecfin_schedule(text, today=None):
    """Read the ESI column of the official two-column publication table."""
    if not re.search(r"Business and consumer survey results", text, re.I):
        return None
    today = today or datetime.now(timezone.utc).date()
    date_pattern = r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})"
    # Each row begins with the flash consumer date/time, followed by the
    # ESI publication month (occasionally footnotes), then ESI date/time.
    pattern = re.compile(
        date_pattern + r"\s+\d{1,2}h\d{2}\s+[A-Za-z]+\s*"
        r"(?:\d\)\s*)*" + date_pattern + r"\s+(\d{1,2})h(\d{2})",
        re.I,
    )
    candidates = []
    for match in pattern.finditer(' '.join(text.split())):
        try:
            release_date = datetime.strptime(match.group(2), "%d %B %Y").date()
        except ValueError:
            continue
        if release_date >= today:
            candidates.append((release_date, f"{int(match.group(3)):02d}:{match.group(4)}"))
    return min(candidates) if candidates else None


def fetch_ecfin_next_release():
    """Discover DG ECFIN's annual schedule and use its ESI column."""
    if PdfReader is None:
        raise RuntimeError("Missing pypdf for official DG ECFIN schedule")
    ecfin_url = (
        "https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/"
        "business-and-consumer-surveys/latest-business-and-consumer-surveys_en"
    )
    response = requests.get(ecfin_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    links = re.findall(r'href=["\']([^"\']+)["\']', response.text, re.I)
    schedule_urls = [urljoin(ecfin_url, link) for link in links
                     if re.search(r"Publication(?:%20|\s)+dates(?:%20|\s)+\d{4}\.pdf", link, re.I)]
    candidates = []
    for pdf_url in dict.fromkeys(schedule_urls):
        pdf_response = requests.get(pdf_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        pdf_response.raise_for_status()
        reader = PdfReader(BytesIO(pdf_response.content))
        parsed = parse_ecfin_schedule('\n'.join(page.extract_text() or '' for page in reader.pages))
        if parsed:
            candidates.append((parsed[0], parsed[1], pdf_url))
    if not candidates:
        raise RuntimeError("No future ESI publication in official DG ECFIN schedule")
    release_date, release_time, pdf_url = min(candidates)
    return {
        "success": True,
        "next_release": release_date.isoformat(),
        "next_release_at": combine_date_time(release_date, release_time, "Europe/Brussels"),
        "release_title": "Business and consumer survey results (incl. ESI, EEI, EUI, sectoral CIs)",
        "release_url": pdf_url,
        "error": None,
    }


def find_next_release(events, family_name, config):

    today = datetime.now(timezone.utc).date()



    candidates = []



    for event in events:

        event_date = event["release_date_obj"]



        if event_date < today:

            continue



        summary = event["summary"]



        if config["event_regex"].search(summary):

            candidates.append(event)



    candidates.sort(

        key=lambda x: x["release_date_obj"]

    )



    if not candidates:

        if family_name == "ECONOMIC_SENTIMENT":
            try:
                return fetch_ecfin_next_release()
            except Exception as exc:
                return {
                    "success": False,
                    "next_release": None,
                    "next_release_at": None,
                    "release_title": None,
                    "release_url": None,
                    "error": f"DG ECFIN schedule lookup failed: {exc}",
                }

        # Some domains, such as quarterly EU-LFS main indicators,

        # have a separate official release calendar rather than an

        # event in the Euro-indicators iCalendar feed. Resolve the

        # current official calendar dynamically instead of using a

        # year-specific hardcoded date.

        if family_name == "LFS_MAIN_INDICATORS":

            try:

                lfs_result = extract_lfs_next_release()

                print(

                    f"   {lfs_result['next_release']} | "

                    f"{lfs_result['release_title']} "

                    "(official LFS release calendar)"

                )

                return lfs_result

            except Exception as exc:

                return {

                    "success": False,

                    "next_release": None,

                    "release_title": None,

                    "release_url": None,

                    "error": f"LFS calendar lookup failed: {exc}",

                }



        return {

            "success": False,

            "next_release": None,

            "release_title": None,

            "release_url": None,

            "error": "No matching future calendar event found",

        }



    selected = candidates[0]



    print(

        f"   {selected['release_date']} | "

        f"{selected['summary']}"

    )



    next_release_at = resolve_release_at(
        selected,
        family_name,
    )

    print(
        f"   Release time: {next_release_at}"
    )

    return {
        "success": True,
        "next_release": selected["release_date"],
        "next_release_at": next_release_at,
        "release_title": selected["summary"],
        "release_url": (
            selected["url"] or EUROSTAT_RELEASE_CALENDAR_URL
        ),
        "error": None,
    }





def fetch_family_dates(events):

    results = {}



    print("\n" + "=" * 70)

    print("EUROSTAT RELEASE FAMILY DATES")

    print("=" * 70)



    for family_name, config in RELEASE_FAMILIES.items():

        print(f"\n🔎 {family_name}")



        results[family_name] = find_next_release(

            events,

            family_name,

            config,

        )



        if not results[family_name]["success"]:

            print(

                "   ❌ "

                + results[family_name]["error"]

            )



    return results





# ============================================================

# BUILD METRIC RESULTS

# ============================================================



def build_metric_results(family_results):

    results = []



    for metric_id, eurostat_id in EUROSTAT_METRICS.items():



        family = METRIC_FAMILY[metric_id]

        family_result = family_results.get(family)



        results.append({

            "metric_id": metric_id,

            "eurostat_id": eurostat_id,

            "release_family": family,

            "next_release": (

                family_result.get("next_release")

                if family_result

                else None

            ),

            "next_release_at": (

                family_result.get("next_release_at")

                if family_result

                else None

            ),

            "release_title": (

                family_result.get("release_title")

                if family_result

                else None

            ),

            "release_url": (

                family_result.get("release_url")

                if family_result

                else None

            ),

            "success": bool(

                family_result

                and family_result.get("success")

                and family_result.get("next_release")

            ),

            "error": (

                family_result.get("error")

                if family_result

                else "Family result missing"

            ),

        })



    return results





# ============================================================

# SAVE

# ============================================================



def save_results(results, family_results):

    output = {

        "source": "Eurostat",

        "calendar_source": (
            "Eurostat official release calendar (iCalendar); "
            "date-only events use 11:00 Europe/Luxembourg "
            "for the scheduled first release"
        ),

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

    print("EUROSTAT CALENDAR SUMMARY")

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

                f"({item['eurostat_id']}) "

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

        f"Eurostat metrics loaded: "

        f"{len(EUROSTAT_METRICS)}"

    )



    print(

        f"Release families: "

        f"{len(RELEASE_FAMILIES)}"

    )



    calendar = load_calendar()



    events = extract_events(calendar)



    print(

        f"Calendar events loaded: "

        f"{len(events)}"

    )



    family_results = fetch_family_dates(events)



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
