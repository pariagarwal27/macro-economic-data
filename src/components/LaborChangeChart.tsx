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
  const publishedRate = metric.meta.id === "us-participation";
  const changes = publishedRate ? metric.history : laborPeriodChanges(metric.history);
  const trendByMonth = new Map((metric.threeMonth?.history ?? []).map(point => [point.date.slice(0, 7), point.value]));
  const data = changes.map(point => ({ ...point, trend: trendByMonth.get(point.date.slice(0, 7)) ?? null }));
  const formatValue = (value: number) => publishedRate ? `${value.toFixed(1)}%` : formatLaborChange(value, metric.meta);
  const formatTrend = (value: number) => {
    if (/percent|rate/i.test(metric.meta.unit) || metric.meta.id === "us-participation") return `${value.toFixed(1)}%`;
    if (metric.meta.unit.toLowerCase().includes("thousand")) return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}M` : `${Math.round(value).toLocaleString("en-US")}K`;
    return Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : Math.round(value).toLocaleString("en-US");
  };
  const hasTrend = data.some(point => point.trend != null && Number.isFinite(point.trend));
  if (!data.some(point => point.value != null)) return <div className="spark-chart-empty">No change data available</div>;

  const renderPlot = (points: Array<LaborChangePoint & { trend: number | null }>, width: number | "100%") => {
    const ticks = getNiceTicks(points.flatMap(point => point.value == null ? [] : [point.value]), 7, metric.meta.id === "us-participation" ? 0.05 : 1);
    const domain = getNiceTickDomain(ticks);
    const trendTicks = hasTrend ? getNiceTicks(points.flatMap(point => point.trend == null ? [] : [point.trend]), 7, metric.meta.id === "us-participation" ? 0.05 : 1) : [];
    return <ResponsiveContainer width={width} height="100%">
      <LineChart data={points} margin={compact ? { top: 5, right: 5, left: 5, bottom: 3 } : { top: 10, right: 18, left: 4, bottom: 16 }}>
        <CartesianGrid vertical={!compact} stroke="var(--line)" strokeDasharray="2 4" />
        <XAxis hide={compact} dataKey="date" tickFormatter={date => new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} minTickGap={24} interval="preserveStartEnd" />
        <YAxis yAxisId="change" hide={compact} allowDataOverflow width={compact ? 0 : 72} ticks={ticks} domain={domain} tickFormatter={value => formatValue(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        {trendTicks.length > 0 && <YAxis yAxisId="trend" orientation="right" hide={compact} allowDataOverflow width={compact ? 0 : 76} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} tickFormatter={value => formatTrend(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />}
        {domain[0] <= 0 && domain[1] >= 0 && <ReferenceLine y={0} stroke="var(--line-strong)" strokeDasharray="3 3" />}
        <Tooltip filterNull={false} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={date => `Period: ${String(date).slice(0, 10)}`} formatter={(value, name) => [value == null ? "Unavailable: requires 3 consecutive months" : name === (metric.threeMonth?.label ?? "3-month average") ? formatTrend(Number(value)) : formatValue(Number(value)), String(name ?? "Value")]} contentStyle={{ border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", fontSize: 12 }} />
        <Line yAxisId="change" dataKey="value" name={publishedRate ? "Published participation rate" : "Change vs prior period"} type="linear" stroke="var(--country-series)" strokeWidth={2.5} dot={compact ? false : { r: 3, fill: "var(--country-series)", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        {trendTicks.length > 0 && <Line yAxisId="trend" dataKey="trend" name={metric.threeMonth?.label ?? "3-month average"} type="linear" stroke="var(--country-series)" strokeWidth={2.3} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>;
  };

  if (compact) return <div className="macro-mini-chart" style={{ width: "100%", height: 70 }} aria-label={`${metric.meta.name} change history`}>{renderPlot(filterHistoryToTrailing12Months(data), "100%")}</div>;
  return <div style={{ width: "100%", height, display: "grid", gridTemplateRows: hasTrend ? (publishedRate ? "auto auto minmax(0, 1fr)" : "auto minmax(0, 1fr)") : "minmax(0, 1fr)" }}>
    {publishedRate && <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}>The 3-month average is unavailable for October–December 2025 because BLS collected no October observation during the government shutdown. It resumes in January 2026. This is an average of published rates, not 3m/3m growth.</p>}
    {hasTrend && <div aria-label="Chart axis legend" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: "6px 18px", color: "var(--muted)", fontSize: 11 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden="true" style={{ width: 18, borderTop: "2px solid var(--country-series)" }} />Solid Â· Change vs prior period Â· left axis</span><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden="true" style={{ width: 18, borderTop: "2px dotted var(--country-series)" }} />Dotted Â· {metric.threeMonth?.label ?? "3-month average"} Â· right axis</span></div>}
    <HistoryChartViewport dates={data.map(point => point.date)} frequency={metric.meta.frequency} height={height} label={`${metric.meta.name} change history`}>
      {(plotWidth, fromYear, toYear, isDefaultWindow) => renderPlot(isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear), plotWidth || "100%")}
    </HistoryChartViewport>
  </div>;
}
