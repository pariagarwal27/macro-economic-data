"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatObsDate, formatValue } from "@/lib/format";
import { surpriseTone } from "@/lib/surprise";
import {
  dayKey,
  formatDayHeader,
  formatRawCalendarValue,
  formatUtcTime,
  importanceStars,
} from "@/lib/calendar-tape";

type TapeEvent = {
  releasedAt: string;
  periodDate: string | null;
  periodLabel: string | null;
  eventName: string;
  country: string;
  currency: string | null;
  metricId: string | null;
  shortName: string | null;
  unit: string | null;
  region: string | null;
  tapeRegion: string;
  category: string | null;
  importance: number | null;
  eventKind: "data" | "speaker" | "policy" | "auction" | "other";
  speakerInstitution: string | null;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  rawActual: string | null;
  rawForecast: string | null;
  rawPrevious: string | null;
  status: "upcoming" | "released";
  hasForecast: boolean;
};

type TapeResponse = {
  events: TapeEvent[];
  meta: {
    from: string;
    to: string;
    days: number;
    forwardOnly: boolean;
    dataThrough: string | null;
    total: number;
    withForecast: number;
    speakers: number;
    windowDays: string[];
  };
};

const REGIONS = ["ALL", "US", "UK", "EA"] as const;
const KINDS = [
  { id: "all", label: "All releases" },
  { id: "data", label: "Data prints" },
  { id: "speakers", label: "CB speakers" },
  { id: "policy", label: "Policy" },
] as const;

type Kind = (typeof KINDS)[number]["id"];
type ViewMode = "table" | "matrix";

function Stars({ n }: { n: number }) {
  if (!n) return <span className="text-[var(--line)]">·</span>;
  return (
    <span className="tracking-tight text-amber-600" title={`${n}/3 importance`}>
      {"★".repeat(n)}
      <span className="text-[var(--line)]">{"★".repeat(3 - n)}</span>
    </span>
  );
}

function RegionBadge({ region }: { region: string }) {
  const colors: Record<string, string> = {
    US: "bg-blue-50 text-blue-800 border-blue-200",
    UK: "bg-purple-50 text-purple-800 border-purple-200",
    EA: "bg-amber-50 text-amber-900 border-amber-200",
  };
  return (
    <span
      className={clsx(
        "inline-flex min-w-[2rem] justify-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase",
        colors[region] ?? "bg-[var(--line)]/40 text-[var(--muted)] border-[var(--line)]"
      )}
    >
      {region}
    </span>
  );
}

function ConsensusCell({ ev }: { ev: TapeEvent }) {
  const unit = ev.unit ?? "number";
  if (ev.eventKind === "speaker") return <span className="text-[var(--muted)]">—</span>;
  if (ev.forecast != null) return <span>{formatValue(ev.forecast, unit)}</span>;
  return <span>{formatRawCalendarValue(null, ev.rawForecast)}</span>;
}

function PreviousCell({ ev }: { ev: TapeEvent }) {
  const unit = ev.unit ?? "number";
  if (ev.previous != null) return <span>{formatValue(ev.previous, unit)}</span>;
  return <span>{formatRawCalendarValue(null, ev.rawPrevious)}</span>;
}

function ActualCell({ ev }: { ev: TapeEvent }) {
  const unit = ev.unit ?? "number";
  if (ev.actual == null) {
    return <span className="text-[var(--muted)]">pending</span>;
  }
  const surprise =
    ev.forecast != null && ev.metricId ? ev.actual - ev.forecast : null;
  const tone =
    surprise != null && ev.metricId
      ? surpriseTone(surprise, ev.metricId, unit)
      : "neutral";
  const display =
    ev.actual != null ? formatValue(ev.actual, unit) : formatRawCalendarValue(null, ev.rawActual);
  return (
    <span
      className={clsx(
        "font-semibold",
        tone === "good" && "text-[var(--up)]",
        tone === "bad" && "text-[var(--down)]"
      )}
    >
      {display}
    </span>
  );
}

