"use client";

import {
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareCalendarMetricEvents, filterReleaseDiaryEvents, type CalendarRegionFilter } from "@/lib/economic-calendar-view";
import { formatLiveSourceLabel } from "@/lib/live-source-label";
import { getClientJsonCache, refreshClientJson } from "@/lib/client-json-cache";
import { formatClaimsCount } from "@/lib/claims-display";

type CalendarEvent = {
  metricId: string;
  metricName: string;
  unit: string;
  region: "US" | "UK" | "EA" | "OTHER";
  source: string | null;
  liveSource: string | null;
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
  recentEvents: CalendarEvent[];
  week: Record<string, CalendarEvent[]>;
  lastUpdated: string | null;
  allEvents: CalendarEvent[];
  nextReleaseEvents: CalendarEvent[];
  coverage: { totalMetrics: number; exactTime: number; deadline: number; dateOnly: number; daily: number; hourly: number; unannounced: number; sourceErrors: number };
  error?: string;
};

type Tab = "upcoming" | "history" | "all";
const COUNTRY_LABEL: Record<CalendarRegionFilter, string> = {
  ALL: "all countries",
  US: "the United States",
  UK: "the United Kingdom",
  EA: "the Euro Area",
};

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

function formatValue(value: number | null, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
  const suffix: Record<string, string> = {
    percent: "%", thousands: "k", usd_billions: "bn USD", eur_millions: "m EUR", gbp_millions: "m GBP",
    hours: " hrs", posts: " posts",
  };
  return `${number}${suffix[unit] ?? ""}`;
}

