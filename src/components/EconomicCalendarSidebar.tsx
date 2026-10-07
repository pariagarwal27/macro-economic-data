"use client";

import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type CalendarEvent = {
  metricId: string;
  metricName: string;
  region: "US" | "UK" | "EA" | "OTHER";
  source: string | null;
  family: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  scheduledTimeLabel: string;
  status: "released" | "pending" | "upcoming" | "past" | "unscheduled";
  scheduleType: "scheduled" | "daily" | "unannounced" | "source-error";
  scheduleNote: string | null;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  releasedAt: string | null;
  officialSource: string | null;
  updatedAt: string | null;
};

type CalendarPayload = {
  today: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayEvents: CalendarEvent[];
  week: Record<string, CalendarEvent[]>;
  lastUpdated: string | null;
  allEvents: CalendarEvent[];
  coverage: { totalMetrics: number; exactTime: number; deadline: number; dateOnly: number; daily: number; unannounced: number; sourceErrors: number };
  error?: string;
};

type Tab = "today" | "week" | "all";

/**
 * All economic calendar dates/times displayed in the UI
 * are based on UK local time.
 *
 * Europe/London automatically handles:
 * - BST (UTC+1) during summer
 * - GMT (UTC+0) during winter
 */
const DISPLAY_TIME_ZONE = "Europe/London";

const FLAG: Record<CalendarEvent["region"], string> = {
  US: "🇺🇸",
  UK: "🇬🇧",
  EA: "🇪🇺",
  OTHER: "🌐",
};

const REGION_LABEL: Record<CalendarEvent["region"], string> = {
  US: "US",
  UK: "UK",
  EA: "Euro Area",
  OTHER: "Other",
};

function formatDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);

  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

function formatTime(time: string | null) {
  return time ?? "Time unavailable";
}

function formatValue(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";

  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2);
}

function statusLabel(status: CalendarEvent["status"]) {
  if (status === "released") return "Released";
  if (status === "pending") return "Pending";
  if (status === "upcoming") return "Upcoming";
  if (status === "unscheduled") return "No date";
  return "Past";
}

function formatLastUpdated(timestamp: string) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function EconomicCalendarSidebar() {
  const [tab, setTab] = useState<Tab>("today");
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/economic-calendar?timezone=${encodeURIComponent(
          DISPLAY_TIME_ZONE
        )}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Economic calendar request failed."
        );
      }

      const data = (await response.json()) as CalendarPayload;

      if (data.error) {
        throw new Error(data.error);
      }

      setPayload(data);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Economic calendar unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    // Status changes throughout release day, so refresh the UI
    // without requiring the whole dashboard to reload.
    const timer = window.setInterval(() => {
      void load();
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [load]);

  const weekDays = useMemo(() => {
    if (!payload) return [];

    return Object.entries(payload.week)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => ({
        date,
        events,
      }));
  }, [payload]);

  return (
    <section className="economic-calendar-sidebar">
      <div className="economic-calendar-head">
        <div>
          <div className="economic-calendar-kicker">
            <CalendarDays size={14} />
            ECONOMIC CALENDAR
          </div>

          <h2>Releases</h2>
          <p className="economic-calendar-subtitle">Official data. At a glance.</p>
        </div>

        <button
          type="button"
          className="economic-calendar-refresh"
          onClick={() => void load()}
          aria-label="Refresh economic calendar"
          title="Refresh economic calendar"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="economic-calendar-tabs">
        <button
          type="button"
          className={tab === "today" ? "active" : ""}
          onClick={() => setTab("today")}
        >
          Today
        </button>

        <button
          type="button"
          className={tab === "week" ? "active" : ""}
          onClick={() => setTab("week")}
        >
          This Week
        </button>
        <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          All releases
        </button>
      </div>

      {loading && !payload ? (
        <div className="economic-calendar-empty">
          Loading release calendar…
        </div>
      ) : error ? (
        <div className="economic-calendar-error">
          <b>Calendar unavailable</b>
          <span>{error}</span>

          <button
            type="button"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      ) : tab === "today" ? (
        <div className="economic-calendar-list">
          <div className="economic-calendar-date-heading">
            {payload
              ? formatDay(payload.today)
              : "Today"}
          </div>

          {!payload?.todayEvents.length ? (
            <div className="economic-calendar-empty">
              No scheduled releases today.
            </div>
          ) : (
            payload.todayEvents.map((event) => (
              <CalendarEventRow
                key={`${event.metricId}-${event.scheduledDate}`}
                event={event}
              />
            ))
          )}
        </div>
      ) : tab === "all" ? (
        <div className="economic-calendar-list">
          <div className="economic-calendar-date-heading">All {payload?.coverage.totalMetrics ?? 0} metrics · UK time</div>
          {payload && <div className="economic-calendar-coverage">{payload.coverage.exactTime} confirmed times · {payload.coverage.dateOnly} date-only releases</div>}
          {payload?.allEvents.map(event => (
            <div key={event.metricId}>
              <div className="economic-calendar-date-heading">{event.scheduledDate ? formatDay(event.scheduledDate) : event.scheduleType === "daily" ? "Daily data · no fixed release" : "Next date unavailable"}</div>
              <CalendarEventRow event={event} />
            </div>
          ))}
        </div>
      ) : (
        <div className="economic-calendar-week">
          {weekDays.map(({ date, events }) => (
            <div
              className="economic-calendar-day"
              key={date}
            >
              <div className="economic-calendar-day-title">
                <span>{formatDay(date)}</span>
                <b>{events.length}</b>
              </div>

              {events.map((event) => (
                <CalendarEventRow
                  key={`${event.metricId}-${date}`}
                  event={event}
                  compact
                />
              ))}
            </div>
          ))}

          {!weekDays.length && (
            <div className="economic-calendar-empty">
              No scheduled releases this week.
            </div>
          )}
        </div>
      )}

      {payload?.lastUpdated && (
        <div className="economic-calendar-footer">
          <span className="economic-calendar-footer-label">Last synced</span>{" "}
          {formatLastUpdated(payload.lastUpdated)}
          <div>UK time (BST/GMT). “By” and “Before” indicate publication deadlines. Unannounced times are not estimated.</div>
        </div>
      )}
    </section>
  );
}

