import { NextRequest, NextResponse } from "next/server";

import { and, gte, lt } from "drizzle-orm";

import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import { getDb } from "@/db";
import { releases } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Economic Calendar display timezone.
 *
 * Europe/London automatically handles:
 * - BST (UTC+1) in summer
 * - GMT (UTC+0) in winter
 */
const DISPLAY_TIME_ZONE = "Europe/London";

/**
 * Eurostat's official release calendar uses Europe/Luxembourg time.
 *
 * For Eurostat euro-indicator / STS releases, the standard publication
 * time is 11:00 in the Eurostat/Luxembourg timezone. The calendar feed
 * can sometimes provide only a date, so this is used only when
 * nextReleaseAt is missing.
 */
const EUROSTAT_TIME_ZONE = "Europe/Luxembourg";
const EUROSTAT_STANDARD_RELEASE_HOUR = 11;
const EUROSTAT_STANDARD_RELEASE_MINUTE = 0;

type ActualInfo = {
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  actualReleasedAt: string | null;
};

function dateKeyInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToKey(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeDateKey(value: string | null) {
  if (!value) return null;

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

/**
 * Format a timezone-aware timestamp as HH:mm in the fixed UK display
 * timezone.
 */
function releaseTime(value: string | null) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Convert a local date/time in an IANA timezone into an ISO timestamp.
 *
 * Example:
 *   2026-10-06 11:00 Europe/Luxembourg
 * -> 2026-10-06T09:00:00.000Z
 *
 * This lets us store/use the official Eurostat calendar time while
 * allowing Intl.DateTimeFormat to convert it to UK/BST for display.
 */
function zonedDateTimeToIso(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string
) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  // Start with the same wall-clock components interpreted as UTC.
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(naiveUtcMs));

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  if (
    !values.year ||
    !values.month ||
    !values.day ||
    values.hour === undefined ||
    values.minute === undefined ||
    values.second === undefined
  ) {
    return null;
  }

  const representedUtcMs = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
    0
  );

  const offsetMs = representedUtcMs - naiveUtcMs;
  const actualUtcMs = naiveUtcMs - offsetMs;

  return new Date(actualUtcMs).toISOString();
}

/**
 * If Eurostat's calendar row already contains a timezone-aware release
 * timestamp, always use it.
 *
 * If it contains only the date, use Eurostat's standard 11:00
 * Europe/Luxembourg publication time.
 *
 * This is intentionally limited to Eurostat rows so that other
 * providers' release times are never guessed here.
 */
function eurostatScheduledAt(
  source: string | null | undefined,
  nextReleaseDate: string | null,
  nextReleaseAt: string | null
) {
  if (nextReleaseAt) {
    return nextReleaseAt;
  }

  const normalizedSource = (source ?? "").trim().toLowerCase();

  if (!normalizedSource.includes("eurostat")) {
    return null;
  }

  const dateKey = normalizeDateKey(nextReleaseDate);

  if (!dateKey) {
    return null;
  }

  return zonedDateTimeToIso(
    dateKey,
    EUROSTAT_STANDARD_RELEASE_HOUR,
    EUROSTAT_STANDARD_RELEASE_MINUTE,
    EUROSTAT_TIME_ZONE
  );
}

function inferRegion(
  metricId: string,
  metricName: string | null
) {
  const text =
    `${metricId} ${metricName ?? ""}`.toLowerCase();

  if (
    text.startsWith("us-") ||
    text.includes("united states") ||
    text.includes("u.s.")
  ) {
    return "US";
  }

  if (
    text.startsWith("uk-") ||
    text.includes("united kingdom") ||
    text.includes("britain")
  ) {
    return "UK";
  }

  if (
    text.startsWith("ea-") ||
    text.startsWith("euro-") ||
    text.includes("euro area") ||
    text.includes("eurozone")
  ) {
    return "EA";
  }

  return "OTHER";
}

/**
 * The presence of actualReleasedAt is the authoritative signal that
 * the metric has actually been released.
 *
 * A scheduled time passing does NOT itself make a metric released.
 */
function statusFor(
  scheduledDate: string,
  today: string,
  actual: ActualInfo | undefined
) {
  if (actual?.actualReleasedAt) {
    return "released";
  }

  if (scheduledDate > today) {
    return "upcoming";
  }

  if (scheduledDate === today) {
    return "pending";
  }

  return "past";
}

