"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SeriesChart } from "./SeriesChart";
import clsx from "clsx";
import { formatDelta, formatObsDate, formatValue } from "@/lib/format";
import { surpriseTone, computeSurprise } from "@/lib/surprise";
import { INFLATION_TREES, US_PCE_TREE, type Node } from "@/catalog/hierarchy";

type SeriesPayload = {
  meta: {
    id: string;
    name: string;
    shortName: string;
    description: string;
    region: string;
    category: string;
    subcategory: string;
    unit: string;
    frequency: string;
    officialUrl: string;
    docsUrl: string;
    releaseName: string;
    earliestAvailable: string | null;
    observationCount: number | null;
    lastIngestedAt: string | null;
  };
  history: Array<{ date: string; value: number }>;
  displayReleasedAt?: string | null;
  expectedValue?: number | null;
  surprise?: number | null;
  priorPeriodValue?: number | null;
  priorPeriodDate?: string | null;
  releases: Array<{
    periodDate: string;
    releasedAt: string;
    periodLabel?: string | null;
    value: number;
    expectedValue?: number | null;
    priorPeriodValue: number | null;
    priorPeriodDate: string | null;
    priorReleaseValue?: number | null;
    changeVsPriorRelease?: number | null;
    changeVsPriorPeriod: number | null;
    supportingDocUrl: string | null;
    notes: string | null;
  }>;
};


function findPath(nodes: Node[], id: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    const next = [...path, n.label];
    if (n.metricId === id) return next;
    if (n.children) { const found = findPath(n.children, id, next); if (found) return found; }
  }
  return null;
}

