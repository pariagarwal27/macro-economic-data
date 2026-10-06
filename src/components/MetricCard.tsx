"use client";

import Link from "next/link";
import { formatDelta, formatObsDate, formatValue } from "@/lib/format";
import clsx from "clsx";
import { surpriseTone } from "@/lib/surprise";

export interface MetricCardData {
  id: string;
  region: string;
  category: string;
  subcategory: string;
  name: string;
  shortName: string;
  unit: string;
  frequency: string;
  importance: string;
  officialUrl: string;
  docsUrl: string;
  releaseName: string;
  earliestAvailable: string | null;
  observationCount: number | null;
  liveProvider?: string | null;
  feedNote?: string | null;
  latest: { date: string; value: number } | null;
  prior: { date: string; value: number } | null;
  delta: number | null;
  release?: {
    releasedAt: string;
    periodDate: string;
    periodLabel?: string | null;
  } | null;
  displayReleasedAt?: string | null;
  expectedValue?: number | null;
  surprise?: number | null;
  priorPeriodValue?: number | null;
}

export function MetricCard({ metric }: { metric: MetricCardData }) {
  const up = (metric.delta ?? 0) > 0;
  const down = (metric.delta ?? 0) < 0;
  const invert =
    metric.subcategory.includes("unemployment") ||
    metric.subcategory.includes("claims") ||
    metric.id.includes("unemployment") ||
    metric.id.includes("claims") ||
    metric.id.includes("u6");

  const tone = !metric.delta
    ? "neutral"
    : invert
      ? up
        ? "bad"
        : "good"
      : up
        ? "good"
        : down
          ? "bad"
          : "neutral";

  const displayDate = metric.displayReleasedAt
    ? formatObsDate(metric.displayReleasedAt)
    : metric.latest?.date != null
      ? formatObsDate(metric.latest.date)
      : "No data";
  const dateLabel = metric.displayReleasedAt ? "Released" : "Period";

  const hasConsensus = metric.expectedValue != null;
  const surpriseTone_ =
    metric.surprise != null ? surpriseTone(metric.surprise, metric.id, metric.unit) : "neutral";

  return (
    <Link
      href={`/metrics/${metric.id}`}
      className="group block rounded-xl border border-[var(--line)] bg-[var(--panel)]/80 p-4 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset] transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[var(--panel)]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {metric.region} · {metric.category}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug text-[var(--ink)]">
            {metric.shortName}
          </h3>
        </div>
        <span
          className={clsx(
            "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            metric.importance === "critical" && "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
            metric.importance === "high" && "bg-[var(--line)] text-[var(--ink)]",
            metric.importance !== "critical" &&
              metric.importance !== "high" &&
              "bg-transparent text-[var(--muted)]"
          )}
        >
          {metric.importance}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-[family-name:var(--font-mono)] text-3xl font-semibold tracking-tight text-[var(--ink)]">
            {formatValue(metric.latest?.value, metric.unit)}
          </div>
          {hasConsensus && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-[var(--muted)]">
                Cons {formatValue(metric.expectedValue, metric.unit)}
              </span>
              {metric.surprise != null && (
                <span
                  className={clsx(
                    "font-medium",
                    surpriseTone_ === "good" && "text-[var(--up)]",
                    surpriseTone_ === "bad" && "text-[var(--down)]"
                  )}
                >
                  {formatDelta(metric.surprise, metric.unit)} surprise
                </span>
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-[var(--muted)]">
            {dateLabel} {displayDate}
            {metric.priorPeriodValue != null && (
              <> · prior {formatValue(metric.priorPeriodValue, metric.unit)}</>
            )}
            {" · "}
            <span
              className={clsx(
                "font-medium",
                tone === "good" && "text-[var(--up)]",
                tone === "bad" && "text-[var(--down)]"
              )}
            >
              {formatDelta(metric.delta, metric.unit)} seq
            </span>
          </div>
        </div>
        <div className="text-right text-[11px] text-[var(--muted)]">
          <div>{metric.frequency}</div>
          <div className="mt-1 opacity-80">
            {metric.observationCount ?? 0} pts
            {metric.earliestAvailable ? ` · from ${metric.earliestAvailable.slice(0, 4)}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-3 text-[11px] text-[var(--muted)]">
        <span className="truncate">
          {metric.releaseName}
          {metric.liveProvider && metric.liveProvider !== "fred-fallback" ? (
            <span className="ml-2 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-medium text-[var(--accent-ink)]">
              {metric.liveProvider}
            </span>
          ) : (
            <span className="ml-2 rounded bg-[var(--line)] px-1.5 py-0.5">fred fallback</span>
          )}
        </span>
        <span className="text-[var(--accent-ink)] opacity-0 transition group-hover:opacity-100">
          Detail →
        </span>
      </div>
    </Link>
  );
}
