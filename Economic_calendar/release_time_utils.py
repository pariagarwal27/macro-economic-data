"""
Shared helpers for official economic-calendar release timestamps.

The calendar stores scheduled timestamps as ISO-8601 strings with an
explicit timezone offset whenever the provider gives enough information
to construct one.

A timestamp is only created when the source provides an exact time or
the provider's official release schedule explicitly defines a fixed
time for that family. No time is guessed from the calendar date alone.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo


_TIME_PATTERNS = (
    # 8:30 AM / 8.30 a.m. / 08:30 PM
    re.compile(
        r"\b(?P<hour>\d{1,2})[:.](?P<minute>\d{2})\s*"
        r"(?P<ampm>a\.?m\.?|p\.?m\.?)\b",
        re.IGNORECASE,
    ),
    # 8 AM / 8 a.m.
    re.compile(
        r"\b(?P<hour>\d{1,2})\s*"
        r"(?P<ampm>a\.?m\.?|p\.?m\.?)\b",
        re.IGNORECASE,
    ),
    # 08:30, normally used inside official calendar entries such as
    # "(11:00)" where the surrounding page defines the timezone.
    re.compile(
        r"\b(?P<hour>\d{1,2}):(?P<minute>\d{2})\b"
    ),
)


def extract_release_time(text: str | None) -> str | None:
    """Return a normalized HH:MM 24-hour time from source text."""
    if not text:
        return None

    text = str(text)

    for pattern in _TIME_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue

        hour = int(match.group("hour"))
        minute = int(match.group("minute"))

        if hour > 23 or minute > 59:
            continue

        ampm = match.groupdict().get("ampm")

        if ampm:
            ampm = ampm.lower().replace(".", "")
            if ampm == "pm" and hour != 12:
                hour += 12
            elif ampm == "am" and hour == 12:
                hour = 0

        return f"{hour:02d}:{minute:02d}"

    return None


def combine_date_time(
    release_date: str | date | None,
    release_time: str | None,
    timezone_name: str,
) -> str | None:
    """
    Combine an official release date and exact release time.

    Returns an ISO-8601 datetime with an explicit UTC offset.
    """
    if not release_date or not release_time:
        return None

    if isinstance(release_date, date):
        date_value = release_date
    else:
        date_value = date.fromisoformat(str(release_date)[:10])

    try:
        hour, minute = [int(x) for x in release_time.split(":", 1)]
    except (ValueError, AttributeError):
        return None

    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        return None

    local_dt = datetime(
        date_value.year,
        date_value.month,
        date_value.day,
        hour,
        minute,
        tzinfo=zone,
    )

    return local_dt.isoformat()


def preserve_datetime(value: str | None, default_timezone: str | None = None) -> str | None:
    """
    Preserve a provider-supplied datetime.

    If the provider gives a timezone-aware ISO datetime, it is returned
    unchanged. If it gives a naive datetime and the provider timezone is
    explicitly known, the timezone is attached.
    """
    if not value:
        return None

    value = str(value).strip()
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )
    except ValueError:
        return None

    # Date-only values are not exact release timestamps.
    if len(value) == 10 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None

    if parsed.tzinfo is None and default_timezone:
        parsed = parsed.replace(
            tzinfo=ZoneInfo(default_timezone)
        )

    return parsed.isoformat()


def clean_datetime_value(value: str | None) -> str | None:
    """Return a provider-supplied ISO datetime, rejecting date-only values."""
    if not value:
        return None

    value = str(value).strip()
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if len(value) == 10 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None

    # Preserve an explicit timezone if present; otherwise preserve the
    # source's naive datetime rather than inventing a timezone.
    return parsed.isoformat()