export function MetricDetail({ id }: { id: string }) {
  const [data, setData] = useState<SeriesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/metrics/${id}?limit=360`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        setData(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-[var(--down)]">{error}</p>
        <Link href="/" className="mt-4 inline-block text-[var(--accent-ink)]">
          ← Back
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-[var(--muted)]">Loading series…</div>
    );
  }

  const {
    meta,
    history,
    releases,
    displayReleasedAt,
    expectedValue,
    surprise,
    priorPeriodValue,
    priorPeriodDate,
  } = data;
  const latest = history[history.length - 1];
  const prior = history[history.length - 2];
  const delta =
    latest && prior ? latest.value - prior.value : null;
  const surpriseTone_ =
    surprise != null ? surpriseTone(surprise, meta.id, meta.unit) : "neutral";
  const year = new Date().getUTCFullYear().toString();
  const currentYear = history.filter((p) => p.date.startsWith(year));
  const high = currentYear.length ? Math.max(...currentYear.map((p) => p.value)) : null;
  const low = currentYear.length ? Math.min(...currentYear.map((p) => p.value)) : null;
  const tree = meta.region === "US" && meta.category === "inflation" ? (meta.id.startsWith("us-pce") || meta.id === "us-core-pce" ? US_PCE_TREE : INFLATION_TREES.US) : null;
  const hierarchy = tree ? findPath(tree, meta.id) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-[var(--accent-ink)] hover:underline">
        ← All metrics
      </Link>

      <header className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
          {meta.region} · {meta.category} · {meta.subcategory}
        </div>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)] sm:text-4xl">
          {meta.name}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
          {meta.description}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-[var(--paper)]/70 p-4">
            <div className="text-xs text-[var(--muted)]">Actual</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-semibold">
              {formatValue(latest?.value, meta.unit)}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {displayReleasedAt
                ? `Released ${formatObsDate(displayReleasedAt)}`
                : latest?.date
                  ? `${formatObsDate(latest.date)} period`
                  : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--paper)]/70 p-4">
            <div className="text-xs text-[var(--muted)]">Consensus</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-semibold">
              {expectedValue != null ? formatValue(expectedValue, meta.unit) : "—"}
            </div>
            <div className="text-xs text-[var(--muted)]">Investing forecast</div>
          </div>
          <div className="rounded-xl bg-[var(--paper)]/70 p-4">
            <div className="text-xs text-[var(--muted)]">Surprise</div>
            <div
              className={clsx(
                "mt-1 font-[family-name:var(--font-mono)] text-3xl font-semibold",
                surpriseTone_ === "good" && "text-[var(--up)]",
                surpriseTone_ === "bad" && "text-[var(--down)]"
              )}
            >
              {surprise != null ? formatDelta(surprise, meta.unit) : "—"}
            </div>
            <div className="text-xs text-[var(--muted)]">Actual − consensus</div>
          </div>
          <div className="rounded-xl bg-[var(--paper)]/70 p-4">
            <div className="text-xs text-[var(--muted)]">Prior period</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-semibold">
              {priorPeriodValue != null
                ? formatValue(priorPeriodValue, meta.unit)
                : formatValue(prior?.value, meta.unit)}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {priorPeriodDate
                ? formatObsDate(priorPeriodDate)
                : prior?.date
                  ? formatObsDate(prior.date)
                  : "—"}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--paper)]/70 p-4">
            <div className="text-xs text-[var(--muted)]">Seq change</div>
            <div className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-semibold">
              {formatDelta(delta, meta.unit)}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {meta.observationCount ?? history.length} pts from{" "}
              {meta.earliestAvailable?.slice(0, 4) ?? "—"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:border-[var(--accent)]"
          >
            Supporting release / bulletin
          </a>
          <a
            href={meta.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:border-[var(--accent)]"
          >
            Official source
          </a>
        </div>
      </header>

      {hierarchy && (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">Hierarchy</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">{hierarchy.map((x,i)=><span key={`${x}-${i}`} className="flex items-center gap-1.5"><span className={i===hierarchy.length-1?'font-semibold text-[var(--ink)]':'text-[var(--muted)]'}>{x}</span>{i<hierarchy.length-1&&<span className="text-[var(--line)]">›</span>}</span>)}</div>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-[family-name:var(--font-display)] text-xl">Current-year analysis</h2><p className="mt-1 text-xs text-[var(--muted)]">Published observations for {year}; the chart above remains the full historical series.</p></div><div className="flex gap-5 text-right text-xs"><div><div className="text-[var(--muted)]">High</div><div className="font-[family-name:var(--font-mono)] text-base">{formatValue(high,meta.unit)}</div></div><div><div className="text-[var(--muted)]">Low</div><div className="font-[family-name:var(--font-mono)] text-base">{formatValue(low,meta.unit)}</div></div></div></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-[var(--muted)]"><tr><th className="pb-2">Period</th><th className="pb-2">Value</th><th className="pb-2">Change</th></tr></thead><tbody>{currentYear.map((p,i)=><tr key={p.date} className="border-t border-[var(--line)]"><td className="py-2">{formatObsDate(p.date)}</td><td className="py-2 font-[family-name:var(--font-mono)]">{formatValue(p.value,meta.unit)}</td><td className="py-2 font-[family-name:var(--font-mono)]">{i?formatDelta(p.value-currentYear[i-1].value,meta.unit):'—'}</td></tr>)}</tbody></table></div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        <h2 className="font-[family-name:var(--font-display)] text-xl">Historical series</h2>
        <p className="mb-4 text-xs text-[var(--muted)]">
          Full backfill through earliest available observation · {meta.frequency}
        </p>
        <SeriesChart data={history} unit={meta.unit} />
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Release vs prior comparison
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="pb-2 pr-3">Released</th>
                <th className="pb-2 pr-3">Period</th>
                <th className="pb-2 pr-3">Actual</th>
                <th className="pb-2 pr-3">Consensus</th>
                <th className="pb-2 pr-3">Surprise</th>
                <th className="pb-2 pr-3">Prior month</th>
                <th className="pb-2 pr-3">Revision</th>
                <th className="pb-2 pr-3">Δ</th>
                <th className="pb-2">Docs</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => {
                const rowSurprise = computeSurprise(r.value, r.expectedValue, meta.unit);
                const rowTone =
                  rowSurprise != null
                    ? surpriseTone(rowSurprise, meta.id, meta.unit)
                    : "neutral";
                return (
                <tr key={`${r.periodDate}-${r.releasedAt}`} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                    {formatObsDate(r.releasedAt)}
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">
                    {r.periodLabel ?? formatObsDate(r.periodDate)}
                  </td>
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                    {formatValue(r.value, meta.unit)}
                  </td>
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[var(--muted)]">
                    {r.expectedValue != null ? formatValue(r.expectedValue, meta.unit) : "—"}
                  </td>
                  <td
                    className={clsx(
                      "py-2.5 pr-3 font-[family-name:var(--font-mono)]",
                      rowTone === "good" && "text-[var(--up)]",
                      rowTone === "bad" && "text-[var(--down)]"
                    )}
                  >
                    {rowSurprise != null ? formatDelta(rowSurprise, meta.unit) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">
                    {r.priorPeriodValue != null
                      ? `${formatValue(r.priorPeriodValue, meta.unit)}${
                          r.priorPeriodDate ? ` (${formatObsDate(r.priorPeriodDate)})` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">
                    {r.priorReleaseValue != null
                      ? `${formatValue(r.priorReleaseValue, meta.unit)} → ${formatValue(r.value, meta.unit)} (${formatDelta(r.changeVsPriorRelease ?? null, meta.unit)})`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                    {formatDelta(r.changeVsPriorPeriod, meta.unit)}
                  </td>
                  <td className="py-2.5">
                    {r.supportingDocUrl ? (
                      <a
                        href={r.supportingDocUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--accent-ink)] hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