function EventTitle({ ev }: { ev: TapeEvent }) {
  const label = ev.shortName ?? ev.eventName;
  if (ev.metricId) {
    return (
      <Link href={`/metrics/${ev.metricId}`} className="font-medium text-[var(--accent-ink)] hover:underline">
        {label}
      </Link>
    );
  }
  return <span className="font-medium text-[var(--ink)]">{ev.eventName}</span>;
}

function MatrixCell({ events }: { events: TapeEvent[] }) {
  if (!events.length) {
    return <div className="min-h-[3rem] text-[10px] text-[var(--line)]">—</div>;
  }
  return (
    <div className="space-y-2">
      {events.map((ev) => (
        <div
          key={`${ev.releasedAt}-${ev.eventName}`}
          className={clsx(
            "rounded-md border px-2 py-1.5 text-[11px] leading-snug",
            ev.eventKind === "speaker"
              ? "border-violet-200 bg-violet-50/80"
              : ev.status === "released"
                ? "border-[var(--line)] bg-white/60"
                : "border-[var(--accent)]/25 bg-[var(--accent-soft)]"
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">
              {formatUtcTime(ev.releasedAt)}
            </span>
            <RegionBadge region={ev.tapeRegion} />
          </div>
          <div className="mt-0.5">
            <EventTitle ev={ev} />
          </div>
          {ev.eventKind === "speaker" && ev.speakerInstitution && (
            <div className="mt-0.5 text-[10px] font-semibold uppercase text-violet-700">
              {ev.speakerInstitution}
            </div>
          )}
          {ev.eventKind !== "speaker" && (
            <div className="mt-1 grid grid-cols-3 gap-1 font-[family-name:var(--font-mono)] text-[10px]">
              <div>
                <div className="text-[var(--muted)]">Cons</div>
                <ConsensusCell ev={ev} />
              </div>
              <div>
                <div className="text-[var(--muted)]">Prev</div>
                <PreviousCell ev={ev} />
              </div>
              <div>
                <div className="text-[var(--muted)]">Act</div>
                <ActualCell ev={ev} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ReleaseCalendar() {
  const [region, setRegion] = useState<(typeof REGIONS)[number]>("ALL");
  const [kind, setKind] = useState<Kind>("all");
  const [view, setView] = useState<ViewMode>("table");
  const [data, setData] = useState<TapeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      region,
      days: "7",
      kind,
      forwardOnly: "true",
    });
    fetch(`/api/calendar?${params}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        setData(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [region, kind]);

  const events = data?.events ?? [];
  const meta = data?.meta;

  const byDay = useMemo(() => {
    const map = new Map<string, TapeEvent[]>();
    for (const day of meta?.windowDays ?? []) map.set(day, []);
    for (const ev of events) {
      const d = dayKey(ev.releasedAt);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(ev);
    }
    return map;
  }, [events, meta?.windowDays]);

  const dataGap =
    meta?.dataThrough &&
    meta.windowDays?.length &&
    meta.dataThrough.slice(0, 10) < meta.windowDays[meta.windowDays.length - 1];

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-16 pt-8 sm:px-6">
      <Link href="/" className="text-sm text-[var(--accent-ink)] hover:underline">
        ← Dashboard
      </Link>

      <header className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-6 py-8">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Official release calendar</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Release calendar
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Upcoming macro releases with scheduled time, prior and consensus where available. Release events are stored in the application database and reconciled automatically.
        </p>

        <div className="mt-5 flex flex-wrap gap-6 text-xs text-[var(--muted)]">
          <span>
            <strong className="text-[var(--ink)]">{meta?.total ?? "—"}</strong> events
          </span>
          <span>
            <strong className="text-[var(--ink)]">{meta?.withForecast ?? "—"}</strong> with consensus
          </span>
          <span>
            <strong className="text-[var(--ink)]">{meta?.speakers ?? "—"}</strong> CB speakers
          </span>
          {meta?.dataThrough && (
            <span>
              Data through{" "}
              <strong className="text-[var(--ink)]">{formatObsDate(meta.dataThrough)}</strong>
            </span>
          )}
        </div>

        {dataGap && (
          <div className="mt-4 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Calendar dumps end before the full 7-day window. Refresh the official calendar source to extend the window:
            <code className="mx-1 rounded bg-white/80 px-1.5 py-0.5 text-xs">
              npx tsx scripts/capture-investing-month.ts 2026-09-04 2026-09-10 2026-09
            </code>
          </div>
        )}
      </header>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={clsx(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                region === r
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]"
              )}
            >
              {r === "ALL" ? "All regions" : r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={clsx(
                "rounded-full px-3 py-2 text-sm font-medium transition",
                kind === k.id
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]"
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-1">
          {(["table", "matrix"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition",
                view === v ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--muted)]"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-[var(--down)]">{error}</p>}

      {!events.length && !error && (
        <p className="mt-8 text-sm text-[var(--muted)]">
          No events in the forward 7-day window for this filter. Try All regions or capture fresh
          calendar data.
        </p>
      )}

      {view === "table" && events.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--paper)]/80 text-left text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">UTC</th>
                  <th className="px-3 py-3 font-semibold">Reg</th>
                  <th className="px-3 py-3 font-semibold">Imp</th>
                  <th className="px-3 py-3 font-semibold">Event</th>
                  <th className="px-3 py-3 font-semibold">Period</th>
                  <th className="px-3 py-3 font-semibold text-right">Consensus</th>
                  <th className="px-3 py-3 font-semibold text-right">Previous</th>
                  <th className="px-3 py-3 font-semibold text-right">Actual</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr
                    key={`${ev.releasedAt}-${ev.eventName}-${i}`}
                    className={clsx(
                      "border-b border-[var(--line)]/70 transition hover:bg-white/50",
                      ev.eventKind === "speaker" && "bg-violet-50/40",
                      i % 2 === 0 && ev.eventKind !== "speaker" && "bg-white/30"
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                      {formatDayHeader(dayKey(ev.releasedAt))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-[family-name:var(--font-mono)] text-xs">
                      {formatUtcTime(ev.releasedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <RegionBadge region={ev.tapeRegion} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Stars n={importanceStars(ev.importance)} />
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      <EventTitle ev={ev} />
                      {ev.eventKind === "speaker" && ev.speakerInstitution && (
                        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                          {ev.speakerInstitution}
                        </div>
                      )}
                      {ev.metricId && (
                        <div className="text-[10px] text-[var(--muted)]">{ev.category}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                      {ev.periodLabel ?? (ev.periodDate ? formatObsDate(ev.periodDate) : "—")}
                    </td>
                    <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)]">
                      <ConsensusCell ev={ev} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)] text-[var(--muted)]">
                      <PreviousCell ev={ev} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)]">
                      <ActualCell ev={ev} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          ev.status === "released"
                            ? "bg-[var(--line)] text-[var(--muted)]"
                            : "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                        )}
                      >
                        {ev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "matrix" && meta?.windowDays && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <table className="w-full min-w-[1200px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--paper)]/80">
                {meta.windowDays.map((day) => (
                  <th
                    key={day}
                    className="min-w-[160px] border-r border-[var(--line)] px-3 py-3 text-left last:border-r-0"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
                        weekday: "long",
                        timeZone: "UTC",
                      })}
                    </div>
                    <div className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
                      {formatDayHeader(day)}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {(byDay.get(day) ?? []).length} events
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {meta.windowDays.map((day) => (
                  <td
                    key={day}
                    className="vertical-align-top border-r border-[var(--line)] px-2 py-3 align-top last:border-r-0"
                  >
                    <MatrixCell events={byDay.get(day) ?? []} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