function CalendarEventRow({
  event,
  compact = false,
}: {
  event: CalendarEvent;
  compact?: boolean;
}) {
  const released = event.status === "released";

  return (
    <div
      className={[
        "economic-calendar-event",
        compact ? "compact" : "",
        released ? "is-released" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="economic-calendar-time">
        <Clock3 size={12} />
        <span title={event.scheduleNote ?? undefined}>{event.scheduleType === "daily" ? "Daily" : !event.scheduledDate ? "No date" : event.scheduledTimeLabel ?? formatTime(event.scheduledTime)}</span>
      </div>

      <div className="economic-calendar-event-main">
        <div className="economic-calendar-event-title">
          <span className="economic-calendar-flag">
            {FLAG[event.region]}
          </span>

          <span className="economic-calendar-region">
            {REGION_LABEL[event.region]}
          </span>
        </div>

        <div className="economic-calendar-event-name">
          <a href={event.officialSource ?? undefined} target="_blank" rel="noreferrer" title="Open official source">{event.metricName}</a>
        </div>

        {!compact && (
          <div className="economic-calendar-values">
            {released ? (
              <>
                <span>
                  Actual <b>{formatValue(event.actual)}</b>
                </span>

                <span>
                  Forecast{" "}
                  <b>{formatValue(event.forecast)}</b>
                </span>

                <span>
                  Previous{" "}
                  <b>{formatValue(event.previous)}</b>
                </span>
              </>
            ) : (
              <span>
                {event.source ?? "Official source"}
              </span>
            )}
          </div>
        )}
        {event.scheduleNote && !event.scheduledTime && <div className="economic-calendar-values">{event.scheduleNote}</div>}
      </div>

      <div
        className={[
          "economic-calendar-status",
          event.status,
        ].join(" ")}
      >
        {event.status === "released" ? (
          <CheckCircle2 size={12} />
        ) : (
          <span className="economic-calendar-status-dot" />
        )}

        {event.scheduleType === "daily" ? "Daily" : event.scheduleType === "source-error" ? "Source error" : statusLabel(event.status)}
      </div>
    </div>
  );
}
