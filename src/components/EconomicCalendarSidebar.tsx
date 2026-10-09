"use client";

import {
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CalendarEvent = {
  metricId: string;
  metricName: string;
  region: "US" | "UK" | "EA" | "OTHER";
  source: string | null;
  family: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  scheduledAt: string | null;
  scheduledTimeLabel: string;
  status: "released" | "pending" | "upcoming" | "past" | "unscheduled";
  scheduleType: "scheduled" | "daily" | "hourly" | "unannounced" | "source-error";
  scheduleNote: string | null;
  actual: number | null;
  actualReleasedAt: string | null;
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
  dailyEvents: CalendarEvent[];
  week: Record<string, CalendarEvent[]>;
  lastUpdated: string | null;
  allEvents: CalendarEvent[];
  coverage: { totalMetrics: number; exactTime: number; deadline: number; dateOnly: number; daily: number; hourly: number; unannounced: number; sourceErrors: number };
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

function formatDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);

  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
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

export function EconomicCalendarSidebar({ onReleaseSelect }: { onReleaseSelect?: (event: { metricId: string; region: string; metricName: string }) => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const previousPayload = useRef<CalendarPayload | null>(null);
  const announced = useRef(new Set<string>());

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

      const previous = previousPayload.current;
      const now = Date.now();
      for (const event of data.allEvents ?? []) {
        if (event.scheduledAt) {
          const remaining = Date.parse(event.scheduledAt) - now;
          const stage = remaining > 60_000 && remaining <= 120_000
            ? "2m"
            : remaining > 0 && remaining <= 60_000
              ? "1m"
              : null;
          const key = `${event.metricId}:${event.scheduledAt}:${stage}`;
          if (stage && !announced.current.has(key)) {
            announced.current.add(key);
            window.dispatchEvent(new CustomEvent("macrohub:release-notice", {
              detail: {
                kind: "reminder",
                metricId: event.metricId,
                metricName: event.metricName,
                region: event.region,
                stage,
                secondsRemaining: Math.max(1, Math.ceil(remaining / 1000)),
              },
            }));
          }
        }

        if (!previous) continue;
        const oldEvent = previous.allEvents.find((candidate) =>
          candidate.metricId === event.metricId &&
          (candidate.scheduledAt ?? candidate.scheduledDate) === (event.scheduledAt ?? event.scheduledDate)
        );
        const releaseKey = `released:${event.metricId}:${event.scheduledAt ?? event.scheduledDate ?? "unknown"}`;
        if (event.status === "released" && oldEvent?.status !== "released" && !announced.current.has(releaseKey)) {
          announced.current.add(releaseKey);
          window.dispatchEvent(new CustomEvent("macrohub:release-notice", {
            detail: {
              kind: "released",
              metricId: event.metricId,
              metricName: event.metricName,
              region: event.region,
              actual: event.actual,
              releasedAt: event.actualReleasedAt,
            },
          }));
        }
      }

      previousPayload.current = data;
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

  const diaryGroups = useMemo(() => {
    if (!payload) return [] as { date: string; events: CalendarEvent[] }[];
    if (tab === "today") return [
      ...(payload.todayEvents.length ? [{ date: formatDay(payload.today), events: payload.todayEvents }] : []),
      ...(payload.dailyEvents.length ? [{ date: "Daily and hourly metrics · no fixed release time", events: payload.dailyEvents }] : []),
    ];
    if (tab === "week") return weekDays.map(({ date, events }) => ({ date: formatDay(date), events }));
    const groups = new Map<string, CalendarEvent[]>();
    for (const event of payload.allEvents) {
      const label = event.scheduledDate ? formatDay(event.scheduledDate)
        : event.scheduleType === "daily" || event.scheduleType === "hourly"
          ? `${event.scheduleType === "hourly" ? "Hourly" : "Daily"} data · no fixed release`
          : "Next date unavailable";
      groups.set(label, [...(groups.get(label) ?? []), event]);
    }
    return Array.from(groups, ([date, events]) => ({ date, events }));
  }, [payload, tab, weekDays]);

  return (
    <section className="economic-calendar-sidebar">
      <div className="economic-calendar-head">
        <div>
          <div className="economic-calendar-kicker">
            <CalendarDays size={14} />
            ECONOMIC CALENDAR
          </div>

          <h2>Release Diary</h2>
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
      ) : (
        <CalendarDiary groups={diaryGroups} onSelect={onReleaseSelect} emptyText={tab === "today" ? "No scheduled releases today." : tab === "week" ? "No scheduled releases this week." : "No releases available."} />
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

function CalendarDiary({ groups, onSelect, emptyText }: {
  groups: { date: string; events: CalendarEvent[] }[];
  onSelect?: (event: { metricId: string; region: string; metricName: string }) => void;
  emptyText: string;
}) {
  if (!groups.length) return <div className="economic-calendar-list release-diary"><div className="economic-calendar-empty">{emptyText}</div></div>;
  return <div className="economic-calendar-list release-diary">
    <div className="release-diary-head" aria-hidden="true"><span>Date &amp; time</span><span>Release</span><span>Previous</span><span>Actual</span><span>Status</span></div>
    {groups.map((group, groupIndex) => <section className="release-diary-group" key={`${group.date}-${groupIndex}`}>
      <h3>{group.date}</h3>
      {group.events.map((event, index) => {
        const canOpen = event.region !== "OTHER" && event.status !== "unscheduled";
        return <div key={`${event.metricId}-${event.scheduledAt ?? event.scheduledDate ?? index}`} className={`release-diary-row ${event.status} ${canOpen ? "is-component-link" : ""}`} role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} onClick={() => { if (canOpen) onSelect?.(event); }} onKeyDown={keyboardEvent => { if (canOpen && (keyboardEvent.key === "Enter" || keyboardEvent.key === " ")) { keyboardEvent.preventDefault(); onSelect?.(event); } }}>
          <span className="release-diary-time">{event.scheduleType === "daily" ? "Daily" : event.scheduleType === "hourly" ? "Hourly" : event.scheduledDate ? event.scheduledTimeLabel ?? formatTime(event.scheduledTime) : "—"}</span>
          <span className="release-diary-name"><i>{FLAG[event.region]}</i><span>{event.metricName}</span></span>
          <span className="release-diary-value">{formatValue(event.previous)}</span>
          <span className="release-diary-value">{formatValue(event.actual)}</span>
          <span className={`release-diary-status ${event.status}`}><i />{event.scheduleType === "hourly" ? "Hourly" : event.scheduleType === "daily" ? "Daily" : statusLabel(event.status)}</span>
        </div>;
      })}
    </section>)}
  </div>;
}