export async function GET(req: NextRequest) {
  try {
    // The request object is intentionally retained for Next.js route
    // compatibility, but the calendar always uses UK time.
    void req;

    const timeZone = DISPLAY_TIME_ZONE;
    const now = new Date();

    const today = dateKeyInTimeZone(now, timeZone);

    // --------------------------------------------------
    // Monday -> Sunday window
    // --------------------------------------------------

    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(now);

    const weekdayIndex: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };

    const mondayOffset = weekdayIndex[weekday] ?? 0;

    const weekStart = addDaysToKey(
      today,
      -mondayOffset
    );

    const weekEnd = addDaysToKey(
      weekStart,
      7
    );

    // --------------------------------------------------
    // Scheduled calendar
    // --------------------------------------------------

    const schedule =
      await getEconomicCalendarRows();

    // --------------------------------------------------
    // Actual releases
    //
    // Only the releases table determines whether an
    // official release has actually happened.
    // --------------------------------------------------

    const db = getDb();

    /*
     * Query a broad UTC window covering the current
     * calendar week.
     *
     * This is deliberately broader than just today
     * because the display timezone is not UTC.
     */
    const releaseStart =
      new Date(`${weekStart}T00:00:00Z`);

    const releaseEnd =
      new Date(`${weekEnd}T00:00:00Z`);

    const releaseRows = await db
      .select({
        metricId: releases.metricId,
        value: releases.value,
        expectedValue: releases.expectedValue,
        priorPeriodValue:
          releases.priorPeriodValue,
        releasedAt: releases.releasedAt,
      })
      .from(releases)
      .where(
        and(
          gte(
            releases.releasedAt,
            releaseStart.toISOString()
          ),
          lt(
            releases.releasedAt,
            releaseEnd.toISOString()
          )
        )
      );

    const actualMap =
      new Map<string, ActualInfo>();

    for (const row of releaseRows) {
      if (!row.metricId) continue;

      /*
       * If multiple release rows exist for a metric,
       * retain the latest actual release timestamp.
       */
      const existing =
        actualMap.get(row.metricId);

      if (
        existing?.actualReleasedAt &&
        row.releasedAt &&
        new Date(row.releasedAt).getTime() <=
          new Date(
            existing.actualReleasedAt
          ).getTime()
      ) {
        continue;
      }

      actualMap.set(row.metricId, {
        actual: row.value ?? null,
        forecast:
          row.expectedValue ?? null,
        previous:
          row.priorPeriodValue ?? null,
        actualReleasedAt:
          row.releasedAt ?? null,
      });
    }

    // --------------------------------------------------
    // Build events
    // --------------------------------------------------

    const events = schedule
      .map((row) => {
        const fallbackDate =
          normalizeDateKey(
            row.nextReleaseDate
          );

        if (!fallbackDate) return null;

        const actual =
          actualMap.get(row.metricId);

        /*
         * IMPORTANT:
         *
         * scheduledAt is the OFFICIAL scheduled release
         * timestamp.
         *
         * actualReleasedAt is the timestamp stored with
         * the actual data release/ingestion record.
         *
         * They must never be conflated.
         *
         * For Eurostat, if the calendar row has only a
         * date and no nextReleaseAt, we reconstruct the
         * official 11:00 Europe/Luxembourg timestamp.
         */
        const scheduledAt =
          eurostatScheduledAt(
            row.source,
            row.nextReleaseDate,
            row.nextReleaseAt ?? null
          );

        /*
         * Keep the calendar's scheduled date as the
         * calendar date. Do NOT replace it with the
         * ingestion timestamp.
         */
        const scheduledDate =
          fallbackDate;

        return {
          metricId: row.metricId,

          metricName:
            row.metricName ||
            row.metricId,

          region: inferRegion(
            row.metricId,
            row.metricName
          ),

          source: row.source,

          family: row.family,

          scheduledDate,

          /*
           * THIS is the time shown in the dashboard.
           *
           * It comes from the official scheduled release
           * timestamp, not from releases.releasedAt.
           *
           * Europe/London automatically converts:
           * Eurostat 11:00 CEST -> UK 10:00 BST
           * Eurostat 11:00 CET  -> UK 10:00 GMT
           */
          scheduledTime:
            releaseTime(scheduledAt),

          /*
           * Original official scheduled timestamp.
           */
          scheduledAt,

          status: statusFor(
            scheduledDate,
            today,
            actual
          ),

          actual:
            actual?.actual ?? null,

          forecast:
            actual?.forecast ?? null,

          previous:
            actual?.previous ?? null,

          /*
           * This is the timestamp from the actual release
           * record. It is NOT used as the official calendar
           * display time.
           */
          releasedAt:
            actual?.actualReleasedAt ?? null,

          actualReleasedAt:
            actual?.actualReleasedAt ?? null,

          officialSource:
            row.officialSource,

          updatedAt:
            row.updatedAt,
        };
      })
      .filter(
        (
          event
        ): event is NonNullable<typeof event> =>
          event !== null &&
          event.scheduledDate >= weekStart &&
          event.scheduledDate < weekEnd
      );

    // --------------------------------------------------
    // Today's events
    // --------------------------------------------------

    const todayEvents = events
      .filter(
        (event) =>
          event.scheduledDate === today
      )
      .sort((a, b) => {
        const at =
          a.scheduledTime ?? "99:99";

        const bt =
          b.scheduledTime ?? "99:99";

        return (
          at.localeCompare(bt) ||
          a.metricName.localeCompare(
            b.metricName
          )
        );
      });

    // --------------------------------------------------
    // Group entire week
    // --------------------------------------------------

    const week = events.reduce<
      Record<string, typeof events>
    >(
      (acc, event) => {
        (acc[event.scheduledDate] ??= [])
          .push(event);

        return acc;
      },
      {}
    );

    for (const key of Object.keys(week)) {
      week[key].sort((a, b) => {
        const at =
          a.scheduledTime ?? "99:99";

        const bt =
          b.scheduledTime ?? "99:99";

        return (
          at.localeCompare(bt) ||
          a.metricName.localeCompare(
            b.metricName
          )
        );
      });
    }

    // --------------------------------------------------
    // Last calendar update
    // --------------------------------------------------

    const lastUpdated =
      schedule
        .map((row) => row.updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    // --------------------------------------------------
    // Response
    // --------------------------------------------------

    return NextResponse.json(
      {
        today,
        weekStart,
        weekEnd,

        // Explicitly tell the frontend that all
        // calendar times are UK/BST/GMT.
        timeZone,

        todayEvents,
        week,
        lastUpdated,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Economic calendar API error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Economic calendar unavailable",
      },
      {
        status: 500,
      }
    );
  }
}