function formatCalendarValue(event: CalendarEvent, value: number | null) {
  if (event.metricId === "us-initial-claims" || event.metricId === "us-continuing-claims") {
    return formatClaimsCount(value);
  }
  return formatValue(value, event.unit);
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
  const initialPayload = getClientJsonCache<CalendarPayload>("economic-calendar:sidebar") ?? null;
  const [tab, setTab] = useState<Tab>("upcoming");
  const [country, setCountry] = useState<CalendarRegionFilter>("ALL");
  const [payload, setPayload] = useState<CalendarPayload | null>(initialPayload);
  const [loading, setLoading] = useState(initialPayload == null);
  const [error, setError] = useState("");
  const previousPayload = useRef<CalendarPayload | null>(initialPayload);
  const announced = useRef(new Set<string>());
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const data = await refreshClientJson<CalendarPayload>(
        "economic-calendar:sidebar",
        `/api/economic-calendar?timezone=${encodeURIComponent(DISPLAY_TIME_ZONE)}`,
        "Economic calendar request failed."
      );

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
      requestInFlight.current = false;
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

  const diaryGroups = useMemo(() => {
    if (!payload) return [] as { date: string; events: CalendarEvent[] }[];
    if (tab !== "all") {
      const historyAndUpcoming = [...(payload.recentEvents ?? []), ...(payload.allEvents ?? []), ...(payload.nextReleaseEvents ?? [])];
      const uniqueEvents = new Map<string, CalendarEvent>();
      for (const event of filterReleaseDiaryEvents(historyAndUpcoming, tab, payload.today, country)) {
        uniqueEvents.set(`${event.metricId}:${event.scheduledDate}`, event);
      }
      const groups = new Map<string, CalendarEvent[]>();
      for (const event of [...uniqueEvents.values()].sort(compareCalendarEvents)) {
        const day = event.scheduledDate!;
        groups.set(day, [...(groups.get(day) ?? []), event]);
      }
      return Array.from(groups, ([date, events]) => ({ date, events }))
        .sort((a, b) => tab === "history" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))
        .map(({ date, events }) => ({ date: formatDay(date), events }));
    }
    return [];
  }, [payload, tab, country]);

  const allMetricEvents = useMemo(() => {
    const events = (payload?.nextReleaseEvents ?? []).filter(event => event.region !== "OTHER" && (country === "ALL" || event.region === country));
    return events.sort((a, b) => regionOrder(a.region) - regionOrder(b.region) ||
      (a.scheduledDate ?? "9999-12-31").localeCompare(b.scheduledDate ?? "9999-12-31") ||
      (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99") ||
      compareCalendarMetricEvents(a, b));
  }, [payload, country]);

  const emptyText = tab === "upcoming"
    ? `No scheduled releases for ${COUNTRY_LABEL[country]} today or in the next 7 days.`
    : tab === "history"
      ? `No published releases for ${COUNTRY_LABEL[country]} in the last 7 days.`
      : `No metrics are available for ${COUNTRY_LABEL[country]}.`;

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

      <div className="economic-calendar-country-filter">
        <label htmlFor="release-diary-country">Country</label>
        <select id="release-diary-country" value={country} onChange={event => setCountry(event.target.value as CalendarRegionFilter)}>
          <option value="ALL">All countries</option>
          <option value="US">United States</option>
          <option value="UK">United Kingdom</option>
          <option value="EA">Euro Area</option>
        </select>
      </div>

      <div className="economic-calendar-tabs">
        <button
          type="button"
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          Upcoming
        </button>

        <button
          type="button"
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          History
        </button>
        <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          All Metrics
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
        <>
          {tab !== "all" && <div className="release-diary-window-note">{tab === "upcoming" ? "Today and next 7 days" : "Last 7 days · Published releases"}</div>}
          {tab === "all"
            ? <AllMetricsDiary events={allMetricEvents} onSelect={onReleaseSelect} emptyText={emptyText} />
            : <CalendarDiary groups={diaryGroups} onSelect={onReleaseSelect} emptyText={emptyText} />}
        </>
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

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent) {
  return (a.scheduledDate ?? "9999-12-31").localeCompare(b.scheduledDate ?? "9999-12-31") ||
    (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99") ||
    compareCalendarMetricEvents(a, b);
}

function regionOrder(region: CalendarEvent["region"]) {
  return region === "US" ? 0 : region === "UK" ? 1 : region === "EA" ? 2 : 3;
}

function regionLabel(region: CalendarEvent["region"]) {
  return region === "US" ? "United States" : region === "UK" ? "United Kingdom" : region === "EA" ? "Euro Area" : "Other";
}

function AllMetricsDiary({ events, onSelect, emptyText }: {
  events: CalendarEvent[];
  onSelect?: (event: { metricId: string; region: string; metricName: string }) => void;
  emptyText: string;
}) {
  if (!events.length) return <div className="economic-calendar-list release-diary"><div className="economic-calendar-empty">{emptyText}</div></div>;
  const groups = new Map<CalendarEvent["region"], CalendarEvent[]>();
  for (const event of events) groups.set(event.region, [...(groups.get(event.region) ?? []), event]);
  return <div className="economic-calendar-list release-diary all-metrics-diary">
    <div className="all-metrics-diary-head" aria-hidden="true"><span>Next release</span><span>Metric</span><span>Source</span><span>Status</span></div>
    {[...groups.entries()].sort(([a], [b]) => regionOrder(a) - regionOrder(b)).map(([region, regionEvents]) => <section className="release-diary-group" key={region}>
      <h3>{FLAG[region]} {regionLabel(region)} <span>· {regionEvents.length} metrics</span></h3>
      {regionEvents.map((event, index) => {
        const dateLabel = event.scheduledDate ? formatDay(event.scheduledDate) : event.scheduleType === "daily" ? "Daily" : event.scheduleType === "hourly" ? "Hourly" : event.scheduleType === "source-error" ? "Schedule unavailable" : "Not announced";
        const timeLabel = event.scheduledDate ? event.scheduledTimeLabel ?? formatTime(event.scheduledTime) : "";
        const eventStatusLabel = event.scheduleType === "hourly" ? "Hourly" : event.scheduleType === "daily" ? "Daily" : event.scheduleType === "source-error" ? "Source unavailable" : event.status === "unscheduled" ? "Not announced" : statusLabel(event.status);
        const canOpen = event.region !== "OTHER";
        return <div key={`${event.metricId}-${index}`} className={`all-metrics-diary-row ${event.status} ${canOpen ? "is-component-link" : ""}`} role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} title={event.scheduleNote ?? undefined} onClick={() => { if (canOpen) onSelect?.(event); }} onKeyDown={keyboardEvent => { if (canOpen && (keyboardEvent.key === "Enter" || keyboardEvent.key === " ")) { keyboardEvent.preventDefault(); onSelect?.(event); } }}>
          <span className="all-metrics-next-release"><b>{dateLabel}</b>{timeLabel && <small>{timeLabel}</small>}</span>
          <span className="all-metrics-name">{event.metricName}</span>
          <span className="all-metrics-source">{formatLiveSourceLabel(event.liveSource)}</span>
          <span className={`release-diary-status ${event.status}`}><i />{eventStatusLabel}</span>
        </div>;
      })}
    </section>)}
  </div>;
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
        const timeLabel = event.scheduleType === "daily"
          ? "Daily"
          : event.scheduleType === "hourly"
            ? "Hourly"
            : event.scheduledDate
              ? event.scheduledTimeLabel ?? formatTime(event.scheduledTime)
              : "—";
        const timeUnavailable = timeLabel === "Time unavailable";
        return <div key={`${event.metricId}-${event.scheduledAt ?? event.scheduledDate ?? index}`} className={`release-diary-row ${event.status} ${canOpen ? "is-component-link" : ""}`} role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} onClick={() => { if (canOpen) onSelect?.(event); }} onKeyDown={keyboardEvent => { if (canOpen && (keyboardEvent.key === "Enter" || keyboardEvent.key === " ")) { keyboardEvent.preventDefault(); onSelect?.(event); } }}>
          <span className={`release-diary-time${timeUnavailable ? " unavailable" : ""}`}>
            {timeUnavailable ? <>Time<br />unavailable</> : timeLabel}
          </span>
          <span className="release-diary-name"><i>{FLAG[event.region]}</i><span>{event.metricName}</span></span>
          <span className="release-diary-value">{formatCalendarValue(event, event.previous)}</span>
          <span className="release-diary-value">{formatCalendarValue(event, event.actual)}</span>
          <span className={`release-diary-status ${event.status}`}><i />{event.scheduleType === "hourly" ? "Hourly" : event.scheduleType === "daily" ? "Daily" : statusLabel(event.status)}</span>
        </div>;
      })}
    </section>)}
  </div>;
}
