"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatMatrixColumnLabel, formatMatrixValue } from "@/lib/format";
import type { SmoothMethod } from "@/catalog/desk-smoothed";

type MatrixCell = {
  period: string;
  actual: number | null;
  expected: number | null;
};

type MatrixRow = {
  rowId: string;
  rowLabel: string;
  region: "US" | "UK" | "EA";
  metricId: string;
  shortName: string;
  unit: string;
  cells: MatrixCell[];
};

type MatrixResponse = {
  columns: string[];
  blocks: Array<{
    id: string;
    title: string;
    subblocks: Array<{
      id: string;
      title: string;
      rows: MatrixRow[];
    }>;
  }>;
  meta: { months: number; metricCount: number };
};

type SmoothedCell = { period: string; value: number | null };

type SmoothedRow = {
  rowId: string;
  rowLabel: string;
  method: SmoothMethod;
  methodLabel: string;
  region: "US" | "UK" | "EA";
  metricId: string;
  shortName: string;
  unit: string;
  cells: SmoothedCell[];
};

type SmoothedBlock = {
  id: string;
  title: string;
  method: SmoothMethod;
  methodLabel: string;
  note: string | null;
  rows: SmoothedRow[];
};

type SmoothedResponse = {
  columns: string[];
  blocks: SmoothedBlock[];
  rows: SmoothedRow[];
  methods: Record<SmoothMethod, string>;
  meta: { months: number; metricCount: number };
};

const REGION_STYLE: Record<string, string> = {
  US: "text-blue-800",
  UK: "text-purple-800",
  EA: "text-amber-900",
};

function MatrixCellView({ cell, unit }: { cell: MatrixCell; unit: string }) {
  const blank = cell.actual == null && cell.expected == null;
  if (blank) return <span className="text-[var(--line)]">·</span>;

  return (
    <div className="leading-tight">
      <div className="font-[family-name:var(--font-mono)] text-[13px] font-semibold text-[var(--ink)]">
        {formatMatrixValue(cell.actual, unit)}
      </div>
      {cell.expected != null && (
        <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--muted)]">
          {formatMatrixValue(cell.expected, unit)}
        </div>
      )}
    </div>
  );
}

function SmoothedCellView({ cell, unit }: { cell: SmoothedCell; unit: string }) {
  if (cell.value == null) return <span className="text-[var(--line)]">·</span>;
  return (
    <div className="font-[family-name:var(--font-mono)] text-[13px] font-semibold text-[var(--ink)]">
      {formatMatrixValue(cell.value, unit)}
    </div>
  );
}

type DeskView = "monthly" | "smoothed";

type FreshnessRow = {
  metricId: string;
  shortName: string;
  region: string;
  frequency: string;
  latestDate: string | null;
  latestValue: number | null;
  jul2026: number | null;
  aug2026: number | null;
  status: "ok" | "lag" | "survey" | "quarterly" | "missing";
  note: string | null;
};

type FreshnessReport = {
  checkedAt: string;
  summary: { total: number; julPresent: number; augPresent: number; lagging: number };
  rows: FreshnessRow[];
};

const STATUS_STYLE: Record<FreshnessRow["status"], string> = {
  ok: "bg-emerald-50 text-emerald-800",
  lag: "bg-amber-50 text-amber-900",
  survey: "bg-slate-100 text-slate-600",
  quarterly: "bg-slate-100 text-slate-600",
  missing: "bg-red-50 text-red-800",
};

