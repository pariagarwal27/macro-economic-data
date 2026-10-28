"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HistoryChartViewport } from "./HistoryChartViewport";
import { getNiceTickDomain, getNiceTicks } from "@/lib/chart-axis";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { formatLaborChange, laborPeriodChanges, type LaborChangePoint } from "@/lib/labor-period-change";

type LaborMetric = {
  meta: { id: string; name: string; unit: string; frequency: string };
  history: Array<{ date: string; value: number }>;
  threeMonth?: { label: string; history: Array<{ date: string; value: number }> };
};

export function LaborChangeChart({ metric, height = 360, compact = false }: { metric: LaborMetric; height?: number; compact?: boolean }) {
  // Most labour-change cards compare period-over-period changes. ADP already
  // publishes monthly changes, while U.S. Job Openings stays at its published
  // level; neither should be differenced again.
  const actualLevel = metric.meta.id === "us-jolts-openings";
  const alreadyMonthlyChange = metric.meta.id === "us-adp-change";
  const primary = actualLevel || alreadyMonthlyChange ? metric.history : laborPeriodChanges(metric.history);
  const data = primary.map((point, index) => {
    const window = primary.slice(Math.max(0, index - 2), index + 1);
    const consecutive = window.length === 3 && window.every((entry, offset) => {
      if (offset === 0) return true;
      const previous = new Date(`${window[offset - 1].date.slice(0, 7)}-01T00:00:00Z`);
      const current = new Date(`${entry.date.slice(0, 7)}-01T00:00:00Z`);
      return (current.getUTCFullYear() - previous.getUTCFullYear()) * 12 + current.getUTCMonth() - previous.getUTCMonth() === 1;
    });
    const average = consecutive && window.every(entry => entry.value != null)
      ? window.reduce((sum, entry) => sum + Number(entry.value), 0) / 3
      : null;
    return { ...point, trend: average };
  });
  const formatValue = (value: number) => {
    if (!actualLevel) return formatLaborChange(value, metric.meta);
    const unitIsThousands = metric.meta.unit.toLowerCase().includes("thousand");
    if (unitIsThousands && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}M`;
    if (!unitIsThousands && Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return Math.round(value).toLocaleString("en-US");
  };
  const hasTrend = data.some(point => point.trend != null && Number.isFinite(point.trend));
  if (!data.some(point => point.value != null)) return <div className="spark-chart-empty">No change data available</div>;

  const renderPlot = (points: Array<LaborChangePoint & { trend: number | null }>, width: number | "100%") => {
    const ticks = getNiceTicks(points.flatMap(point => [point.value, point.trend].filter((value): value is number => value != null)), 7, 1);
    const domain = getNiceTickDomain(ticks);
    return <ResponsiveContainer width={width} height="100%">
      <LineChart data={points} margin={compact ? { top: 5, right: 5, left: 5, bottom: 3 } : { top: 10, right: 18, left: 4, bottom: 16 }}>
        <CartesianGrid vertical={!compact} stroke="var(--line)" strokeDasharray="2 4" />
        <XAxis hide={compact} dataKey="date" tickFormatter={date => new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} minTickGap={24} interval="preserveStartEnd" />
        <YAxis yAxisId="change" hide={compact} allowDataOverflow width={compact ? 0 : 72} ticks={ticks} domain={domain} tickFormatter={value => formatValue(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        {domain[0] <= 0 && domain[1] >= 0 && <ReferenceLine y={0} stroke="var(--line-strong)" strokeDasharray="3 3" />}
        <Tooltip filterNull={false} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={date => `Period: ${String(date).slice(0, 10)}`} formatter={(value, name) => [value == null ? "Unavailable: requires 3 consecutive months" : formatValue(Number(value)), String(name ?? "Value")]} contentStyle={{ border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", fontSize: 12 }} />
        <Line yAxisId="change" dataKey="value" name={actualLevel ? "Published openings" : "Monthly change"} type="linear" stroke="var(--country-series)" strokeWidth={2.5} dot={compact ? false : { r: 3, fill: "var(--country-series)", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        {hasTrend && <Line yAxisId="change" dataKey="trend" name={actualLevel ? "3-month average of published openings" : "3-month average of monthly change"} type="linear" stroke="var(--country-series)" strokeWidth={2.3} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>;
  };

  if (compact) return <div className="macro-mini-chart" style={{ width: "100%", height: 70 }} aria-label={`${metric.meta.name} change history`}>{renderPlot(filterHistoryToTrailing12Months(data), "100%")}</div>;
  return <div style={{ width: "100%", height, display: "grid", gridTemplateRows: hasTrend ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
    {hasTrend && <div aria-label="Chart axis legend" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: "6px 18px", color: "var(--muted)", fontSize: 11 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden="true" style={{ width: 18, borderTop: "2px solid var(--country-series)" }} />Solid · {actualLevel ? "Published level" : "Monthly change"} · left axis</span><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden="true" style={{ width: 18, borderTop: "2px dotted var(--country-series)" }} />Dotted · 3-month average of {actualLevel ? "level" : "change"} · left axis</span></div>}
    <HistoryChartViewport dates={data.map(point => point.date)} frequency={metric.meta.frequency} height={height} label={`${metric.meta.name} change history`}>
      {(plotWidth, fromYear, toYear, isDefaultWindow) => renderPlot(isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear), plotWidth || "100%")}
    </HistoryChartViewport>
  </div>;
}
