"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { MetricCard, type MetricCardData } from "./MetricCard";
import { USInflationDashboard } from "./USInflationDashboard";
import clsx from "clsx";

type DashboardResponse = {
  cards: MetricCardData[];
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    mode: string;
    status: string;
    metricsProcessed: number | null;
    observationsUpserted: number | null;
  } | null;
  handles: Array<{
    id: string;
    handle: string;
    displayName: string;
    region: string | null;
    role: string;
    notes: string | null;
  }>;
  totalMetrics: number;
};

const REGIONS = ["ALL", "US", "UK", "EA"] as const;
const CATEGORIES = ["ALL", "inflation", "growth", "jobs"] as const;

export function Dashboard() {
  const [region, setRegion] = useState<(typeof REGIONS)[number]>("ALL");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("ALL");
  const [q, setQ] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = (r = region, c = category) => {
    startTransition(async () => {
      try {
        setError(null);
        const res = await fetch(`/api/metrics?region=${r}&category=${c}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = (await res.json()) as DashboardResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  useEffect(() => {
  load();

  /*
   * Release data can change immediately after an
   * official publication. Keep the main dashboard
   * reasonably close to the DB.
   */
  const id = setInterval(
    () => load(),
    10_000
  );

  return () =>
    clearInterval(id);

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  const filtered = useMemo(() => {
    const cards = (data?.cards ?? []).filter((m) => m.latest != null);
    if (!q.trim()) return cards;
    const needle = q.toLowerCase();
    return cards.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        m.shortName.toLowerCase().includes(needle) ||
        m.subcategory.toLowerCase().includes(needle) ||
        m.releaseName.toLowerCase().includes(needle)
    );
  }, [data, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, MetricCardData[]>();
    for (const m of filtered) {
      const key = `${m.region}:${m.category}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return [...map.entries()];
  }, [filtered]);

  if (region === "US" && category === "inflation") return <USInflationDashboard />;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-6 py-8 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(13,124,111,0.16),transparent_45%),radial-gradient(ellipse_at_bottom_left,rgba(40,84,130,0.12),transparent_40%)]" />
        <div className="relative">
          <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.2em] text-[var(--accent-ink)]">
            MACRO ECONOMY TRACKER
          </p>
          <h1 className="mt-2 max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-tight text-[var(--ink)] sm:text-5xl">
            US · UK · Euro Area
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
            Inflation, growth, and jobs — including expectations surveys, wage/ECI measures, PMI,
            and supporting release documents. Historical backfill to earliest available observation
            per series, with prior-period comparisons on every print.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
            <Link
              href="/desk"
              className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent-ink)] hover:border-[var(--accent)]"
            >
              Desk matrix →
            </Link>
            <Link
              href="/calendar"
              className="rounded-full border border-[var(--line)] bg-white/50 px-3 py-1 font-medium text-[var(--ink)] hover:border-[var(--accent)]"
            >
              Forward tape →
            </Link>
            <span className="rounded-full border border-[var(--line)] bg-white/50 px-3 py-1">
              {data?.totalMetrics ?? "—"} series catalogued
            </span>
            <span className="rounded-full border border-[var(--line)] bg-white/50 px-3 py-1">
              Last ingest:{" "}
              {data?.lastRun?.finishedAt
                ? new Date(data.lastRun.finishedAt).toLocaleString()
                : "not run yet"}
            </span>
            {pending && <span className="animate-pulse">Updating…</span>}
          </div>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              data-country={r === "ALL" ? undefined : r.toLowerCase()}
              aria-pressed={region === r}
              onClick={() => {
                setRegion(r);
                load(r, category);
              }}
              className={clsx(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                region === r
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:border-[var(--accent)]"
              )}
            >
              {r === "ALL" ? "All regions" : r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                load(region, c);
              }}
              className={clsx(
                "rounded-full px-4 py-2 text-sm font-medium capitalize transition",
                category === c
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:border-[var(--accent)]"
              )}
            >
              {c === "ALL" ? "All categories" : c}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search metrics, surveys, PMI, wages…"
          className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />

      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-[var(--down)]/30 bg-[var(--down)]/10 px-4 py-3 text-sm text-[var(--down)]">
          {error}. Run `npm run backfill` from the project terminal to populate the database.
        </div>
      )}

      {!data?.lastRun && !error && (
        <div className="mt-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-ink)]">
          Database is empty. Run `npm run backfill` from the project terminal to pull historical series from FRED / Eurostat / ONS.
        </div>
      )}

      <div className="mt-8 space-y-10">
        {grouped.map(([key, items]) => {
          const [reg, cat] = key.split(":");
          return (
            <section key={key}>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
                  {reg}{" "}
                  <span className="text-[var(--muted)]">· {cat}</span>
                </h2>
                <span className="text-xs text-[var(--muted)]">{items.length} metrics</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((m) => (
                  <MetricCard key={m.id} metric={m} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {data?.handles && data.handles.length > 0 && (
        <section className="mt-14">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
            Release-signal handles
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Official statistical agencies and market voices that typically define which prints
            move the tape on release day.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.handles.map((h) => (
              <a
                key={h.id}
                href={`https://x.com/${h.handle.replace("@", "")}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 transition hover:border-[var(--accent)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--ink)]">{h.displayName}</span>
                  <span className="text-xs text-[var(--accent-ink)]">{h.handle}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {h.region ?? "Global"} · {h.role}
                  {h.notes ? ` — ${h.notes}` : ""}
                </p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