function FreshnessPanel() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<FreshnessReport | null>(null);

  useEffect(() => {
    fetch("/api/data-freshness", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = (await res.json()) as FreshnessReport;
        setReport(json);
      })
      .catch(() => setReport(null));
  }, []);

  if (!report) return null;

  const lagging = report.rows.filter((r) => r.status === "lag" || r.status === "missing");

  return (
    <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--paper)]/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Data freshness
          </p>
          <p className="mt-0.5 text-sm text-[var(--ink)]">
            Jul 2026: <strong>{report.summary.julPresent}</strong>/{report.summary.total} · Aug
            2026: <strong>{report.summary.augPresent}</strong>/{report.summary.total}
            {lagging.length > 0 && (
              <span className="ml-2 text-amber-800">· {lagging.length} lagging</span>
            )}
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-2 pb-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <th className="px-2 py-2 text-left">Metric</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Latest</th>
                  <th className="px-2 py-2 text-right">Jul-26</th>
                  <th className="px-2 py-2 text-right">Aug-26</th>
                  <th className="px-2 py-2 text-left">Note</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.metricId} className="border-t border-[var(--line)]/50">
                    <td className="px-2 py-1.5">
                      <span className={clsx("mr-1.5 font-bold", REGION_STYLE[row.region])}>
                        {row.region}
                      </span>
                      <Link
                        href={`/metrics/${row.metricId}`}
                        className="text-[var(--accent-ink)] hover:underline"
                      >
                        {row.shortName}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          STATUS_STYLE[row.status]
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-[family-name:var(--font-mono)]">
                      {row.latestDate ? formatMatrixColumnLabel(row.latestDate) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-[family-name:var(--font-mono)]">
                      {row.jul2026 != null ? row.jul2026.toFixed(2) : "·"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-[family-name:var(--font-mono)]">
                      {row.aug2026 != null ? row.aug2026.toFixed(2) : "·"}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--muted)]">{row.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeskMatrix() {
  const [view, setView] = useState<DeskView>("monthly");
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [smoothed, setSmoothed] = useState<SmoothedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);

    const endpoint =
      view === "monthly"
        ? "/api/desk-matrix?months=12"
        : "/api/desk-smoothed?months=12";

    fetch(endpoint, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);

        const json = (await res.json()) as unknown;

        if (view === "monthly") {
          setData(json as MatrixResponse);
        } else {
          setSmoothed(json as SmoothedResponse);
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, [view]);

  const loading = view === "monthly" ? !data && !error : !smoothed && !error;

  return (
    <div className="mx-auto max-w-[1800px] px-4 pb-16 pt-8 sm:px-6">
      <Link href="/" className="text-sm text-[var(--accent-ink)] hover:underline">
        ← Dashboard
      </Link>

      <header className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-6 py-8">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Cross-economy desk</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Macro comparison matrix
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          US · UK · Euro Area — last 12 months. Monthly view shows raw prints with consensus below.
          Smoothed view shows 3m averages or 3m/3m annualized anchored to each column month — blank
          when that month&apos;s print is not yet released (no forward-fill).
        </p>

        <div className="mt-5 inline-flex rounded-lg border border-[var(--line)] bg-[var(--paper)] p-1">
          {(
            [
              ["monthly", "Monthly prints"],
              ["smoothed", "3m smoothed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={clsx(
                "rounded-md px-4 py-2 text-sm font-medium transition",
                view === id
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <FreshnessPanel />
      </header>

      {error && <p className="mt-4 text-sm text-[var(--down)]">{error}</p>}
      {loading && <p className="mt-8 text-sm text-[var(--muted)]">Loading matrix…</p>}

      {view === "monthly" && data && (
        <div className="mt-8 space-y-10">
          {data.blocks.map((block) => (
            <section key={block.id}>
              <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
                {block.title}
              </h2>

              {block.subblocks.map((sub) => (
                <div key={sub.id} className="mt-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {sub.title}
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1100px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-[var(--line)] bg-[var(--paper)]/80">
                            <th className="sticky left-0 z-10 min-w-[200px] bg-[var(--paper)]/95 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                              Metric
                            </th>
                            {data.columns.map((col) => (
                              <th
                                key={col}
                                className="min-w-[72px] px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
                              >
                                {formatMatrixColumnLabel(col)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sub.rows.map((row, idx) => (
                            <tr
                              key={`${row.rowId}-${row.region}-${idx}`}
                              className={clsx(
                                "border-b border-[var(--line)]/70",
                                idx % 2 === 0 ? "bg-white/25" : "bg-transparent"
                              )}
                            >
                              <td className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2">
                                <div className="flex items-baseline gap-2">
                                  <span
                                    className={clsx(
                                      "text-[10px] font-bold uppercase",
                                      REGION_STYLE[row.region]
                                    )}
                                  >
                                    {row.region}
                                  </span>
                                  <Link
                                    href={`/metrics/${row.metricId}`}
                                    className="text-[13px] font-medium text-[var(--accent-ink)] hover:underline"
                                  >
                                    {row.shortName}
                                  </Link>
                                </div>
                                {idx === 0 || sub.rows[idx - 1]?.rowLabel !== row.rowLabel ? (
                                  <div className="text-[10px] text-[var(--muted)]">{row.rowLabel}</div>
                                ) : null}
                              </td>
                              {row.cells.map((cell) => (
                                <td key={cell.period} className="px-2 py-2 text-center align-top">
                                  <MatrixCellView cell={cell} unit={row.unit} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {view === "smoothed" && smoothed && (
        <div className="mt-8 space-y-8">
          {smoothed.blocks.map((block) => (
            <section key={block.id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                  {block.title}
                </h2>
                <span className="rounded-md bg-[var(--paper)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
                  {block.methodLabel}
                </span>
              </div>
              {block.note ? (
                <p className="mb-2 text-xs text-[var(--muted)]">{block.note}</p>
              ) : null}
              <div className="overflow-hidden rounded-xl border-2 border-[var(--line)] bg-[var(--panel)] shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--paper)]/80">
                        <th className="sticky left-0 z-10 min-w-[200px] border-r border-[var(--line)] bg-[var(--paper)]/95 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                          Economy
                        </th>
                        {smoothed.columns.map((col) => (
                          <th
                            key={col}
                            className="min-w-[72px] border-r border-[var(--line)]/50 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] last:border-r-0"
                          >
                            {formatMatrixColumnLabel(col)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, idx) => (
                        <tr
                          key={`${row.rowId}-${row.region}`}
                          className={clsx(
                            "border-b border-[var(--line)]/70 last:border-b-0",
                            idx % 2 === 0 ? "bg-white/25" : "bg-transparent"
                          )}
                        >
                          <td className="sticky left-0 z-10 border-r border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                            <div className="flex items-baseline gap-2">
                              <span
                                className={clsx(
                                  "text-[10px] font-bold uppercase",
                                  REGION_STYLE[row.region]
                                )}
                              >
                                {row.region}
                              </span>
                              <Link
                                href={`/metrics/${row.metricId}`}
                                className="text-[13px] font-medium text-[var(--accent-ink)] hover:underline"
                              >
                                {row.shortName}
                              </Link>
                            </div>
                          </td>
                          {row.cells.map((cell) => (
                            <td
                              key={cell.period}
                              className="border-r border-[var(--line)]/40 px-2 py-2 text-center align-top last:border-r-0"
                            >
                              <SmoothedCellView cell={cell} unit={row.unit} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
