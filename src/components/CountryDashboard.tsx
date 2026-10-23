"use client";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useRef, useState } from "react";
import { stableDetailNodes } from "@/lib/detail-drawer-nodes";
import { retailPublishedPoints } from "@/lib/uk-retail";
import { UkRetailPublishedReadings } from './UkRetailPublishedReadings';
import { priceStudioSpecs, ppiComparisonSpecs, inflationPlotSpecs } from './inflation-view-specs';
import { CalendarDays, ChevronDown, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import {
  DASHBOARD,
  REGION_FLAG,
  REGION_LABEL,
  type IndicatorSpec,
  type MacroCategory,
  type Region,
  type UiNode,
} from "./macro-ui-hierarchy";
import { formatEconomicLevel, formatObsDate } from "@/lib/format";
import { formatLiveSourceLabel } from "@/lib/live-source-label";
import { displayReleaseStage, type ReleaseStage } from "@/ingest/release-stages";
import { latestQuarterPair, quarterlyGrowthPoints } from "@/lib/quarterly-gdp";
import { claimsChartPoints, formatClaimsCount } from "@/lib/claims-display";
import { mergeClaimsChartData } from "@/lib/claims-chart";
import { selectComponentMiniSeries } from "@/lib/component-mini-series";
import { RefreshDataButton } from "@/components/RefreshDataButton";
import { ExpectationComparisonChart } from "@/components/ExpectationComparisonChart";
import { InflationContributions } from "@/components/InflationContributions";
import { PpiDrivers } from "@/components/PpiDrivers";
import { PceDrivers } from "@/components/PceDrivers";
import { RetailDrivers } from "@/components/RetailDrivers";
import { CONTRIBUTION_CONFIGS } from "@/lib/inflation-contributions";
import { EXPECTATION_CHART_GROUPS, EXPANDED_EXPECTATION_GROUP_IDS, MARKERLESS_EXPECTATION_GROUP_IDS, NYFED_EXPECTATION_AXIS_BY_METRIC_ID, NYFED_OVERVIEW_CHART_GROUPS } from "@/lib/expectation-chart-groups";
import { createExpectationMetricSelection } from "@/lib/expectation-selection";
import { formatExpectationValue } from "@/lib/expectation-format";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months, retainHistoryRangeIdentity } from "@/lib/history-range";
import { EconomicCalendarSidebar } from "@/components/EconomicCalendarSidebar";
import { GlobalMetricSearch } from "@/components/GlobalMetricSearch";
import { getClientJsonCache, refreshClientJson } from "@/lib/client-json-cache";
import { resolveStudioSelection } from "@/lib/chart-studio";
import { getExpectationAxisTicks, getNiceTickDomain, getNiceTicks, getPairedAxisTicks, getTickPrecision } from "@/lib/chart-axis";
import { LaborChangeChart } from "@/components/LaborChangeChart";
import { formatLaborChange, isLaborChangeMetric, laborChangeKpis, laborPublishedKpis } from "@/lib/labor-period-change";
import { getPublishedExpectationReadingsAsOf } from "@/lib/expectation-series";
import { inflationRateHistory } from "@/lib/inflation-rate-history";
import {
  getUnderlyingInflationPublishedRates,
  normalizeUnderlyingInflationDetailSpec,
} from "@/lib/underlying-inflation-detail";
import { getPublishedComponentMeasureIds } from "@/lib/component-detail-measures";
import {
  formatOfficialComponentWeight,
  getOfficialComponentWeight,
} from "@/lib/official-component-weights";
import {
  formatOfficialRetailIndexWeight,
  getOfficialRetailIndexWeight,
  getRetailWeightAvailability,
} from "@/lib/official-retail-weights";


type Metric = {
  id: string;
  region: string;
  category: string;
  subcategory: string;
  name: string;
  shortName: string;
  unit: string;
  frequency: string;
  importance: string;
  source?: string;
  liveSource?: string | null;
  liveProvider?: string | null;
  officialUrl: string;
  docsUrl: string;
  releaseName: string;
  latest?: { date: string; value: number } | null;
  prior?: { date: string; value: number } | null;
  delta?: number | null;
  displayReleasedAt?: string | null;
  releaseStage?: ReleaseStage | null;
  history?: Array<{ date: string; value: number }>;
  transform?: string;
};

type DetailPayload = {
  meta: Metric;
  history: Array<{ date: string; value: number }>;
  threeMonth?: { label: string; note: string; frequency?: string; history: Array<{ date: string; value: number }> };
  displayReleasedAt?: string | null;
  releases?: Array<{
    periodDate: string;
    releasedAt: string;
    value: number;
    periodLabel?: string | null;
  }>;
};

type ReleaseNotice = {
  kind: "reminder" | "released";
  metricId: string;
  metricName: string;
  region: string;
  stage?: "2m" | "1m";
  secondsRemaining?: number;
  actual?: number | null;
  releasedAt?: string | null;
};

type DashboardToast = ReleaseNotice & { id: string };

function specContainsMetric(spec: IndicatorSpec, metricId: string): boolean {
  if ([spec.metricId, spec.yoyMetricId, spec.momMetricId, ...(spec.chartMetricIds ?? [])].includes(metricId)) return true;
  const contains = (nodes: UiNode[] = []): boolean => nodes.some((node) => node.metricId === metricId || node.momMetricId === metricId || contains(node.children));
  return contains(spec.components);
}

const YEAR = new Date().getFullYear();
function chartDataForRange<T extends { date: string }>(data: T[], fromYear: number, toYear: number, isDefaultWindow = false) {
  return isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear);
}

function claimsTrendPoints(metric: DetailPayload | undefined) {
  return claimsChartPoints(normalizeHistory(metric?.history ?? []), 20);
}

function latestClaimsValue(metric: DetailPayload | undefined) {
  return normalizeHistory(metric?.history ?? []).at(-1)?.value ?? metric?.meta.latest?.value ?? null;
}

const QUARTERLY_GDP_METRIC_IDS = new Set(["us-gdp-real", "uk-gdp-qoq"]);
const ACTIVITY_BAR_SPEC_IDS = new Set([
  "us-gdp-card", "us-retail-sales-card", "us-pmi-card", "us-pce-growth-card", "us-investment-card", "us-government-card", "us-net-exports-card",
  "uk-gdp-card", "uk-consumption-card", "uk-retail-sales-card", "uk-capital-card", "uk-pmi-card", "uk-net-trade-card",
  "ea-gdp-card", "ea-retail-sales-card", "ea-pmi-card", "ea-household-card", "ea-capital-card", "ea-government-card", "ea-exports-card", "ea-imports-card",
]);

function isQuarterlyGdpMetric(metricId?: string) {
  return Boolean(metricId && QUARTERLY_GDP_METRIC_IDS.has(metricId));
}

function QuarterlyGdpChart({
  metric,
  compact = false,
  height = 320,
  chartType = "line",
}: {
  metric: DetailPayload | undefined;
  compact?: boolean;
  height?: number;
  chartType?: "line" | "bar";
}) {
  const [showLatestPrior, setShowLatestPrior] = useState(true);
  useEffect(() => setShowLatestPrior(true), [metric?.meta.id]);
  const monthLimit = new Date().getFullYear() === YEAR ? new Date().getMonth() + 1 : 12;
  const latestQuarter = Math.floor(monthLimit / 3);
  // Keep a full decade for the year selector (10 quarters only shows ~2.5 years).
  const fullData = quarterlyGrowthPoints(metric?.history ?? [], 40)
    .filter(point => Number(point.date.slice(0, 4)) < YEAR || (Number(point.date.slice(0, 4)) === YEAR && Number(point.quarter.slice(1, 2)) <= latestQuarter));
  const isUsRealGdp = metric?.meta.id === "us-gdp-real";
  const isUkRealGdp = metric?.meta.id === "uk-gdp-qoq";
  const data = compact
    ? fullData
    : (showLatestPrior && !isUkRealGdp && !isUsRealGdp)
      ? fullData.slice(-2)
      : fullData;
  if (!data.length) {
    return compact ? null : <div className="spark-chart-empty">No quarterly data</div>;
  }

  const metricId = metric?.meta.id;
  const seriesLabel = metricId === "us-gdp-real" ? "Quarterly growth · SAAR" : "Quarterly growth · QoQ";
  const formatValue = (value: number) => `${value.toFixed(1)}%`;
  return (
    <div
      className={compact ? "macro-mini-chart" : undefined}
      style={{ width: "100%", height: compact ? 61 : height, minHeight: 0 }}
      aria-label={seriesLabel}
    >
      {!compact && !isUsRealGdp && !isUkRealGdp && <div role="group" aria-label="GDP chart view" style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 8 }}>
        {[{ active: showLatestPrior, label: "Latest / Prior", onClick: () => setShowLatestPrior(true) }, { active: !showLatestPrior, label: metric?.meta.region === "UK" ? metric.threeMonth?.label ?? "3m/3m" : "3m/3m SAAR", onClick: () => setShowLatestPrior(false) }].map(option => <button key={option.label} type="button" aria-pressed={option.active} onClick={option.onClick} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", background: option.active ? "var(--country-series)" : "var(--panel)", color: option.active ? "white" : "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{option.label}</button>)}
      </div>}
      {compact ? <ResponsiveContainer width="100%" height="100%">{renderQuarterlyGrowthChart(filterHistoryToTrailing12Months(data), chartType, seriesLabel, formatValue, compact)}</ResponsiveContainer> : <HistoryChartViewport dates={data.map(point => point.date)} frequency="quarterly" height={height} label={seriesLabel}>{(plotWidth, fromYear, toYear, isDefaultWindow) => <ResponsiveContainer width={plotWidth || "100%"} height="100%">{renderQuarterlyGrowthChart(chartDataForRange(data, fromYear, toYear, isDefaultWindow), chartType, seriesLabel, formatValue, compact)}</ResponsiveContainer>}</HistoryChartViewport>}
    </div>
  );
}

function ThreeMonthHistoryChart({ metric, comparisonMetric, yoyMetric, comparisonYoyMetric, height }: { metric: DetailPayload; comparisonMetric?: DetailPayload; yoyMetric?: DetailPayload; comparisonYoyMetric?: DetailPayload; height: number }) {
  const primaryTrend = normalizeHistory(metric.threeMonth?.history ?? []);
  if (!primaryTrend.length) return <div className="spark-chart-empty">No {metric.threeMonth?.label ?? "3-month trend"} data available</div>;
  const comparisonTrend = normalizeHistory(comparisonMetric?.threeMonth?.history ?? []);
  const yoyByMonth = (payload?: DetailPayload, dedicated?: DetailPayload) => {
    if (!payload) return new Map<string, number>();
    const published = normalizeHistory(dedicated?.history ?? []);
    if (published.length) return new Map(published.filter(point => Number.isFinite(point.value)).map(point => [point.date.slice(0, 7), point.value]));
    const history = normalizeHistory(payload.history ?? []);
    const result = new Map<string, number>();
    // Eurostat retail observations arrive as monthly percentage changes. A
    // YoY rate must compound the twelve monthly changes; calculating a YoY
    // rate from the MoM-rate series itself creates the spurious lines that
    // used to appear in the Euro Area chart.
    if (payload.meta.region === "EA" && payload.meta.subcategory === "retail") {
      for (let index = 0; index < history.length; index++) {
        const point = history[index]!;
        const window = history.slice(Math.max(0, index - 11), index + 1);
        if (window.length !== 12) continue;
        let compounded = 1;
        for (let offset = 0; offset < window.length; offset++) {
          const currentMonth = window[offset]!.date.slice(0, 7);
          if (offset > 0) {
            const previousMonth = window[offset - 1]!.date.slice(0, 7);
            const [previousYear, previousMonthNumber] = previousMonth.split("-").map(Number);
            const expected = new Date(Date.UTC(previousYear!, previousMonthNumber!, 1));
            expected.setUTCMonth(expected.getUTCMonth() + 1);
            if (expected.toISOString().slice(0, 7) !== currentMonth) {
              compounded = Number.NaN;
              break;
            }
          }
          compounded *= 1 + window[offset]!.value / 100;
        }
        if (Number.isFinite(compounded)) result.set(point.date.slice(0, 7), (compounded - 1) * 100);
      }
      return result;
    }
    for (let index = 0; index < history.length; index++) {
      const point = history[index]!;
      const rate = calculateRates(history.slice(0, index + 1), payload.meta.transform, payload.meta.frequency, payload.meta.id).yoy;
      if (rate != null && Number.isFinite(rate)) result.set(point.date.slice(0, 7), rate);
    }
    return result;
  };
  const primaryYoy = yoyByMonth(metric, yoyMetric);
  const comparisonYoy = yoyByMonth(comparisonMetric, comparisonYoyMetric);
  const primaryTrendByMonth = new Map(primaryTrend.map(point => [point.date.slice(0, 7), point.value]));
  const comparisonTrendByMonth = new Map(comparisonTrend.map(point => [point.date.slice(0, 7), point.value]));
  const months = [...new Set([...primaryTrendByMonth.keys(), ...primaryYoy.keys(), ...comparisonTrendByMonth.keys(), ...comparisonYoy.keys()])].sort();
  const data = months.map(month => ({ date: `${month}-01`, primaryYoy: primaryYoy.get(month) ?? null, primaryTrend: primaryTrendByMonth.get(month) ?? null, comparisonYoy: comparisonYoy.get(month) ?? null, comparisonTrend: comparisonTrendByMonth.get(month) ?? null }));
  const primaryLabel = ["us-retail-sales-total", "ea-retail-sales-total-ex-motor-vehicles"].includes(metric.meta.id) ? "Headline Retail Sales" : metric.meta.shortName || metric.meta.name;
  const comparisonLabel = comparisonMetric?.meta.id === "us-retail-sales-control-group" ? "Retail Sales Control Group" : ["ea-retail-sales-ex-fuel", "uk-retail-sales-ex-fuel"].includes(comparisonMetric?.meta.id ?? "") ? "Retail Sales ex Fuel" : comparisonMetric?.meta.shortName || comparisonMetric?.meta.name || "Comparison";
  const trendLabel = metric.threeMonth?.label ?? "3-month average";
  const frequency = metric.threeMonth?.frequency ?? metric.meta.frequency;
  const legend = [{ label: `${primaryLabel} · YoY`, color: "var(--country-series)", dotted: false }, { label: `${primaryLabel} · ${trendLabel}`, color: "var(--country-series)", dotted: true }, ...(comparisonMetric ? [{ label: `${comparisonLabel} · YoY`, color: "#126b55", dotted: false }, { label: `${comparisonLabel} · ${trendLabel}`, color: "#126b55", dotted: true }] : [])];
  return <div style={{ width: "100%", height, minHeight: 0, display: "grid", gridTemplateRows: "28px minmax(0, 1fr)" }}>
    <div aria-label="Chart series" style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "6px 16px", color: "var(--muted)", fontSize: 11, padding: "2px 4px 6px" }}>{legend.map(item => <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden="true" style={{ display: "inline-block", width: 18, borderTop: `2px ${item.dotted ? "dotted" : "solid"} ${item.color}` }} />{item.label}</span>)}</div>
    <HistoryChartViewport dates={data.map(point => point.date)} frequency={frequency} height={height - 28} label={`${primaryLabel} YoY and ${trendLabel}`}>
      {(plotWidth, fromYear, toYear, isDefaultWindow) => {
        const rangedData = isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear);
        const separateTrendAxis = metric.meta.region === "US";
        const ticks = getNiceTicks(rangedData.flatMap(point => separateTrendAxis ? [point.primaryYoy, point.comparisonYoy] : [point.primaryYoy, point.primaryTrend, point.comparisonYoy, point.comparisonTrend]).filter((value): value is number => value != null && Number.isFinite(value)), 7, 0.05);
        const trendTicks = separateTrendAxis ? getNiceTicks(rangedData.flatMap(point => [point.primaryTrend, point.comparisonTrend]).filter((value): value is number => value != null && Number.isFinite(value)), 7, 0.05) : [];
        const digits = Math.max(1, getTickPrecision(ticks));
        const formatValue = (value: number) => `${value.toFixed(digits)}%`;
        return <ResponsiveContainer width={plotWidth || "100%"} height="100%"><LineChart data={rangedData} margin={{ top: 8, right: 18, left: 4, bottom: 16 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
          <XAxis dataKey="date" tickFormatter={value => formatChartDate(value, frequency)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} minTickGap={24} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 10 }} />
          <YAxis yAxisId="main" allowDataOverflow width={62} ticks={ticks} domain={getNiceTickDomain(ticks)} tickFormatter={value => formatValue(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
          {separateTrendAxis && trendTicks.length > 1 && <YAxis yAxisId="trend" orientation="right" allowDataOverflow width={62} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} tickFormatter={value => formatValue(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />}
          <Tooltip cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={value => `Date: ${formatChartDate(String(value), frequency, true)}`} formatter={(value, name) => [value == null ? "—" : formatValue(Number(value)), String(name ?? "Value")]} content={({ active, label, payload }) => { if (!active || !payload?.length) return null; const rows: Record<string, { yoy?: number; trend?: number }> = { [primaryLabel]: {}, ...(comparisonMetric ? { [comparisonLabel]: {} } : {}) }; const labels: Record<string, string> = { primaryYoy: primaryLabel, primaryTrend: primaryLabel, comparisonYoy: comparisonLabel, comparisonTrend: comparisonLabel }; for (const entry of payload) { const key = String(entry.dataKey ?? ""); const name = labels[key]; if (!name || entry.value == null || !Number.isFinite(Number(entry.value))) continue; rows[name]![key.toLowerCase().includes("trend") ? "trend" : "yoy"] = Number(entry.value); } return <div className="inflation-paired-tooltip" style={{ minWidth: comparisonMetric ? 360 : 220 }}><strong className="inflation-paired-tooltip-period" style={{ display: "block", marginBottom: 8 }}>Date: {formatChartDate(String(label), frequency, true)}</strong><div style={{ display: "grid", gridTemplateColumns: `repeat(${comparisonMetric ? 2 : 1}, minmax(150px, 1fr))`, gap: 12 }}>{Object.entries(rows).map(([name, values], index) => <section key={name} style={{ display: "grid", gap: 5, padding: 8, border: "1px solid var(--line)", borderRadius: 6 }}><b style={{ color: index === 0 ? "var(--country-series)" : "#126b55" }}>{name}</b><span>YoY <strong>{values.yoy == null ? "—" : formatValue(values.yoy)}</strong></span><span>{trendLabel} <strong>{values.trend == null ? "—" : formatValue(values.trend)}</strong></span></section>)}</div></div>}} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }} />
          <Line yAxisId="main" dataKey="primaryYoy" name={`${primaryLabel} · YoY`} type="monotone" stroke="var(--country-series)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--country-series)", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId={separateTrendAxis ? "trend" : "main"} dataKey="primaryTrend" name={`${primaryLabel} · ${trendLabel}`} type="monotone" stroke="var(--country-series)" strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          {comparisonMetric && <Line yAxisId="main" dataKey="comparisonYoy" name={`${comparisonLabel} · YoY`} type="monotone" stroke="#126b55" strokeWidth={2.5} dot={{ r: 3, fill: "#126b55", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
          {comparisonMetric && <Line yAxisId={separateTrendAxis ? "trend" : "main"} dataKey="comparisonTrend" name={`${comparisonLabel} · ${trendLabel}`} type="monotone" stroke="#126b55" strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
        </LineChart></ResponsiveContainer>;
      }}
    </HistoryChartViewport>
  </div>;
}
function aweWindowLabel(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  if (!year || !month) return formatChartDate(date, "monthly");
  const end = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(Date.UTC(year, month - 3, 1));
  const monthText = (value: Date) => value.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${monthText(end)} ${year} (${monthText(start)}–${monthText(end)})`;
}

function UkWageComparisonChart({ allMetrics, height }: { allMetrics: Record<string, DetailPayload | undefined>; height: number }) {
  const charts = [
    { id: "uk-awe-regular-yoy", title: "Regular Pay · YoY", legend: "AWE Regular Pay Growth", color: "var(--country-series)" },
    { id: "uk-awe-total-yoy", title: "Total Pay · YoY", legend: "AWE Total Pay Growth", color: "#a55c3e" },
  ];
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, height, minHeight: 280 }}>
    {charts.map(chart => {
      const history = normalizeHistory(allMetrics[chart.id]?.history ?? []);
      const ticks = getNiceTicks(history.map(point => point.value), 7, 0.1);
      const digits = Math.max(1, getTickPrecision(ticks));
      const formatValue = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
      return <section key={chart.id} aria-label={chart.title} style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "var(--panel)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", paddingBottom: 4 }}><strong>{chart.title}</strong><span style={{ fontSize: 11, color: "var(--muted)" }}>● {chart.legend}</span></header>
        {!history.length ? <div className="spark-chart-empty">No published AWE history available</div> : <HistoryChartViewport dates={history.map(point => point.date)} frequency="monthly" height={height - 52} label={`UK ${chart.title} history`}>{(plotWidth, fromYear, toYear, isDefaultWindow) => {
          const visible = isDefaultWindow ? filterHistoryToTrailing12Months(history) : filterHistoryByYearRange(history, fromYear, toYear);
          return <ResponsiveContainer width={plotWidth || "100%"} height="100%"><LineChart data={visible} margin={{ top: 8, right: 10, left: 2, bottom: 14 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
            <XAxis dataKey="date" tickFormatter={value => aweWindowLabel(String(value))} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} minTickGap={28} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 9 }} />
            <YAxis allowDataOverflow width={48} ticks={ticks} domain={getNiceTickDomain(ticks)} tickFormatter={value => `${Number(value).toFixed(digits)}%`} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={value => aweWindowLabel(String(value))} formatter={value => [value == null ? "—" : formatValue(Number(value)), chart.legend]} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }} />
            <Line dataKey="value" name={chart.legend} type="monotone" stroke={chart.color} strokeWidth={2.5} dot={{ r: 3, fill: chart.color, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>;
        }}</HistoryChartViewport>}
      </section>;
    })}
    <span style={{ gridColumn: "1 / -1", color: "var(--muted)", fontSize: 11 }}>ONS-published annual growth in the three-month average: regular pay excludes bonuses; total pay includes bonuses. Each point is labeled by its reference month and the three months averaged.</span>
  </div>;
}

const UK_WAGE_COMPONENT_ROWS = [
  { id: "private-sector", label: "Private sector YoY", regular: "3.0%", total: "3.1%", period: "Jun–Aug 2026 (3m avg)", regularMetricId: "uk-awe-private-regular-yoy", totalMetricId: "uk-awe-private-total-yoy" },
  { id: "public-sector", label: "Public sector YoY", regular: "6.3%", total: "6.3%", period: "Jun–Aug 2026 (3m avg)", regularMetricId: "uk-awe-public-regular-yoy", totalMetricId: "uk-awe-public-total-yoy" },
  { id: "real-pay", label: "Real pay YoY (CPIH-adjusted)", regular: "0.6%", total: "0.7%", period: "Jun–Aug 2026 (3m avg)", regularMetricId: "uk-awe-real-regular-yoy", totalMetricId: "uk-awe-real-total-yoy" },
  { id: "weekly-level", label: "Level, £ per week", regular: "£707", total: "£757", period: "Aug 2026 (single month)", regularMetricId: "uk-awe-regular-level", totalMetricId: "uk-awe-total-level" },
] as const;

function UkWageComponentTable({ allMetrics, onOpen }: { allMetrics: Record<string, DetailPayload | undefined>; onOpen: (row: typeof UK_WAGE_COMPONENT_ROWS[number]) => void }) {
  const rows = UK_WAGE_COMPONENT_ROWS;
  void allMetrics;
  return <section className="uk-wage-component-table">
    <div className="flight-deck-field-head"><div><h3>Published pay components</h3><p>Latest ONS readings · seasonally adjusted</p></div><span>June–August 2026</span></div>
    <div className="uk-wage-table-scroll"><table><thead><tr><th scope="col">Component</th><th scope="col">Regular pay</th><th scope="col">Total pay</th><th scope="col">Period</th><th scope="col"><span className="visually-hidden">Open details</span></th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{row.regular}</td><td>{row.total}</td><td>{row.period}</td><td><button type="button" aria-label={`Open ${row.label} metric card`} onClick={() => onOpen(row)}><ChevronRight size={16} /></button></td></tr>)}
    </tbody></table></div>
    <p className="flight-deck-note">Regular pay excludes bonuses; total pay includes bonuses. Both growth measures are annual changes in the three-month average. Source: ONS Average weekly earnings, October 2026.</p>
  </section>;
}

const EA_WAGE_COMPONENT_IDS = [
  "ea-labour-cost-nonwage-yoy",
  "ea-labour-cost-business-yoy",
  "ea-labour-cost-nonbusiness-yoy",
  "ea-negotiated-wages-yoy",
  "ea-compensation-employee-yoy",
] as const;

const US_JOLTS_RATE_COMPONENTS = [
  { id: "us-jolts-hires", label: "Hires" },
  { id: "us-jolts-quits", label: "Quits" },
  { id: "us-jolts-layoffs", label: "Layoffs & discharges" },
  { id: "us-jolts-total-separations-rate", label: "Total separations" },
] as const;

function UsJoltsRateComponentTable({ allMetrics, onOpen }: {
  allMetrics: Record<string, DetailPayload | undefined>;
  onOpen: (metricId: string) => void;
}) {
  const firstHistory = normalizeHistory(allMetrics[US_JOLTS_RATE_COMPONENTS[0].id]?.history ?? []);
  const priorDate = firstHistory.at(-2)?.date;
  const priorHeading = priorDate ? `Prior (${formatChartDate(priorDate, "monthly", true)})` : "Prior";
  return <section className="ea-wage-component-table us-jolts-rate-component-table" style={{ margin: "18px 0", padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel)" }}>
    <div className="flight-deck-field-head"><div><h3>JOLTS rate components</h3><p>Published seasonally adjusted rates</p></div><span>Monthly · BLS</span></div>
    <div className="uk-wage-table-scroll"><table><thead><tr><th scope="col">Series</th><th scope="col">Headline (rate)</th><th scope="col">{priorHeading}</th><th scope="col"><span className="visually-hidden">Open rate graph</span></th></tr></thead><tbody>
      {US_JOLTS_RATE_COMPONENTS.map(({ id, label }) => {
        const payload = allMetrics[id];
        const history = normalizeHistory(payload?.history ?? []);
        const latest = history.at(-1);
        const prior = history.at(-2);
        return <tr key={id}><th scope="row">{label}</th><td>{latest ? pct(latest.value) : "—"}</td><td>{prior ? pct(prior.value) : "—"}</td><td><button type="button" aria-label={`Open ${label} rate graph`} title={`Open ${label} rate graph`} disabled={!payload} onClick={() => onOpen(id)}><ChevronRight size={16} /></button></td></tr>;
      })}
    </tbody></table></div>
    <p className="flight-deck-note">Rates are the official BLS monthly JOLTS rates. Component histories are fetched from their own BLS series and refresh with JOLTS releases.</p>
  </section>;
}

function EaWageComponentTable({ allMetrics, onOpen }: {
  allMetrics: Record<string, DetailPayload | undefined>;
  onOpen: (metricId: string) => void;
}) {
  const labels: Record<(typeof EA_WAGE_COMPONENT_IDS)[number], string> = {
    "ea-labour-cost-nonwage-yoy": "Non-wage costs YoY",
    "ea-labour-cost-business-yoy": "Business economy, total labour costs YoY",
    "ea-labour-cost-nonbusiness-yoy": "(Mainly) non-business economy, total labour costs YoY",
    "ea-negotiated-wages-yoy": "Negotiated wages (actual)",
    "ea-compensation-employee-yoy": "Compensation per employee YoY",
  };
  return <section className="ea-wage-component-table" style={{ margin: "18px 0", padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel)" }}>
    <div className="flight-deck-field-head"><div><h3>Published wage and labour-cost components</h3><p>Latest official year-on-year readings</p></div><span>Euro Area · quarterly</span></div>
    <div className="uk-wage-table-scroll"><table><thead><tr><th scope="col">Component</th><th scope="col">Latest</th><th scope="col">Source and frequency</th><th scope="col"><span className="visually-hidden">Open details</span></th></tr></thead><tbody>
      {EA_WAGE_COMPONENT_IDS.map(id => {
        const payload = allMetrics[id];
        const point = normalizeHistory(payload?.history ?? []).at(-1);
        const period = point ? formatChartDate(point.date, "quarterly", true) : "No published reading";
        const latest = point ? `${pct(point.value)} (${period})` : "—";
        const source = payload ? `${formatLiveSourceLabel(payload.meta.liveSource)} · ${payload.meta.frequency}` : "—";
        return <tr key={id}><th scope="row">{labels[id]}</th><td>{latest}</td><td>{source}</td><td><button type="button" aria-label={`Open ${labels[id]} metric card`} title={`Open ${labels[id]}`} disabled={!payload} onClick={() => onOpen(id)}><ChevronRight size={16} /></button></td></tr>;
      })}
    </tbody></table></div>
    <p className="flight-deck-note">Eurostat labour-cost rates are calendar-adjusted. Compensation per employee is based on the ECB’s seasonally and calendar-adjusted national-accounts index; negotiated wages are the ECB annual rate of change.</p>
  </section>;
}

function renderQuarterlyGrowthChart(data: Array<{ date: string; quarter: string; value: number }>, chartType: "line" | "bar", seriesLabel: string, formatValue: (value: number) => string, compact: boolean) {
  // This chart receives only the selected year's points, so its scale must be
  // calculated from this year rather than from decade-wide GDP outliers.
  const axisTicks = getNiceTicks([...data.map(point => point.value), 0], 8, seriesLabel.includes("SAAR") ? 0.1 : 1);
  return chartType === "bar" && !compact ? <BarChart data={data} margin={{ top: 10, right: 18, left: 4, bottom: 16 }}>
          <CartesianGrid vertical stroke="var(--line)" strokeDasharray="2 4" />
          <YAxis allowDataOverflow width={42} ticks={axisTicks} domain={getNiceTickDomain(axisTicks)} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <XAxis dataKey="quarter" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 10 }} />
          <Tooltip cursor={{ fill: "var(--accent-soft)", opacity: .45 }} contentStyle={{ border: "1px solid var(--line)", background: "var(--panel)", fontSize: 11 }} labelFormatter={(label) => String(label)} formatter={(value) => [formatValue(Number(value)), seriesLabel]} />
          <Bar dataKey="value" name={seriesLabel} fill="var(--country-series)" maxBarSize={48} minPointSize={value => value === 0 ? 3 : 0} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="value" position="top" formatter={(value) => formatValue(Number(value))} style={{ fill: "var(--ink)", fontSize: 10 }} />
          </Bar>
        </BarChart> : <LineChart data={data} margin={compact ? { top: 5, right: 5, left: 5, bottom: 3 } : { top: 8, right: 22, left: 8, bottom: 18 }}>
          {!compact && <Area type="monotone" dataKey="value" baseValue="dataMin" fill="var(--country-series, var(--accent))" fillOpacity={0.2} stroke="none" tooltipType="none" isAnimationActive={false} />}
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <YAxis allowDataOverflow
            hide={compact}
            width={compact ? 0 : 60}
            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))}
          />
          <XAxis
            dataKey="quarter"
            hide={compact}
            tickLine={false}
            axisLine={!compact}
            tickMargin={8}
            minTickGap={compact ? 0 : 16}
            interval="preserveStartEnd"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={compact ? false : { stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }}
            labelFormatter={(label) => String(label)}
            formatter={(value) => [formatValue(Number(value)), seriesLabel]}
          />
          {!compact && <Legend verticalAlign="top" align="center" height={28} iconType="line" />}
          <Line
            type="monotone"
            dataKey="value"
            name={seriesLabel}
            stroke="var(--country-series, var(--accent))"
            strokeWidth={compact ? 2.6 : 2.8}
            strokeLinecap="round"
            dot={compact ? false : { r: 4, fill: "var(--country-series, var(--accent))", stroke: "var(--panel)", strokeWidth: 1.5 }}
            activeDot={{ r: compact ? 4 : 7, fill: "var(--country-series, var(--accent))", stroke: "var(--panel)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>;
}

function ClaimsTrendChart({
  data,
  seriesName,
  color,
  compact = false,
  height = 352,
}: {
  data: Array<{ date: string; value: number }>;
  seriesName: "Initial Claims" | "Continuing Claims";
  color: string;
  compact?: boolean;
  height?: number;
}) {
  if (!data.length) return compact ? null : <div className="spark-chart-empty">No weekly {seriesName.toLowerCase()} data</div>;

  const render = (yearData: Array<{ date: string; value: number }>, width: number | string) => (
    <ResponsiveContainer width={typeof width === "number" ? width : "100%"} height="100%">
      <LineChart data={yearData} margin={compact ? { top: 4, right: 4, left: 4, bottom: 2 } : { top: 10, right: 20, left: 72, bottom: 24 }}>
        {!compact && <Area type="monotone" dataKey="value" baseValue="dataMin" fill={color} fillOpacity={0.2} stroke="none" tooltipType="none" isAnimationActive={false} />}
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
        <XAxis dataKey="date" hide={compact} tickFormatter={(value) => formatChartDate(value, "weekly")} tickLine={false} axisLine={!compact} tickMargin={8} minTickGap={compact ? 0 : 22} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <YAxis allowDataOverflow hide={compact} width={compact ? 0 : 68} tickFormatter={(value) => formatClaimsCount(Number(value))} tick={{ fill: "var(--muted)", fontSize: 11 }} domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))} />
        <Tooltip cursor={compact ? false : { stroke: color, strokeWidth: 1, strokeDasharray: "4 3" }} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: compact ? 10 : 12 }} labelFormatter={(label) => formatChartDate(String(label), "weekly", true)} formatter={(value, name) => [formatClaimsCount(Number(value)), String(name)]} />
        {!compact && <Legend verticalAlign="top" align="center" height={28} iconType="line" />}
        <Line type="monotone" dataKey="value" name={seriesName} stroke={color} strokeWidth={compact ? 2 : 2.5} strokeLinecap="round" dot={compact ? false : { r: 3.5, fill: "var(--panel)", stroke: color, strokeWidth: 2 }} activeDot={{ r: compact ? 3 : 6 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div
      className={compact ? "macro-mini-chart" : undefined}
      style={{ width: "100%", height: compact ? 61 : height, minHeight: 0 }}
      aria-label={`${seriesName} weekly trend`}
    >
      <HistoryChartViewport dates={data.map(point => point.date)} frequency="weekly" height={compact ? 52 : height} label={`${seriesName} history`} compact={compact}>
        {compact ? render(filterHistoryToTrailing12Months(data), "100%") : (width, fromYear, toYear, isDefaultWindow) => render(chartDataForRange(data, fromYear, toYear, isDefaultWindow), width || "100%")}
      </HistoryChartViewport>
    </div>
  );
}

function ClaimsMiniCharts({ initial, continuing }: { initial: DetailPayload | undefined; continuing: DetailPayload | undefined }) {
  return (
    <div className="claims-mini-pair" aria-label="Initial and continuing claims charts">
      {[
        { name: "Initial Claims" as const, data: claimsTrendPoints(initial), color: "var(--country-series)" },
        { name: "Continuing Claims" as const, data: claimsTrendPoints(continuing), color: "var(--up)" },
      ].map((series) => (
        <div className="claims-mini-series" key={series.name}>
          <span>{series.name}</span>
          <ClaimsTrendChart data={series.data} seriesName={series.name} color={series.color} compact />
        </div>
      ))}
    </div>
  );
}

function ClaimsDetailCharts({ initial, continuing, height, animateTrace = false }: { initial: DetailPayload | undefined; continuing: DetailPayload | undefined; height: number; animateTrace?: boolean }) {
  const initialTrend = new Map(normalizeHistory(initial?.threeMonth?.history ?? []).map(point => [point.date.slice(0, 10), point.value]));
  const continuingTrend = new Map(normalizeHistory(continuing?.threeMonth?.history ?? []).map(point => [point.date.slice(0, 10), point.value]));
  const data = mergeClaimsChartData(
    normalizeHistory(initial?.history ?? []),
    normalizeHistory(continuing?.history ?? []),
  ).map(point => ({ ...point, initialTrend: initialTrend.get(point.date.slice(0, 10)) ?? null, continuingTrend: continuingTrend.get(point.date.slice(0, 10)) ?? null }));
  if (!data.length) return <div className="spark-chart-empty">No weekly claims data</div>;
  const initialColor = "var(--country-series, var(--accent))";
  const continuingColor = "var(--country-uk)";
  const chartHeight = Math.max(180, height - 34);

  return (
    <div className="claims-detail-combined" style={{ width: "100%", height: chartHeight, minHeight: 0 }}>
      <HistoryChartViewport dates={data.map(point => point.date)} frequency="weekly" height={chartHeight} label="Initial and continuing claims history">
        {(plotWidth, fromYear, toYear, isDefaultWindow) => {
          const yearData = chartDataForRange(data, fromYear, toYear, isDefaultWindow);
          const initialTicks = getNiceTicks(yearData.flatMap(point => [point.initial, point.initialTrend].filter((value): value is number => value != null)), 7, 1_000);
          const continuingTicks = getNiceTicks(yearData.flatMap(point => [point.continuing, point.continuingTrend].filter((value): value is number => value != null)), 7, 10_000);
          return <ResponsiveContainer width={plotWidth || "100%"} height="100%">
            <LineChart data={yearData} margin={{ top: 12, right: 12, left: 4, bottom: 20 }}>
              <Area yAxisId="initial" type="monotone" dataKey="initial" baseValue={initialTicks[0] ?? "dataMin"} fill={initialColor} fillOpacity={0.16} stroke="none" tooltipType="none" isAnimationActive={false} />
              <Area yAxisId="continuing" type="monotone" dataKey="continuing" baseValue={continuingTicks[0] ?? "dataMin"} fill={continuingColor} fillOpacity={0.16} stroke="none" tooltipType="none" isAnimationActive={false} />
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
              <XAxis dataKey="date" tickFormatter={value => formatChartDate(String(value), "weekly")} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} minTickGap={22} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis allowDataOverflow yAxisId="initial" orientation="left" width={74} domain={getNiceTickDomain(initialTicks)} ticks={initialTicks} tickFormatter={value => formatClaimsCount(Number(value))} tick={{ fill: initialColor, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis allowDataOverflow yAxisId="continuing" orientation="right" width={82} domain={getNiceTickDomain(continuingTicks)} ticks={continuingTicks} tickFormatter={value => formatClaimsCount(Number(value))} tick={{ fill: continuingColor, fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as (typeof data)[number] | undefined;
                if (!point) return null;
                return <div style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", padding: "10px 12px", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }}>
                  <strong style={{ display: "block", marginBottom: 8 }}>{formatChartDate(String(label), "weekly", true)}</strong>
                  <table style={{ borderCollapse: "collapse", minWidth: 230 }}>
                    <thead><tr><th style={{ textAlign: "left", padding: "2px 8px 5px 0" }}>Measure</th><th style={{ textAlign: "right", padding: "2px 8px 5px" }}>Initial claims</th><th style={{ textAlign: "right", padding: "2px 0 5px 8px" }}>Continuing claims</th></tr></thead>
                    <tbody>
                      <tr><th style={{ textAlign: "left", fontWeight: 500, paddingRight: 8 }}>Weekly</th><td style={{ textAlign: "right", padding: "3px 8px" }}>{formatClaimsCount(point.initial)}</td><td style={{ textAlign: "right", paddingLeft: 8 }}>{formatClaimsCount(point.continuing)}</td></tr>
                      <tr><th style={{ textAlign: "left", fontWeight: 500, paddingRight: 8 }}>4-week average</th><td style={{ textAlign: "right", padding: "3px 8px" }}>{formatClaimsCount(point.initialTrend)}</td><td style={{ textAlign: "right", paddingLeft: 8 }}>{formatClaimsCount(point.continuingTrend)}</td></tr>
                    </tbody>
                  </table>
                </div>;
              }} />
              <Legend verticalAlign="top" align="center" height={28} iconType="line" />
              <Line yAxisId="initial" type="monotone" dataKey="initial" name="Initial Claims" stroke={initialColor} strokeWidth={2.5} strokeLinecap="round" dot={animateTrace ? (point) => { const index = Number(point.index ?? 0); const delay = index * 1500 / Math.max(1, yearData.length - 1); const latest = index === yearData.length - 1; return <g key={`claims-initial-${index}`}><circle cx={point.cx} cy={point.cy} r={latest ? 3.5 : 2.5} fill={initialColor} opacity={latest ? 1 : 0}><animate attributeName="opacity" values={latest ? "0;1" : "0;1;0"} keyTimes={latest ? "0;1" : "0;0.25;1"} dur="220ms" begin={`${delay}ms`} fill="freeze" /></circle>{latest && <circle cx={point.cx} cy={point.cy} r="10" fill={initialColor} opacity="0.18" />}</g>; } : { r: 3, fill: "var(--panel)", stroke: initialColor, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={animateTrace} animationDuration={1500} animationEasing="ease-in-out" />
              {initial?.threeMonth?.history?.length ? <Line yAxisId="initial" type="monotone" dataKey="initialTrend" name={initial.threeMonth.label} stroke={initialColor} strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} /> : null}
              <Line yAxisId="continuing" type="monotone" dataKey="continuing" name="Continuing Claims" stroke={continuingColor} strokeWidth={2.5} strokeLinecap="round" dot={animateTrace ? (point) => { const index = Number(point.index ?? 0); const delay = index * 1500 / Math.max(1, yearData.length - 1); const latest = index === yearData.length - 1; return <g key={`claims-continuing-${index}`}><circle cx={point.cx} cy={point.cy} r={latest ? 3.5 : 2.5} fill={continuingColor} opacity={latest ? 1 : 0}><animate attributeName="opacity" values={latest ? "0;1" : "0;1;0"} keyTimes={latest ? "0;1" : "0;0.25;1"} dur="220ms" begin={`${delay}ms`} fill="freeze" /></circle>{latest && <circle cx={point.cx} cy={point.cy} r="10" fill={continuingColor} opacity="0.18" />}</g>; } : { r: 3, fill: "var(--panel)", stroke: continuingColor, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={animateTrace} animationDuration={1500} animationEasing="ease-in-out" />
              {continuing?.threeMonth?.history?.length ? <Line yAxisId="continuing" type="monotone" dataKey="continuingTrend" name={`Continuing Claims · ${continuing.threeMonth.label}`} stroke={continuingColor} strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} /> : null}
            </LineChart>
          </ResponsiveContainer>;
        }}
      </HistoryChartViewport>
    </div>
  );
}

function isUkInflationHiddenSpec(spec: IndicatorSpec) {
  const title = (spec.title ?? "").toLowerCase();
  const id = spec.id.toLowerCase();

  return (
    title.includes("food inflation") ||
    title.includes("housing & household services") ||
    title.includes("household services") ||
    id.includes("food-inflation") ||
    id.includes("food_inflation") ||
    id.includes("household-services") ||
    id.includes("household_services")
  );
}

function isInflationExpectationSpecId(spec: IndicatorSpec) {
  const text = `${spec.id} ${spec.title ?? ""} ${spec.metricId}`.toLowerCase();

  return (
    text.includes("expectation") ||
    text.includes("market-based") ||
    text.includes("market participants") ||
    text.includes("market-participant")
  );
}

function Spark({
  data,
  tone = "blue",
  compact = false,
  frequency = "monthly",
  metricId,
}: {
  data: Array<{ date: string; value: number }>;
  tone?: string;
  compact?: boolean;
  frequency?: string;
  metricId?: string;
}) {
  const [selectedPoint, setSelectedPoint] = useState<{ date: string; value: number } | null>(null);
  const points = filterHistoryToTrailing12Months([...data])
  .sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  .map((p) => ({
    date: p.date.slice(0, 10),
    value: Number(p.value),
  }))
  .filter((p) =>
    Number.isFinite(p.value)
  );

  if (!points.length) {
    return <div className="spark-chart-empty">No data</div>;
  }

  const formatDate = (date: string) =>
    formatChartDate(date, frequency, true);

  const formatValue = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
    }

    return value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
    });
  };

  return (
    <div
      className={clsx(
        "spark-chart",
        compact && "spark-chart-compact"
      )}
      style={{ width: "100%", height: compact ? 61 : 304, position: "relative", cursor: compact ? "crosshair" : undefined }}
      onClick={compact ? (event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const plotLeft = compact ? 36 : 0;
        const plotWidth = Math.max(bounds.width - plotLeft - (compact ? 6 : 0), 1);
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left - plotLeft) / plotWidth));
        const pointIndex = Math.round(ratio * (points.length - 1));
        setSelectedPoint(points[pointIndex]);
        event.stopPropagation();
      } : undefined}
      aria-label={compact ? "Click a chart position to inspect its date and reading" : undefined}
    >
      {compact && selectedPoint && <div className="spark-pinned-point" role="status"><b>{formatDate(selectedPoint.date)}</b><span>Reading: {formatValue(selectedPoint.value)}</span></div>}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{
            top: compact ? 3 : 16,
            right: compact ? 5 : 24,
            left: compact ? 0 : 12,
            bottom: compact ? 0 : 28,
          }}
        >
          <Area type="monotone" dataKey="value" baseValue="dataMin" fill="var(--country-series)" fillOpacity={0.2} stroke="none" tooltipType="none" isAnimationActive={false} />
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={compact}
          />

          <XAxis
  dataKey="date"
  tickFormatter={(value) => compact ? formatChartDate(value, frequency).replace(/\s+\d{4}$/, "") : formatChartDate(value, frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={compact ? 2 : 10}
  height={compact ? 16 : 40}
  minTickGap={compact ? 10 : 24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
    fontSize: compact ? 8 : 12,
  }}
/>

          <YAxis allowDataOverflow
  hide={compact}
  tickLine={false}
  axisLine={!compact}
  width={compact ? 36 : 60}
  tickCount={compact ? 3 : 5}
  tickFormatter={formatValue}
  domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))}
/>

          <Tooltip
            cursor={{ stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
            labelFormatter={(label) =>
              `Date: ${formatDate(String(label))}`
            }
            formatter={(value) => [
              formatValue(Number(value)),
              "Value",
            ]}
          />

          <Line
            type="monotone"
            dataKey="value"
            name="Value"
            stroke="var(--country-series)"
            strokeWidth={2.5}
            dot={{
              r: compact ? 1.5 : 4,
            }}
            activeDot={{
              r: compact ? 3 : 7,
            }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}



function formatChartDate(
  value: unknown,
  frequency?: string,
  fullDate = false
) {
  const raw = String(value ?? "").trim();

  if (!raw) return "—";

  const quarter = raw.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;

  if (/^\d{4}$/.test(raw)) return raw;

  // Handle normal ISO calendar dates.
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const date = new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00Z`);

    if (!Number.isNaN(date.getTime())) {
      if (frequency === "quarterly") {
        return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
      }
      if (frequency === "annual") return String(date.getUTCFullYear());
      if (frequency === "weekly") {
        return new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "2-digit",
          ...(fullDate ? { year: "numeric" as const } : {}),
          timeZone: "UTC",
        }).format(date);
      }

      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
  }

  // Handle YYYY-MM values.
  const isoMonth = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) {
    const date = new Date(`${isoMonth[1]}-${isoMonth[2]}-01T00:00:00Z`);

    if (!Number.isNaN(date.getTime())) {
      if (frequency === "quarterly") {
        return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
      }
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
  }

  // Never pass an invalid Date into Intl.DateTimeFormat.
  return raw;
}

function isUsJobsMetric(
  metric: DetailPayload | undefined,
  kind: "unemployment" | "participation" | "jolts"
) {
  const id = metric?.meta.id ?? "";

  if (kind === "unemployment") {
    return id === "us-unemployment";
  }

  if (kind === "participation") {
    return id === "us-participation";
  }

  return id === "us-jolts-openings";
}

function displayMetricTitle(
  spec: IndicatorSpec | undefined,
  metric: DetailPayload | undefined
) {
  if (isUsJobsMetric(metric, "jolts")) {
    return "Job Openings";
  }

  return (
    spec?.title ??
    metric?.meta.shortName ??
    metric?.meta.name ??
    metric?.meta.id ??
    "Indicator"
  );
}

function AheGrowthChart({ root, mom, height }: { root: DetailPayload; mom?: DetailPayload; height: number }) {
  const [measure, setMeasure] = useState<"trend" | "mom">("trend");
  const yoy = normalizeHistory(root.history ?? []);
  const trend = normalizeHistory(root.threeMonth?.history ?? []);
  const monthly = normalizeHistory(mom?.history ?? []);
  const primary = measure === "mom" ? monthly : yoy;
  const byDate = new Map<string, { date: string; value: number | null; trend?: number | null }>(primary.map(point => [point.date, { date: point.date, value: point.value }]));
  if (measure === "trend") trend.forEach(point => { const row = byDate.get(point.date) ?? { date: point.date, value: null }; byDate.set(point.date, { ...row, trend: point.value }); });
  const data = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <div role="group" aria-label="Average hourly earnings measure" style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
      {([ ["trend", "YoY + 3m/3m"], ["mom", "MoM"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", background: measure === value ? "var(--country-series)" : "var(--panel)", color: measure === value ? "white" : "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{label}</button>)}
    </div>
    <HistoryChartViewport dates={data.map(point => point.date)} frequency="monthly" height={height} label="Average Hourly Earnings history">
      {(plotWidth, fromYear, toYear, isDefaultWindow) => {
        const visible = chartDataForRange(data, fromYear, toYear, isDefaultWindow);
        const visibleTicks = getNiceTicks(visible.flatMap(point => [point.value, measure === "trend" ? point.trend : null]).filter((value): value is number => value != null));
        const visibleDigits = Math.max(1, getTickPrecision(visibleTicks));
        return <ResponsiveContainer width={plotWidth || "100%"} height="100%"><LineChart data={visible} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
      <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
      <XAxis dataKey="date" tickFormatter={value => formatChartDate(String(value), "monthly")} tick={{ fill: "var(--muted)", fontSize: 10 }} minTickGap={22} interval="preserveStartEnd" axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} />
      <YAxis unit="%" width={54} ticks={visibleTicks} domain={getNiceTickDomain(visibleTicks)} tickFormatter={value => `${Number(value).toFixed(visibleDigits)}%`} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
       <Tooltip labelFormatter={value => `Date: ${formatChartDate(String(value), "monthly", true)}`} formatter={(value, name) => [`${Number(value).toFixed(visibleDigits)}%`, name === "3m/3m" ? "3m/3m SAAR" : measure === "mom" ? "MoM" : "YoY"]} />
      <Legend />
      <Line dataKey="value" name={measure === "mom" ? "MoM" : "YoY"} type="monotone" stroke="var(--country-series)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
      {measure === "trend" && <Line dataKey="trend" name="3m/3m" type="monotone" stroke="var(--country-series)" strokeWidth={2.5} strokeDasharray="3 4" dot={false} connectNulls={false} isAnimationActive={false} />}
    </LineChart></ResponsiveContainer>;
      }}
    </HistoryChartViewport>
  </div>;
}

function EuroAreaWageChart({ wages, total, height }: { wages: DetailPayload; total?: DetailPayload; height: number }) {
  const wageHistory = normalizeHistory(wages.history ?? []);
  const totalHistory = normalizeHistory(total?.history ?? []);
  const dates = [...new Set([...wageHistory.map(point => point.date), ...totalHistory.map(point => point.date)])].sort();
  const wageByDate = new Map(wageHistory.map(point => [point.date, point.value]));
  const totalByDate = new Map(totalHistory.map(point => [point.date, point.value]));
  const data = dates.map(date => ({ date, wages: wageByDate.get(date) ?? null, total: totalByDate.get(date) ?? null }));
  return <HistoryChartViewport dates={data.map(point => point.date)} frequency="quarterly" height={height} label="Euro Area wage growth history">
    {(plotWidth, fromYear, toYear, isDefaultWindow) => {
      const visible = chartDataForRange(data, fromYear, toYear, isDefaultWindow);
      const ticks = getNiceTicks(visible.flatMap(point => [point.wages, point.total]).filter((value): value is number => value != null), 7, 0.1);
      const digits = Math.max(1, getTickPrecision(ticks));
      return <ResponsiveContainer width={plotWidth || "100%"} height="100%"><LineChart data={visible} margin={{ top: 12, right: 18, left: 4, bottom: 12 }}>
    <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
    <XAxis dataKey="date" tickFormatter={value => formatChartDate(String(value), "quarterly")} tick={{ fill: "var(--muted)", fontSize: 10 }} minTickGap={24} interval="preserveStartEnd" axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} />
    <YAxis unit="%" width={56} ticks={ticks} domain={getNiceTickDomain(ticks)} tickFormatter={value => `${Number(value).toFixed(digits)}%`} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
    <Tooltip labelFormatter={value => formatChartDate(String(value), "quarterly", true)} formatter={(value, name) => [value == null ? "—" : `${Number(value).toFixed(digits)}%`, name === "wages" ? "Wages & salaries · YoY" : "Total hourly labour costs · YoY"]} />
    <Legend formatter={value => value === "wages" ? "Wages & salaries · YoY" : "Total hourly labour costs · YoY"} />
    <Line dataKey="wages" name="wages" type="monotone" stroke="var(--country-series)" strokeWidth={2.6} dot={{ r: 3, fill: "var(--country-series)" }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
    <Line dataKey="total" name="total" type="monotone" stroke="#c66b3d" strokeWidth={2.6} dot={{ r: 3, fill: "#c66b3d" }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
  </LineChart></ResponsiveContainer>;
    }}
  </HistoryChartViewport>;
}

function RateChart({
  spec,
  root,
  allMetrics,
  height: requestedHeight = 450,
  chartType = "line",
  showRetailSalesBoth = false,
  comparisonMetric,
  retailYoyMetric,
  comparisonYoyMetric,
  animateTrace = false,
  retailMeasure: controlledRetailMeasure,
  onRetailMeasureChange,
  showThreeMonth = false,
}: {
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
  height?: number;
  chartType?: "line" | "bar";
  showRetailSalesBoth?: boolean;
  comparisonMetric?: DetailPayload;
  retailYoyMetric?: DetailPayload;
  comparisonYoyMetric?: DetailPayload;
  animateTrace?: boolean;
  retailMeasure?: "paired" | "mom" | "yoy" | "3m3m";
  onRetailMeasureChange?: (measure: "paired" | "mom" | "yoy" | "3m3m") => void;
  showThreeMonth?: boolean;
}) {
  const height = Math.round(Math.max(450, requestedHeight) * 0.8);
  const [internalRetailMeasure, setInternalRetailMeasure] = useState<"paired" | "mom" | "yoy" | "3m3m">("mom");
  const retailMeasure = controlledRetailMeasure ?? internalRetailMeasure;
  const setRetailMeasure = (measure: "paired" | "mom" | "yoy" | "3m3m") => {
    if (onRetailMeasureChange) onRetailMeasureChange(measure);
    else setInternalRetailMeasure(measure);
  };
  useEffect(() => {
    if (controlledRetailMeasure === undefined) setInternalRetailMeasure(root?.meta.region === "UK" ? "mom" : root?.threeMonth?.history?.length && ["US", "EA"].includes(root?.meta.region ?? "") ? "paired" : "mom");
  }, [root?.meta.id, controlledRetailMeasure]);
  // UK PPI publishes its annual and monthly changes as paired series. Keep
  // the MoM counterpart attached even when a lightweight detail spec only
  // carries the YoY metric id.
  const chartSpec = (spec.metricId.startsWith("uk-ppi-") || spec.metricId.startsWith("ea-ppi-")) && spec.metricId.endsWith("-yoy")
    ? {
        ...spec,
        yoyMetricId: spec.yoyMetricId ?? spec.metricId,
        momMetricId: spec.momMetricId ?? spec.metricId.replace(/-yoy$/, "-mom"),
      }
    : spec;
  const useBarChart = (chartType === "bar" || ACTIVITY_BAR_SPEC_IDS.has(spec.id)) && !(root?.threeMonth?.history?.length && ["US", "UK", "EA"].includes(root?.meta.region ?? "") && !isQuarterlyGdpMetric(root?.meta.id));
  if (spec.groupOnly) return <div style={{ display: 'grid', gap: 20 }}>
    <p style={{ margin: 0, color: 'var(--muted)' }}>BLS publishes separate intermediate-demand indexes. Each official component is shown below with its own YoY and MoM history.</p>
    {inflationPlotSpecs([spec]).map(part => <article key={part.id}>
      <h4>{part.title}</h4>
      <RateChart spec={part} root={allMetrics[part.metricId]} allMetrics={allMetrics} height={270} />
    </article>)}
  </div>;
  const isExpectationMetric = Boolean(
    isInflationExpectationSpecId(spec) ||
    root?.meta.subcategory?.toLowerCase().includes("expect") ||
    root?.meta.name.toLowerCase().includes("expect")
  );
  // Atlanta already publishes wage growth as a rate. Reuse the overview
  // chart rather than calculating YoY/MoM changes from those rate values.
  if (root?.meta.id === "us-atlanta-wage") {
    const group = NYFED_OVERVIEW_CHART_GROUPS.payGrowth;
    return <ExpectationComparisonChart
      title={group.title}
      note={group.note}
      series={[expectationSeries(allMetrics, root.meta.id)]}
      showAlternateMonthlyTicks
    />;
  }
  if (root && isLaborChangeMetric(root.meta.id)) return <LaborChangeChart metric={root} height={height} />;

  const rootHistory = normalizeHistory(root?.history ?? []);
  if (root?.meta.id === "us-ahe") return <AheGrowthChart root={root} mom={allMetrics["us-ahe-mom"]} height={height} />;
  if (root?.meta.id === "ea-wage-growth") return <EuroAreaWageChart wages={root} total={allMetrics["ea-labour-cost-total-yoy"]} height={height} />;
  if (root?.meta.region === "UK" && ["uk-awe-regular-yoy", "uk-awe-total-yoy"].includes(root.meta.id)) {
    return <UkWageComparisonChart allMetrics={allMetrics} height={height} />;
  }
  const isRetailSalesMetric =
    root?.meta.id === "us-retail-sales-total" ||
    root?.meta.id === "us-retail-sales-control-group" ||
    root?.meta.id === "uk-retail-sales-total-ex-fuel" ||
    root?.meta.id === "uk-retail-sales-ex-fuel" ||
    root?.meta.id === "ea-retail-sales-total-ex-motor-vehicles" ||
    root?.meta.id === "ea-retail-sales-ex-fuel";
  if (showThreeMonth && root?.threeMonth && !["US", "UK", "EA"].includes(root.meta.region)) return <ThreeMonthHistoryChart metric={root} height={height} />;
  if (isRetailSalesMetric && retailMeasure === "paired" && root?.threeMonth && ["US", "UK", "EA"].includes(root.meta.region)) return <div style={{ width: "100%", minHeight: 0, display: "grid", gap: 10 }}>
    <div role="group" aria-label="Retail sales chart measure" style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
      {(["paired", "mom"] as const).map(measure => <button key={measure} type="button" aria-pressed={retailMeasure === measure} onClick={() => setRetailMeasure(measure)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", background: retailMeasure === measure ? "var(--country-series)" : "var(--panel)", color: retailMeasure === measure ? "white" : "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{measure === "paired" ? "YoY + " + (root.threeMonth?.label ?? "3m/3m") : measure === "mom" ? "MoM" : "YoY"}</button>)}
    </div>
    <ThreeMonthHistoryChart metric={root} comparisonMetric={comparisonMetric} yoyMetric={retailYoyMetric} comparisonYoyMetric={comparisonYoyMetric} height={height} />
  </div>;
  const retailThreeMonthLabel = root?.threeMonth?.label ?? "3m/3m";
  const retailComparisonLabel = comparisonMetric?.meta.id === "us-retail-sales-control-group"
    ? "Retail Sales Control Group"
    : ["ea-retail-sales-ex-fuel", "uk-retail-sales-ex-fuel"].includes(comparisonMetric?.meta.id ?? "") ? "Retail Sales ex Fuel" : "Retail Sales ex Fuel";

  const sortedRootHistory = [...rootHistory].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  // Inflation expectations are already published as percent levels (for
  // example, UMich's 4.8%). They must be charted directly rather than passed
  // through the generic YoY/MoM derivation used for index series.
  if (isExpectationMetric && root) {
    const data = getPublishedExpectationReadingsAsOf(root.history ?? []);
    if (!data.length) {
      return <div className="spark-chart-empty">No published observations</div>;
    }

    return (
      <div style={{ width: "100%", height, minHeight: 0 }}>
        <HistoryChartViewport dates={data.map((point) => point.date)} frequency={root.meta.frequency} height={height} label={displayMetricTitle(spec, root)}>
          {(plotWidth, fromYear, toYear, isDefaultWindow) => {
            const yearData = chartDataForRange(data, fromYear, toYear, isDefaultWindow);
            const ticks = getExpectationAxisTicks(yearData.map((point) => point.value));
            const digits = Math.max(1, getTickPrecision(ticks));

            return (
              <ResponsiveContainer width={plotWidth || "100%"} height="100%">
                <LineChart data={yearData} margin={{ top: 12, right: 20, left: 4, bottom: 16 }}>
                  <Area type="monotone" dataKey="value" baseValue={ticks[0] ?? "dataMin"} fill="var(--country-series)" fillOpacity={0.24} stroke="none" tooltipType="none" isAnimationActive={false} />
                  <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
                  <XAxis dataKey="date" tickFormatter={(value) => formatChartDate(value, root.meta.frequency)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} minTickGap={24} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <YAxis allowDataOverflow width={58} ticks={ticks} domain={getNiceTickDomain(ticks)} tickFormatter={(value) => `${Number(value).toFixed(digits)}%`} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={(label) => `Date: ${formatChartDate(String(label), root.meta.frequency, true)}`} formatter={(value) => [formatExpectationValue(root, Number(value)), root.meta.shortName || root.meta.name]} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }} />
                  <Line dataKey="value" name={root.meta.shortName || root.meta.name} type="monotone" stroke="var(--country-series)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 1.5 }} activeDot={{ r: 7, stroke: "var(--panel)", strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            );
          }}
        </HistoryChartViewport>
      </div>
    );
  }

  if (isQuarterlyGdpMetric(root?.meta.id)) {
    return <QuarterlyGdpChart metric={root} height={height} chartType={useBarChart ? "bar" : "line"} />;
  }

  if (root?.meta.id === "us-initial-claims") {
    return <ClaimsDetailCharts initial={root} continuing={allMetrics["us-continuing-claims"]} height={height} animateTrace={animateTrace} />;
  }

  const isUSNetExports = isUSNetExportsMetric(root);

  const isUsHeadlineCpi =
    spec.id === "us-cpi-card" ||
    root?.meta.id === "us-cpi";

  const yoyHistory = retailYoyMetric
    ? normalizeHistory(retailYoyMetric.history ?? [])
    : chartSpec.yoyMetricId
      ? normalizeHistory(allMetrics[chartSpec.yoyMetricId]?.history ?? [])
      : [];

  const configuredMomHistory = chartSpec.momMetricId
    ? normalizeHistory(
        allMetrics[chartSpec.momMetricId]?.history ?? []
      )
    : [];

  const cpiMomHistory = isUsHeadlineCpi
    ? normalizeHistory(
        allMetrics["us-cpi-mom"]?.history ?? []
      )
    : [];

  const isUkPublishedRetail = root?.meta.region === "UK" && ["uk-retail-sales-total-ex-fuel", "uk-retail-sales-ex-fuel"].includes(root.meta.id);
  const momHistory = isUkPublishedRetail ? sortedRootHistory :
    isUsHeadlineCpi && cpiMomHistory.length
      ? cpiMomHistory
      : configuredMomHistory;

  const secondLabel =
    root?.meta.frequency === "weekly"
      ? "WoW"
      : root?.meta.id === "uk-unemployment" ||
          root?.meta.id === "uk-employment-rate" ||
          root?.meta.id === "uk-inactivity-rate"
        ? "QoQ"
        : root?.meta.frequency === "quarterly"
          ? "QoQ"
          : "MoM";

  /*
   * Net Exports is a level series in dollars, not a YoY/MoM
   * rate pair. Keep its existing single-series treatment.
   */
  if (isUSNetExports) {
    const data = sortedRootHistory
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      );

    if (!data.length) {
      return (
        <div
          style={{
            width: "100%",
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          No published observations
        </div>
      );
    }

    if (useBarChart) {
      return <div style={{ width: "100%", height, minHeight: 0 }}><HistoryChartViewport dates={data.map(point => point.date)} frequency={root?.meta.frequency} height={height} label="Net Exports">{(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearData = chartDataForRange(data, fromYear, toYear, isDefaultWindow); const yearTicks = getNiceTicks([0, ...yearData.map(point => point.value).filter((value): value is number => value != null && Number.isFinite(value))]); return <ResponsiveContainer width={plotWidth} height="100%"><BarChart data={yearData} margin={{ top: 10, right: 18, left: 8, bottom: 18 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
        <XAxis dataKey="date" tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} minTickGap={24} interval="preserveStartEnd" tick={{ fill: "var(--muted)", fontSize: 10 }} />
        <YAxis allowDataOverflow width={74} ticks={yearTicks} domain={getNiceTickDomain(yearTicks)} tickFormatter={(value) => formatUsNetExportsValue(Number(value))} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip labelFormatter={(label) => `Date: ${formatChartDate(String(label), root?.meta.frequency, true)}`} formatter={(value) => [formatUsNetExportsValue(Number(value)), "Net Exports"]} />
        <Legend verticalAlign="top" align="left" height={24} iconType="square" />
        <Bar dataKey="value" name="Net Exports" fill="var(--country-series)" maxBarSize={36} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          <LabelList dataKey="value" position="top" formatter={(value) => value == null ? "" : formatUsNetExportsValue(Number(value))} style={{ fill: "var(--ink)", fontSize: 8 }} />
        </Bar>
      </BarChart></ResponsiveContainer>; }}</HistoryChartViewport></div>;
    }

    return (
      <div
  style={{
    width: "100%",
    height,
    minHeight: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
        <HistoryChartViewport dates={data.map(point => point.date)} frequency={root?.meta.frequency} height={height} label="Net Exports">{(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearData = chartDataForRange(data, fromYear, toYear, isDefaultWindow); const yearTicks = getNiceTicks([...yearData.flatMap(point => [point.value, "trend" in point ? point.trend as number : null]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)), ...(useBarChart ? [0] : [])]); return <ResponsiveContainer width={plotWidth} height="100%">
          <LineChart
            data={yearData}
            margin={{
  top: 8,
  right: 24,
  left: 8,
  bottom: 20,
}}
          >
            <Area type="monotone" dataKey="value" baseValue={yearTicks[0] ?? "dataMin"} fill="var(--country-series)" fillOpacity={0.2} stroke="none" tooltipType="none" isAnimationActive={false} />
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />

            <XAxis
  dataKey="date"
  tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={10}
  height={40}
  minTickGap={24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
    fontSize: 10,
  }}
/>

            <YAxis allowDataOverflow
              tickLine={false}
              axisLine={true}
              width={74}
              tickFormatter={(value) =>
                formatUsNetExportsValue(Number(value))
              }
              ticks={yearTicks}
              domain={getNiceTickDomain(yearTicks)}
            />

            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }}
              labelFormatter={(label) =>
                `Date: ${formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )}`
              }
              formatter={(value) => [
                formatUsNetExportsValue(
                  Number(value)
                ),
                "Net Exports",
              ]}
            />

            <Legend
              verticalAlign="top"
              align="center"
              height={28}
              iconType="line"
            />

            <Line
              type="monotone"
              dataKey="value"
              name="Net Exports"
              stroke="var(--country-series)"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 1.5 }}
              activeDot={{ r: 7, stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>; }}</HistoryChartViewport>
      </div>
    );
  }

  /*
   * Latest/Prior metrics are single-series level/rate indicators.
   * Do NOT manufacture YoY + MoM charts for these.
   *
   * Examples:
   *   - UK unemployment / employment / inactivity
   *   - UK vacancies / payrolled employment
   *   - other metrics whose KPI pair is explicitly Latest + Prior
   *
   * Their chart must plot the published value itself, matching the
   * Latest / Prior KPI cards above it.
   */
  const kpis = getMetricKpis(root);
  const isPayrollLevel = root?.meta.id === "us-payrolls-level";
  const isLatestPriorMetric = isPayrollLevel || (
    kpis.leftLabel === "Latest" &&
    kpis.rightLabel === "Prior" &&
    kpis.showRight);

  if (isLatestPriorMetric) {
    const highFrequency = root?.meta.frequency === "daily" || root?.meta.frequency === "hourly";
    const todayKey = new Date().toISOString().slice(0, 10);
    const trendByPeriod = new Map((["US", "UK", "EA"].includes(root?.meta.region ?? "") ? normalizeHistory(root?.threeMonth?.history ?? []) : []).map(point => [root?.meta.frequency === "weekly" ? point.date.slice(0, 10) : point.date.slice(0, 7), point.value]));
    const data = sortedRootHistory
      .filter((point) => !highFrequency || point.date.slice(0, 10) <= todayKey)
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
        trend: trendByPeriod.get(root?.meta.frequency === "weekly" ? point.date.slice(0, 10) : point.date.slice(0, 7)) ?? null,
      }))
      .filter((point) => Number.isFinite(point.value));
    if (!data.length) {
      return (
        <div
          style={{
            width: "100%",
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          No published observations
        </div>
      );
    }

    return (
      <div
  style={{
    width: "100%",
    height,
    minHeight: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
        <HistoryChartViewport dates={data.map(point => point.date)} frequency={root?.meta.frequency} height={height} label={root?.meta.name ?? "Indicator history"}>{(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearData = chartDataForRange(data, fromYear, toYear, isDefaultWindow); const laborTrendAxis = ["US", "UK"].includes(root?.meta.region ?? "") && root?.meta.category === "jobs" && yearData.some(point => "trend" in point && typeof point.trend === "number"); const yearTicks = getNiceTicks(yearData.flatMap(point => [point.value, ...(!laborTrendAxis && "trend" in point ? [point.trend as number] : [])]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).concat(useBarChart ? [0] : []), 7, 0.05); const trendTicks = laborTrendAxis ? getNiceTicks(yearData.flatMap(point => "trend" in point && typeof point.trend === "number" ? [point.trend] : []), 7, root?.meta.unit === "percent" ? 0.05 : 1) : []; return <ResponsiveContainer width={plotWidth} height="100%">
          {useBarChart ? <BarChart
            data={yearData}
            margin={{
              top: 10,
              right: 18,
              left: 6,
              bottom: 16,
            }}
          >
            <CartesianGrid
              stroke="var(--line)"
              strokeDasharray="2 4"
              vertical
            />

            <XAxis
  dataKey="date"
  tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={10}
  height={40}
  minTickGap={24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
  fontSize: 10,
  }}
/>

            <YAxis allowDataOverflow
              tickLine={false}
              axisLine={true}
              width={74}
              tickFormatter={(value) =>
                formatMetricValue(
                  Number(value),
                  root
                )
              }
              ticks={yearTicks}
              domain={getNiceTickDomain(yearTicks)}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
            />

            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={(label) => `Date: ${formatChartDate(String(label), root?.meta.frequency, true)}`} formatter={(value, name) => [formatMetricValue(Number(value), root), String(name ?? root?.meta.shortName ?? root?.meta.name ?? "Value")]} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }} />
            <Bar dataKey="value" name={root?.meta.shortName ?? root?.meta.name ?? "Value"} fill="var(--country-series)" maxBarSize={40} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" formatter={(value) => value == null ? "" : formatMetricValue(Number(value), root)} style={{ fill: "var(--ink)", fontSize: 9 }} />
            </Bar>
          </BarChart> : <LineChart
            data={yearData}
            margin={{ top: 8, right: 24, left: 8, bottom: 20 }}
          >
            <Area type="monotone" dataKey="value" baseValue={yearTicks[0] ?? "dataMin"} fill="var(--country-series)" fillOpacity={0.24} stroke="none" tooltipType="none" isAnimationActive={false} />
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={10} height={40} minTickGap={24} interval="preserveStartEnd" padding={{ left: 8, right: 8 }} tick={{ fill: "var(--muted)", fontSize: 10 }} />
            <YAxis yAxisId="main" allowDataOverflow tickLine={false} axisLine={false} width={74} tickFormatter={(value) => formatMetricValue(Number(value), root)} ticks={yearTicks} domain={getNiceTickDomain(yearTicks)} tick={{ fill: "var(--muted)", fontSize: 10 }} />
            {laborTrendAxis && trendTicks.length > 0 && <YAxis yAxisId="trend" orientation="right" allowDataOverflow tickLine={false} axisLine={false} width={74} tickFormatter={(value) => formatMetricValue(Number(value), root)} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} tick={{ fill: "var(--muted)", fontSize: 10 }} />}
            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }} labelFormatter={(label) => `Date: ${formatChartDate(String(label), root?.meta.frequency, true)}`} formatter={(value) => [formatMetricValue(Number(value), root), "Published rate"]} content={root?.threeMonth?.history?.length && ["US", "UK", "EA"].includes(root.meta.region) ? ({ active, label, payload }) => { if (!active || !payload?.length) return null; const published = payload.find(entry => String(entry.dataKey) === "value")?.value; const average = payload.find(entry => String(entry.dataKey) === "trend")?.value; return <div className="inflation-paired-tooltip"><strong className="inflation-paired-tooltip-period">Date: {formatChartDate(String(label), root.meta.frequency, true)}</strong><div className="inflation-paired-tooltip-head"><span>Indicator</span><span>Published</span><span>{root.threeMonth?.label ?? "3-month average"}</span></div><div className="inflation-paired-tooltip-row"><span><i style={{ background: "var(--country-series)" }} />{root.meta.shortName ?? root.meta.name}</span><b>{published == null ? "—" : formatMetricValue(Number(published), root)}</b><b>{average == null ? "—" : formatMetricValue(Number(average), root)}</b></div></div>} : undefined} contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }} />
            {root?.threeMonth?.history?.length && ["US", "UK", "EA"].includes(root.meta.region) ? <Legend verticalAlign="top" align="left" height={24} iconType="line" formatter={(value) => laborTrendAxis ? value === "Published rate" ? "Published value · solid · left axis" : `${String(value)} · dotted · right axis` : value === "Published rate" ? "Published rate · solid" : `${String(value)} · dotted`} /> : null}
          <Line yAxisId="main" type="monotone" dataKey="value" name="Published rate" stroke="var(--country-series)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--country-series)", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          {["US", "UK", "EA"].includes(root?.meta.region ?? "") && root?.threeMonth?.history?.length ? <Line yAxisId={laborTrendAxis && trendTicks.length > 0 ? "trend" : "main"} type="monotone" dataKey="trend" name={root.threeMonth.label} stroke="var(--country-series)" strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} /> : null}
          </LineChart>}
        </ResponsiveContainer>; }}
        </HistoryChartViewport>
      </div>
    );
  }

  const isPercentagePointRate = root?.meta.id
    ? percentagePointIds.has(root.meta.id)
    : false;

  const valueForDate = (
    history: Array<{ date: string; value: number }>,
    date: string
  ) => {
    const exact = history.find(
      (point) =>
        point.date.slice(0, 10) === date
    );

    if (
      exact &&
      Number.isFinite(Number(exact.value))
    ) {
      return Number(exact.value);
    }

    const month = date.slice(0, 7);
    const sameMonth = history.find(
      (point) =>
        point.date.slice(0, 7) === month
    );

    return sameMonth &&
      Number.isFinite(Number(sameMonth.value))
      ? Number(sameMonth.value)
      : null;
  };

  const hasDedicatedYoY = Boolean(
    (retailYoyMetric || chartSpec.yoyMetricId) && yoyHistory.length
  );

  const hasDedicatedMoM = Boolean(
    (isUkPublishedRetail || chartSpec.momMetricId) && momHistory.length
  );

  const pairedTrendHistory = ["US", "UK", "EA"].includes(root?.meta.region ?? "") ? normalizeHistory(root?.threeMonth?.history ?? []) : [];

  const chartDates = new Set<string>();
  const ukComparisonMonths = new Set(isUkPublishedRetail
    ? normalizeHistory(comparisonMetric?.history ?? []).map(point => point.date.slice(0, 7))
    : []);
  if (isUkPublishedRetail) {
    retailPublishedPoints(sortedRootHistory, normalizeHistory(comparisonMetric?.history ?? [])).forEach(point => chartDates.add(point.date));
  }

  if (hasDedicatedYoY) {
    yoyHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  if (hasDedicatedMoM) {
    momHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  if (!chartDates.size) {
    sortedRootHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  pairedTrendHistory.forEach(point => chartDates.add(point.date.slice(0, 10)));

  const chartHistory = [...chartDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      let yoy: number | null =
        hasDedicatedYoY
          ? valueForDate(
              yoyHistory,
              date
            )
          : null;

      let mom: number | null =
        hasDedicatedMoM
          ? valueForDate(
              momHistory,
              date
            )
          : null;

      if (
        !hasDedicatedYoY ||
        !hasDedicatedMoM
      ) {
        const throughDate =
          sortedRootHistory.filter(
            (candidate) =>
              candidate.date.slice(0, 10) <= date
          );

        const rates = calculateRates(
          throughDate,
          root?.meta.transform,
          root?.meta.frequency,
          root?.meta.id
        );

        if (!hasDedicatedYoY) {
          yoy = UNDERLYING_INFLATION_METRIC_IDS.has(spec.metricId)
            ? throughDate.at(-1)?.value ?? null
            : rates.yoy;
        }

        if (!hasDedicatedMoM) {
          mom = UNDERLYING_INFLATION_METRIC_IDS.has(spec.metricId)
            ? getUnderlyingInflationPublishedRates(spec, Object.fromEntries(
                Object.entries(allMetrics).map(([id, payload]) => [id, payload?.history])
              ))?.mom ?? null
            : rates.mom;
        }
      }

      return {
        date,
        yoy,
        mom,
        trend: pairedTrendHistory.find(point => point.date.slice(0, 10) === date || point.date.slice(0, 7) === date.slice(0, 7))?.value ?? null,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.yoy ?? NaN) ||
        Number.isFinite(point.mom ?? NaN) || ukComparisonMonths.has(point.date.slice(0, 7))
    );
  const data = isRetailSalesMetric
    ? chartHistory
    : filterHistoryToTrailing12Months(chartHistory);

  const comparisonHistory = comparisonMetric
    ? normalizeHistory(comparisonMetric.history ?? []).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const comparisonYoyHistory = comparisonYoyMetric
    ? normalizeHistory(comparisonYoyMetric.history ?? []).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const comparisonByDate = new Map<string, { yoy: number | null; mom: number | null }>();
  if (comparisonMetric && isRetailSalesMetric) {
    for (const point of data) {
      const historyThroughDate = comparisonHistory.filter((item) => item.date.slice(0, 10) <= point.date.slice(0, 10));
      const rates = calculateRates(historyThroughDate, comparisonMetric.meta.transform, comparisonMetric.meta.frequency, comparisonMetric.meta.id);
      comparisonByDate.set(point.date.slice(0, 10), {
        yoy: comparisonYoyMetric ? valueForDate(comparisonYoyHistory, point.date) : rates.yoy,
        mom: isUkPublishedRetail ? valueForDate(comparisonHistory, point.date) : rates.mom,
      });
    }
  }
  const chartData = data.map((point) => {
    const comparison = comparisonByDate.get(point.date.slice(0, 10));
    return { ...point, comparisonYoy: comparison?.yoy ?? null, comparisonMom: comparison?.mom ?? null };
  });

  if (!data.length) {
    return (
      <div
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        No YoY / {secondLabel} data
      </div>
    );
  }

  const hasYoYData = data.some(
    (point) =>
      Number.isFinite(point.yoy ?? NaN)
  );

  const hasSecondData = chartData.some(
    (point) =>
      Number.isFinite(point.mom ?? NaN) || Number.isFinite(point.comparisonMom ?? NaN)
  );
  const showMomOnly = isRetailSalesMetric && retailMeasure === "mom";

  const formatValue = (
    value: number | null | undefined
  ) => {
    if (
      value == null ||
      !Number.isFinite(value)
    ) {
      return "—";
    }

    return `${
      value > 0 ? "+" : ""
    }${value.toFixed(1)}${
      isPercentagePointRate
        ? " pp"
        : "%"
    }`;
  };

  const formatTooltipDate = (date: string) =>
    formatChartDate(date, root?.meta.frequency, true);

  const renderChart = (
  series: "yoy" | "mom",
  label: string,
  stroke: string
) => (
  <div
    style={{
      width: "100%",
      height,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      border: "1px solid var(--line)",
      borderRadius: 10,
      padding: "8px 8px 0",
      overflow: "visible",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        flex: "0 0 auto",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text)",
        marginBottom: 2,
      }}
    >
      {label}
    </div>

    <div style={{ flex: "1 1 auto", minHeight: 0, width: "100%", overflow: "visible" }}>
      <HistoryChartViewport dates={chartData.map(point => point.date)} frequency={root?.meta.frequency} height={Math.max(160, height - 30)} label={`${label} history`}>
      {(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearData = showMomOnly ? isDefaultWindow ? filterHistoryToTrailing12Months(chartData) : filterHistoryByYearRange(chartData, fromYear, toYear) : chartDataForRange(chartData, fromYear, toYear, isDefaultWindow); const separateTrendAxis = root?.meta.region === "US" && series === "yoy"; const yearTicks = getNiceTicks(yearData.flatMap(point => [point[series], ...(series === "yoy" && !separateTrendAxis ? [point.trend] : []), comparisonMetric && isRetailSalesMetric ? point[series === "yoy" ? "comparisonYoy" : "comparisonMom"] : null]).filter((value): value is number => value != null && Number.isFinite(value)).concat(useBarChart ? [0] : []), 9, 0.01); const trendTicks = separateTrendAxis ? getNiceTicks(yearData.map(point => point.trend).filter((value): value is number => value != null && Number.isFinite(value)), 9, 0.01) : []; const trendAxisId = separateTrendAxis && trendTicks.length ? "trend" : "main"; const axisDecimals = Math.max(1, getTickPrecision(yearTicks)); return <ResponsiveContainer width={plotWidth} height="100%">
        {useBarChart ? <BarChart
          data={yearData}
          margin={{
            top: 4,
            right: 12,
            left: 4,
            bottom: 24,
          }}
        >
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />

          <XAxis
            dataKey="date"
            tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
            tickLine={false}
            axisLine={{
              stroke: "var(--muted)",
              strokeWidth: 1,
            }}
            tickMargin={10}
            height={44}
            minTickGap={24}
            interval="preserveStartEnd"
            padding={{
              left: 8,
              right: 8,
            }}
            tick={{
              fill: "var(--muted)",
              fontSize: 10,
            }}
          />

          <YAxis yAxisId="main" allowDataOverflow
            tickLine={false}
            axisLine={false}
            width={68}
            ticks={yearTicks}
            domain={getNiceTickDomain(yearTicks)}
            interval={0}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
            tickFormatter={value => `${Number(value).toFixed(axisDecimals)}${isPercentagePointRate ? " pp" : "%"}`}
          />
          {trendTicks.length > 0 && <YAxis yAxisId="trend" orientation="right" allowDataOverflow tickLine={false} axisLine={false} width={68} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} interval={0} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={value => `${Number(value).toFixed(Math.max(1, getTickPrecision(trendTicks)))}%`} />}
          <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} labelFormatter={(value) => `Date: ${formatTooltipDate(String(value))}`} formatter={(value, name) => [formatValue(Number(value)), String(name ?? label).replace(/\s*·\s*\d{4}$/, "")]} content={pairedTrendHistory.length && series === "yoy" ? ({ active, label: tooltipDate, payload }) => { if (!active || !payload?.length) return null; const published = payload.find(entry => String(entry.dataKey) === "yoy")?.value; const trend = payload.find(entry => String(entry.dataKey) === "trend")?.value; return <div className="inflation-paired-tooltip"><strong className="inflation-paired-tooltip-period">Date: {formatTooltipDate(String(tooltipDate))}</strong><div className="inflation-paired-tooltip-head"><span>Series</span><span>Published</span><span>{root?.threeMonth?.label ?? "3-month average"}</span></div><div className="inflation-paired-tooltip-row"><span><i style={{ background: "var(--country-series)" }} />{root?.meta.shortName ?? root?.meta.name ?? displayMetricTitle(spec, root)}</span><b>{published == null ? "—" : formatValue(Number(published))}</b><b>{trend == null ? "—" : formatValue(Number(trend))}</b></div></div>} : undefined} />
            <Bar dataKey={series} name={comparisonMetric && isRetailSalesMetric ? "Headline Retail Sales" : label} fill={comparisonMetric && isRetailSalesMetric ? "#478ab5" : series === "yoy" ? stroke : "var(--country-series-secondary, #478ab5)"} maxBarSize={comparisonMetric && isRetailSalesMetric ? 24 : 34} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey={series} position="top" formatter={(value) => value == null ? "" : formatValue(Number(value)).replace(/^\+/, "")} style={{ fill: "var(--ink)", fontSize: 8 }} />
          </Bar>
          {comparisonMetric && isRetailSalesMetric && <Bar dataKey={series === "yoy" ? "comparisonYoy" : "comparisonMom"} name={retailComparisonLabel} fill="#17634e" maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false}><LabelList dataKey={series === "yoy" ? "comparisonYoy" : "comparisonMom"} position="top" formatter={(value) => value == null ? "" : formatValue(Number(value)).replace(/^\+/, "")} style={{ fill: "var(--ink)", fontSize: 8 }} /></Bar>}
        </BarChart> : <LineChart
          data={yearData}
          margin={{ top: series === "yoy" && pairedTrendHistory.length ? 28 : 4, right: 12, left: 4, bottom: 20 }}
        >
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical />
          <XAxis dataKey="date" tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tickMargin={8} height={38} minTickGap={24} interval="preserveStartEnd" padding={{ left: 8, right: 8 }} tick={{ fill: "var(--muted)", fontSize: 10 }} />
          <YAxis yAxisId="main" allowDataOverflow tickLine={false} axisLine={false} width={68} tickFormatter={(value) => `${Number(value).toFixed(axisDecimals)}${isPercentagePointRate ? " pp" : "%"}`} ticks={yearTicks} domain={getNiceTickDomain(yearTicks)} interval={0} tick={{ fill: "var(--muted)", fontSize: 10 }} />
          {trendTicks.length > 0 && <YAxis yAxisId="trend" orientation="right" allowDataOverflow tickLine={false} axisLine={false} width={68} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} interval={0} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={value => `${Number(value).toFixed(Math.max(1, getTickPrecision(trendTicks)))}%`} />}
          <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} labelFormatter={(value) => `Date: ${formatTooltipDate(String(value))}`} contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)" }} formatter={(value, name) => [formatValue(Number(value)), String(name ?? label).replace(/\s*·\s*\d{4}$/, "")]} />
          {series === "yoy" && pairedTrendHistory.length > 0 && <Legend verticalAlign="top" align="left" height={22} iconType="line" wrapperStyle={{ fontSize: 10, color: "var(--muted)" }} />}
          <Area yAxisId="main" type="monotone" dataKey={series} baseValue={yearTicks[0] ?? "dataMin"} stroke="none" fill={stroke} fillOpacity={0.18} connectNulls={false} isAnimationActive={false} tooltipType="none" />
          <Line yAxisId="main" type="monotone" dataKey={series} name={label} stroke={stroke} strokeWidth={2.5} dot={animateTrace ? (point) => { const index = Number(point.index ?? 0); const delay = index * 1500 / Math.max(1, yearData.length - 1); const latest = index === yearData.length - 1; return <g key={`trace-${series}-${index}`}><circle cx={point.cx} cy={point.cy} r={latest ? 3.5 : 2.5} fill={stroke} opacity={latest ? 1 : 0}><animate attributeName="opacity" values={latest ? "0;1" : "0;1;0"} keyTimes={latest ? "0;1" : "0;0.25;1"} dur="220ms" begin={`${delay}ms`} fill="freeze" /></circle>{latest && <circle cx={point.cx} cy={point.cy} r="10" fill={stroke} opacity="0.18" />}</g>; } : { r: 3, fill: stroke, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={animateTrace} animationDuration={1500} animationEasing="ease-in-out" />
          {series === "yoy" && pairedTrendHistory.length > 0 && <Line yAxisId={trendAxisId} type="monotone" dataKey="trend" name={root?.threeMonth?.label ?? "3-month average"} stroke={stroke} strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
          {comparisonMetric && isRetailSalesMetric && <Line yAxisId="main" type="monotone" dataKey={series === "yoy" ? "comparisonYoy" : "comparisonMom"} name={retailComparisonLabel} stroke="#17634e" strokeWidth={2.5} dot={{ r: 3, fill: "#17634e", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
        </LineChart>}
      </ResponsiveContainer>; }}
      </HistoryChartViewport>
    </div>
  </div>
);

  return (
  <div style={{ width: "100%", minHeight: 0, display: "grid", gap: 10 }}>
    {isRetailSalesMetric && <div role="group" aria-label="Retail sales chart measure" style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
      {([...(["US", "UK"].includes(root?.meta.region ?? "") && root?.threeMonth?.history?.length ? ["paired" as const] : ["yoy" as const]), "mom"] as const).map((measure) => <button key={measure} type="button" aria-pressed={retailMeasure === measure} onClick={() => setRetailMeasure(measure)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "5px 12px", background: retailMeasure === measure ? "var(--country-series)" : "var(--panel)", color: retailMeasure === measure ? "white" : "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{measure === "paired" ? "YoY + " + retailThreeMonthLabel : measure === "mom" ? "MoM" : "YoY"}</button>)}
    </div>}
      {comparisonMetric && isRetailSalesMetric && <div aria-label="Retail sales chart legend" style={{ display: "flex", justifyContent: "flex-end", gap: 18, color: "var(--text)", fontSize: 12 }}><span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#478ab5", marginRight: 7 }} />Headline Retail Sales</span><span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#17634e", marginRight: 7 }} />{retailComparisonLabel}</span></div>}
    <div style={{
      width: "100%",
      height: "auto",
      minHeight: 0,
      display: "grid",
      gridTemplateColumns: isRetailSalesMetric || !(hasYoYData && hasSecondData) ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
      gridAutoRows: isExpectationMetric ? "300px" : `${height}px`,
      gap: 16,
      overflow: "visible",
      boxSizing: "border-box",
    }}>
      {hasYoYData && (!isRetailSalesMetric || retailMeasure === "yoy") && renderChart("yoy", `YoY · ${YEAR}`, "var(--country-series)")}
      {hasSecondData && (!isRetailSalesMetric || retailMeasure === "mom") && renderChart("mom", isRetailSalesMetric ? `${secondLabel} · Last 12 months` : `${secondLabel} · ${YEAR}`, "var(--country-series)")}
    </div>
  </div>
);
}


function MiniRateChart({
  spec,
  root,
  allMetrics,
}: {
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  if (root && isLaborChangeMetric(root.meta.id)) return <LaborChangeChart metric={root} compact />;

  const rootHistory = normalizeHistory(
    root?.history ?? []
  );

  const yoyHistory = spec.yoyMetricId
    ? normalizeHistory(
        allMetrics[spec.yoyMetricId]?.history ?? []
      )
    : [];

  const configuredMomHistory = spec.momMetricId
    ? normalizeHistory(
        allMetrics[spec.momMetricId]?.history ?? []
      )
    : [];

  const isUsHeadlineCpi =
    spec.id === "us-cpi-card" ||
    root?.meta.id === "us-cpi";

  const cpiMomHistory = isUsHeadlineCpi
    ? normalizeHistory(
        allMetrics["us-cpi-mom"]?.history ?? []
      )
    : [];

  const momHistory =
    isUsHeadlineCpi && cpiMomHistory.length
      ? cpiMomHistory
      : configuredMomHistory;

  const sortedRootHistory = [
    ...rootHistory,
  ].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (isQuarterlyGdpMetric(root?.meta.id)) {
    return <QuarterlyGdpChart metric={root} compact />;
  }

  if (root?.meta.id === "us-initial-claims") {
    return <ClaimsMiniCharts initial={root} continuing={allMetrics["us-continuing-claims"]} />;
  }

  // Expectation readings are published survey/market levels. Treating them
  // as generic index levels and calculating YoY/MoM rates creates misleading
  // synthetic changes, so the card sparkline shows the published series.
  if (spec.expectationGroup) {
    const data = filterHistoryToTrailing12Months(sortedRootHistory
      .map((point) => ({ date: point.date.slice(0, 10), value: Number(point.value) }))
      .filter((point) => Number.isFinite(point.value)));

    if (!data.length) return null;

    const seriesName = root?.meta.shortName || root?.meta.name || spec.title || "Expectation";
    return (
      <div className="macro-mini-chart" style={{ width: "100%", height: 70, minHeight: 0 }} aria-label={`${seriesName} published readings`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 3 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <Area type="monotone" dataKey="value" baseValue="dataMin" fill="var(--country-series)" fillOpacity={0.2} stroke="none" tooltipType="none" isAnimationActive={false} />
            <YAxis allowDataOverflow hide domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))} />
            <Line
              type="monotone"
              dataKey="value"
              name="expectation-level"
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 10, padding: "5px 7px" }}
              labelFormatter={(label) => formatChartDate(String(label), root?.meta.frequency, true)}
              formatter={(value) => [formatExpectationValue(root, Number(value)), seriesName]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const secondLabel =
    root?.meta.frequency === "weekly"
      ? "WoW"
      : root?.meta.id === "uk-unemployment" ||
          root?.meta.id === "uk-employment-rate" ||
          root?.meta.id === "uk-inactivity-rate"
        ? "QoQ"
        : root?.meta.frequency === "quarterly"
          ? "QoQ"
          : "MoM";

  /*
   * Net Exports is intentionally kept as its original
   * single-series level chart because it is a dollar-value
   * contribution rather than a YoY/MoM rate pair.
   */
  if (isUSNetExportsMetric(root)) {
    const data = filterHistoryToTrailing12Months(sortedRootHistory
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      ));

    if (!data.length) {
      return null;
    }

    return (
      <div
        className="macro-mini-chart"
        style={{
          width: "100%",
          height: 70,
          minHeight: 0,
        }}
        aria-label="Net Exports trend"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{ top: 5, right: 5, left: 5, bottom: 3 }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis allowDataOverflow
              hide
              domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))}
            />
            <Area type="monotone" dataKey="value" stroke="none" fill={`url(#mini-fill-${spec.id})`} fillOpacity={0.32} isAnimationActive={false} />

            <Line
              type="monotone"
              dataKey="value"
              name="Net Exports"
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
              cursor={{ stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 10,
                padding: "5px 7px",
              }}
              labelFormatter={(label) =>
                `Date: ${formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )}`
              }
              formatter={(value) => [
                formatUsNetExportsValue(
                  Number(value)
                ),
                "Net Exports",
              ]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /*
   * Latest/Prior metrics are single-series metrics. Keep exactly one
   * mini chart showing the published level/rate, instead of deriving
   * artificial YoY + MoM series from the raw level.
   */
  const kpis = getMetricKpis(root);
  const isPayrollLevel = root?.meta.id === "us-payrolls-level";
  const isLatestPriorMetric = isPayrollLevel || (
    kpis.leftLabel === "Latest" &&
    kpis.rightLabel === "Prior" &&
    kpis.showRight);

  if (isLatestPriorMetric) {
    const data = filterHistoryToTrailing12Months(sortedRootHistory
      .map((point, index, history) => ({
        date: point.date.slice(0, 10),
        value: isPayrollLevel
          ? index > 0 ? Number(point.value) - Number(history[index - 1].value) : NaN
          : Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      ));

    if (!data.length) {
      return null;
    }

    const chartLabel = isPayrollLevel ? "Monthly payroll change" :
      root?.meta.shortName ?? root?.meta.name ?? "Value";

    return (
      <div
        className="macro-mini-chart"
        style={{
          width: "100%",
          height: 70,
          minHeight: 0,
        }}
        aria-label={`${chartLabel} trend`}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 3,
            }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis allowDataOverflow
              hide
              domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))}
            />
            <Area type="monotone" dataKey="value" stroke="none" fill={`url(#mini-fill-${spec.id})`} fillOpacity={0.32} isAnimationActive={false} />

            <Line
              type="monotone"
              dataKey="value"
              name={chartLabel}
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
              cursor={{ stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 10,
                padding: "5px 7px",
              }}
              labelFormatter={(label) =>
                formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )
              }
              formatter={(value) => [
                isPayrollLevel
                  ? formatAbsoluteChangeValue(Number(value), root)
                  : formatMetricValue(Number(value), root),
                chartLabel,
              ]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const valueForDate = (
    history: Array<{ date: string; value: number }>,
    date: string
  ) => {
    const exact = history.find(
      (point) =>
        point.date.slice(0, 10) === date
    );

    if (
      exact &&
      Number.isFinite(Number(exact.value))
    ) {
      return Number(exact.value);
    }

    const month = date.slice(0, 7);
    const sameMonth = history.find(
      (point) =>
        point.date.slice(0, 7) === month
    );

    return sameMonth &&
      Number.isFinite(Number(sameMonth.value))
      ? Number(sameMonth.value)
      : null;
  };

  const hasDedicatedYoY = Boolean(
    spec.yoyMetricId && yoyHistory.length
  );

  const hasDedicatedMoM = Boolean(
    spec.momMetricId && momHistory.length
  );

  const chartDates = new Set<string>();

  if (hasDedicatedYoY) {
    yoyHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  if (hasDedicatedMoM) {
    momHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  if (!chartDates.size) {
    sortedRootHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      chartDates.add(date);
    });
  }

  const data = [...chartDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      let yoy: number | null =
        hasDedicatedYoY
          ? valueForDate(
              yoyHistory,
              date
            )
          : null;

      let mom: number | null =
        hasDedicatedMoM
          ? valueForDate(
              momHistory,
              date
            )
          : null;

      if (
        !hasDedicatedYoY ||
        !hasDedicatedMoM
      ) {
        const throughDate =
          sortedRootHistory.filter(
            (candidate) =>
              candidate.date.slice(0, 10) <= date
          );

        const rates = calculateRates(
          throughDate,
          root?.meta.transform,
          root?.meta.frequency,
          root?.meta.id
        );

        if (!hasDedicatedYoY) {
          yoy = rates.yoy;
        }

        if (!hasDedicatedMoM) {
          mom = rates.mom;
        }
      }

      return {
        date,
        yoy,
        mom,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.yoy ?? NaN) ||
        Number.isFinite(point.mom ?? NaN)
    );

  if (!data.length) {
    return null;
  }

  const hasYoYData = data.some(
    (point) =>
      Number.isFinite(point.yoy ?? NaN)
  );

  const hasSecondData = data.some(
    (point) =>
      Number.isFinite(point.mom ?? NaN)
  );

  const isPercentagePointRate = root?.meta.id
    ? percentagePointIds.has(root.meta.id)
    : false;

  const formatValue = (
    value: number | null | undefined
  ) => {
    if (
      value == null ||
      !Number.isFinite(value)
    ) {
      return "—";
    }

    return `${
      value > 0 ? "+" : ""
    }${value.toFixed(1)}${
      isPercentagePointRate
        ? " pp"
        : "%"
    }`;
  };

  const formatTooltipDate = (date: string) =>
    formatChartDate(date, root?.meta.frequency, true);

  const renderMiniChart = (
    series: "yoy" | "mom",
    label: string,
    stroke: string
  ) => (
    <div
      className="macro-spark-series"
      style={{
        minWidth: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="macro-spark-label">
        {label}
      </div>

      <div
        className="macro-spark-plot"
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 3,
            }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}-${series}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.23} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis allowDataOverflow
              hide
              domain={([min, max]: readonly [number, number]) => getNiceTickDomain(getNiceTicks([min, max]))}
            />
            <Area type="monotone" dataKey={series} stroke="none" fill={`url(#mini-fill-${spec.id}-${series})`} fillOpacity={0.32} isAnimationActive={false} />
            <XAxis
  dataKey="date"
  hide
/>

            <Line
              type="monotone"
              dataKey={series}
              name={label}
              stroke={stroke}
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
  cursor={{ stroke: "var(--country-series)", strokeWidth: 1, strokeDasharray: "4 3" }}
  contentStyle={{
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 10,
    padding: "6px 8px",
  }}
  labelStyle={{
    color: "var(--text)",
    fontWeight: 600,
    marginBottom: 3,
  }}
  itemStyle={{
    color: "var(--text)",
  }}
  labelFormatter={(label) =>
    formatTooltipDate(String(label))
  }
  formatter={(value) => [
    formatValue(Number(value)),
    label,
  ]}
/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div
      className="macro-mini-chart"
      style={{
        width: "100%",
        height: 70,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns:
          hasYoYData && hasSecondData
            ? "1fr 1fr"
            : "1fr",
        gap: 8,
      }}
      aria-label={`${root?.meta.shortName ?? root?.meta.name ?? "Indicator"} trend`}
    >
      {hasYoYData &&
        renderMiniChart(
          "yoy",
          "YoY",
          "var(--country-series)"
        )}

      {hasSecondData &&
        renderMiniChart(
          "mom",
          secondLabel,
          "var(--country-series)"
        )}
    </div>
  );
}


function changeColor(value: number | null | undefined, invert = false) {
  if (value == null || value === 0) return "text-[var(--muted)]";
  const good = invert ? value < 0 : value > 0;
  return good ? "text-[var(--up)]" : "text-[var(--down)]";
}

function pct(v: number | null | undefined) {
  return v == null || !Number.isFinite(v)
    ? "—"
    : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pp(v: number | null | undefined) {
  return v == null || !Number.isFinite(v)
    ? "—"
    : `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;
}
function getDisplayMode(
  metricId: string | undefined
):
  | "rate"
  | "level"
  | "published-growth"
  | "absolute-change"
  | "normal" {
  if (!metricId) return "normal";

  if (isQuarterlyGdpMetric(metricId)) return "published-growth";

  if (
    metricId === "us-atlanta-wage" ||
    metricId === "us-unemployment" ||
    metricId === "us-u6" ||
    metricId === "us-participation" ||
    metricId === "us-employment-population" ||
    metricId === "us-long-term-unemployed" ||
    metricId === "us-ahe" ||
    metricId === "us-ahe-mom" ||
    metricId === "uk-unemployment" ||
    metricId === "uk-employment-rate" ||
    metricId === "uk-inactivity-rate" ||
    metricId === "uk-vacancy-rate" ||
    metricId === "ea-unemployment" ||
    metricId === "ea-youth-unemployment" ||
    metricId === "ea-employment-rate" ||
    metricId === "ea-inactivity" ||
    metricId === "ea-long-term-unemployment" ||
    metricId === "ea-job-vacancies"
  ) {
    return "rate";
  }

  if (
    metricId === "uk-inflation-comp-1y" ||
    metricId === "uk-inflation-comp-5y5y"
  ) {
    return "rate";
  }

  if (
    metricId === "us-jolts-openings" ||
    metricId === "us-unemployed-persons" ||
    metricId === "us-civilian-labor-force" ||
    metricId === "us-not-in-labor-force" ||
    metricId === "us-private-payrolls" ||
    metricId === "us-government-payrolls" ||
    metricId === "us-jolts-hires-level" ||
    metricId === "us-jolts-quits-level" ||
    metricId === "us-jolts-layoffs-level" ||
    metricId === "us-jolts-total-separations" ||
    metricId === "ea-unemployed-persons" ||
    metricId === "ea-youth-unemployed-persons" ||
    metricId === "uk-unemployed-persons" ||
    metricId === "uk-long-term-unemployed" ||
    metricId === "uk-inactive-persons" ||
    metricId === "uk-employee-jobs" ||
    metricId === "ea-vacant-posts" ||
    metricId === "uk-employment-level" ||
    metricId === "uk-vacancies" ||
    metricId === "uk-payrolled-employees-level" ||
    metricId === "uk-inactivity-student" ||
    metricId === "uk-inactivity-family" ||
    metricId === "uk-inactivity-temporary-sick" ||
    metricId === "uk-inactivity-long-term-sick" ||
    metricId === "uk-inactivity-discouraged" ||
    metricId === "uk-inactivity-retired" ||
    metricId === "uk-inactivity-other" ||
    metricId === "us-payrolls-level"
  ) {
    return "level";
  }

  if (
    metricId === "ea-vacancy-change" ||
    metricId === "ea-employment-change" ||
    metricId === "ea-inactivity-change"
  ) {
    return "absolute-change";
  }

  if (
    metricId === "uk-awe-total-yoy" ||
    metricId === "uk-awe-regular-yoy" ||
    metricId === "uk-awe-real-total-yoy" ||
    metricId === "uk-awe-real-regular-yoy" ||
    metricId === "uk-payrolled-employees-annual-change" ||
    metricId === "ea-employment-yoy" ||
    metricId === "ea-employment-qoq" ||
    metricId === "ea-wage-growth" ||
    metricId === "ea-wage-growth-qoq"
  ) {
    return "published-growth";
  }

  if (
    metricId === "uk-employment-change" ||
    metricId === "uk-inactivity-change" ||
    metricId === "uk-vacancy-change" ||
    metricId === "us-nfp"
  ) {
    return "absolute-change";
  }

  if (
    metricId === "us-initial-claims" ||
    metricId === "us-continuing-claims"
  ) {
    return "level";
  }

  return "normal";
}

function formatUsNetExportsValue(
  value: number | null | undefined
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);

  return `${sign}$${absolute.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}B`;
}

function annualizedToQuarterlyRate(value: number) {
  if (!Number.isFinite(value) || value <= -100) {
    return null;
  }

  return (
    Math.pow(1 + value / 100, 1 / 4) - 1
  ) * 100;
}

function formatMetricValue(
  value: number | null | undefined,
  metric: DetailPayload | undefined
) {
  const id = metric?.meta.id;
  if (
    (id === "ea-vacant-posts" || id === "ea-vacancy-change") &&
    (value == null || !Number.isFinite(value))
  ) {
    return "Not published for Euro Area aggregate";
  }
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  if (id === "us-initial-claims" || id === "us-continuing-claims") {
    return formatClaimsCount(value);
  }

  const mode = getDisplayMode(id);
  const unit = metric?.meta.unit?.toLowerCase() ?? "";
  if (isUSNetExportsMetric(metric)) {
    return formatUsNetExportsValue(value);
  }

  if (id === "uk-gdp-mom") {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  }
if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

  if (mode === "rate" || mode === "published-growth") {
    return `${value.toFixed(1)}%`;
  }

  if (mode === "absolute-change") {
    if (unit.includes("post")) {
      const abs = Math.abs(value);
      const sign = value > 0 ? "+" : value < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M posts`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K posts`;
      return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
    }

    if (unit.includes("thousand")) {
      return `${
        value > 0 ? "+" : ""
      }${Math.round(value)}K`;
    }

    return value.toLocaleString("en-US");
  }

  if (mode === "level") {
    if (["usd_billions", "gbp_millions", "eur_millions"].includes(unit)) {
      return formatEconomicLevel(value, unit);
    }

    if (unit.includes("post")) {
      const abs = Math.abs(value);
      const sign = value < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M posts`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K posts`;
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
    }

    if (unit.includes("thousand")) {
      if (Math.abs(value) >= 1000) {
        return `${(value / 1000).toFixed(1)}M`;
      }

      return `${Math.round(value)}K`;
    }

    return value.toLocaleString("en-US");
  }

  if (metric?.meta.category === "jobs" && unit.includes("percent")) {
    return `${value.toFixed(1)}%`;
  }

  if (unit.includes("dollar")) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }

  if (["usd_billions", "gbp_millions", "eur_millions"].includes(unit)) {
    return formatEconomicLevel(value, unit);
  }

  if (unit.includes("hour")) {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hrs`;
  }

  return value.toLocaleString("en-US");
}

function formatAbsoluteChangeValue(value: number | null | undefined, metric: DetailPayload | undefined) {
  if (metric && isLaborChangeMetric(metric.meta.id)) return formatLaborChange(value, metric.meta);
  if (value == null || !Number.isFinite(value)) return "—";
  const unit = metric?.meta.unit?.toLowerCase() ?? "";
  const sign = value > 0 ? "+" : "";
  if (unit.includes("post")) {
    const abs = Math.abs(value);
    const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M posts`;
    if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K posts`;
    return `${prefix}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
  }
  if (unit.includes("thousand")) return `${sign}${Math.round(value)}K`;
  return `${sign}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

const percentagePointIds = new Set([
  "us-unemployment",
  "us-long-term-unemployed",
  "us-participation",
  "uk-unemployment",
  "uk-employment-rate",
  "uk-inactivity-rate",
  "ea-unemployment",
  "ea-youth-unemployment",
  "ea-long-term-unemployment",
  "ea-inactivity",
  "ea-job-vacancies",
]);

const UK_GROWTH_MONTHLY_MOM_IDS = new Set([
  "uk-gdp-mom",
]);

const UK_GROWTH_NET_TRADE_PP_IDS = new Set([
  "uk-net-trade-qoq",
  "uk-net-trade-yoy",
]);
const US_GROWTH_NET_EXPORTS_PP_IDS = new Set([
  "us-real-net-exports",
]);

function isUSNetExportsMetric(
  metric: DetailPayload | undefined
) {
  const id = metric?.meta.id?.toLowerCase() ?? "";
  const name = (
    `${metric?.meta.shortName ?? ""} ${
      metric?.meta.name ?? ""
    }`
  ).toLowerCase();

  return (
    US_GROWTH_NET_EXPORTS_PP_IDS.has(id) ||
    name.includes("net exports")
  );
}
function isPublishedExpectationMetric(metric: DetailPayload | undefined) {
  return metric?.meta.subcategory?.toLowerCase().startsWith("expectations_") ?? false;
}

function getMetricKpis(
  metric: DetailPayload | undefined
) {
  if (!metric) {
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: null,
      rightLabel: "MoM",
      rightValue: null,
      showRight: true,
    };
  }

  const id = metric.meta.id;
  const mode = getDisplayMode(id);

  if (isPublishedExpectationMetric(metric)) {
    const history = getPublishedExpectationReadingsAsOf(metric.history ?? []);
    return {
      mode: "rate" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  if (isQuarterlyGdpMetric(id)) {
    const { latest, prior } = latestQuarterPair(metric.history ?? []);
    return {
      mode: "published-growth" as const,
      leftLabel: latest ? `Latest (${latest.quarter})` : "Latest quarter",
      leftValue: latest?.value ?? null,
      rightLabel: prior ? `Prior (${prior.quarter})` : "Prior quarter",
      rightValue: prior?.value ?? null,
      showRight: true,
    };
  }

  // US Labor Force Participation is a published rate level.
  if (id === "us-participation") {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode: "rate" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  // US JOLTS Job Openings is a level series in thousands, displayed in M.
  if (id === "us-jolts-openings") {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode: "level" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  if (UK_GROWTH_MONTHLY_MOM_IDS.has(id)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
  mode: "level" as const,
  leftLabel: "Latest",
  leftValue:
    history.at(-1)?.value ?? null,
  rightLabel: "Prior",
  rightValue:
    history.at(-2)?.value ?? null,
  showRight: true,
};
  }
  // US Net Exports is a level series, not a YoY/MoM growth rate.
  if (isUSNetExportsMetric(metric)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "level" as const,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  if (mode === "published-growth") {
    return {
      mode,
      leftLabel: "YoY",
      leftValue:
        metric.history?.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (
    mode === "rate" ||
    mode === "level" ||
    mode === "absolute-change"
  ) {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  const rates = calculateRates(
    metric.history,
    metric.meta.transform,
    metric.meta.frequency,
    metric.meta.id
  );

  return {
    mode: "normal" as const,
    leftLabel: "YoY",
    leftValue: rates.yoy,
    rightLabel: rates.secondLabel,
    rightValue: rates.mom,
    showRight: true,
  };
}

function calculateCompoundedYoY(
  history: Array<{ date: string; value: number }>
): number | null {
  if (history.length < 12) return null;

  const latest = history[history.length - 1];

  if (!latest?.date) return null;

  const latestMonth = latest.date.slice(0, 7);

  let growthFactor = 1;

  for (let i = 0; i < 12; i++) {
    const d = new Date(
      `${latestMonth}-01T00:00:00Z`
    );

    d.setUTCMonth(
      d.getUTCMonth() - i
    );

    const targetMonth = d
      .toISOString()
      .slice(0, 7);

    const point = history.find(
      (p) => p.date.slice(0, 7) === targetMonth
    );

    if (!point || !Number.isFinite(point.value)) {
      return null;
    }

    growthFactor *=
      1 + point.value / 100;
  }

  return (growthFactor - 1) * 100;
}
function normalizeHistory(
  history: Array<{
    date: string;
    value: number;
  }> = []
) {
  return history
    .map((point) => ({
      date: String(point.date).slice(0, 10),
      value: Number(point.value),
    }))
    .filter(
      (point) =>
        point.date &&
        Number.isFinite(point.value)
    )
    .sort((a, b) =>
      a.date.localeCompare(b.date)
    );
}

function getLatestPeriodDate(
  metric: DetailPayload | undefined
) {
  if (!metric) return null;

  if (isPublishedExpectationMetric(metric)) {
    return getPublishedExpectationReadingsAsOf(metric.history ?? []).at(-1)?.date ?? null;
  }

  const history = normalizeHistory(
    metric.history ?? []
  );

  // Prefer the latest observation from the current dashboard year.
  // This prevents stale/malformed historical tail records from
  // becoming the displayed "Latest period".
  const currentYearLatest = history
    .filter((point) =>
      point.date.startsWith(String(YEAR))
    )
    .at(-1)?.date;

  if (currentYearLatest) {
    return currentYearLatest;
  }

  const metaLatest = metric.meta.latest?.date
    ? String(metric.meta.latest.date).slice(0, 10)
    : null;

  if (metaLatest) {
    return metaLatest;
  }

  return history.at(-1)?.date ?? null;
}
function calculateRates(
  history: Array<{ date: string; value: number }>,
  transform?: string,
  frequency?: string,
  metricId?: string
) {
    history = normalizeHistory(history);
  const isPercentagePointRate = metricId
    ? percentagePointIds.has(metricId)
    : false;

  const secondLabel =
    metricId === "uk-unemployment" ||
    metricId === "uk-employment-rate" ||
    metricId === "uk-inactivity-rate"
      ? "QoQ"
      : frequency === "quarterly"
        ? "QoQ"
        : "MoM";

  if (!history.length) {
    return {
      yoy: null,
      mom: null,
      secondLabel,
    };
  }

  // Change in Private Inventories is not a normal level series.
  // Do not calculate ratio-based percentage changes.
  if (metricId === "us-real-inventories") {
    return {
      yoy: null,
      mom: null,
      secondLabel,
    };
  }

  const latest = history[history.length - 1];

  // ONS J5EC (headline) and J45W (ex-fuel) are published month-on-month growth rates.
  // Use the published rate directly; do not calculate the change between months.
  if (metricId === "uk-retail-sales-total-ex-fuel" || metricId === "uk-retail-sales-mom" || metricId === "uk-retail-sales-ex-fuel") {
    return {
      yoy: null,
      mom: latest.value,
      secondLabel: "MoM",
    };
  }

  if (isPercentagePointRate) {
    const prior = history[history.length - 2];

    const latestTime = new Date(
      `${latest.date.slice(0, 10)}T00:00:00Z`
    ).getTime();

    const targetYearAgo =
      latestTime - 365.25 * 24 * 60 * 60 * 1000;

    const priorYear = history
      .filter((p) => {
        const t = new Date(
          `${p.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        return (
          t <= targetYearAgo + 14 * 24 * 60 * 60 * 1000 &&
          t >= targetYearAgo - 14 * 24 * 60 * 60 * 1000
        );
      })
      .sort((a, b) => {
        const ta = new Date(
          `${a.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        const tb = new Date(
          `${b.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        return (
          Math.abs(ta - targetYearAgo) -
          Math.abs(tb - targetYearAgo)
        );
      })[0];

    return {
      yoy: priorYear
        ? latest.value - priorYear.value
        : null,
      mom: prior
        ? latest.value - prior.value
        : null,
      secondLabel,
    };
  }

  // ---------------------------------------------------------
  // BEA REAL GDP
  // T10101:1 is already "percent change from preceding
  // quarter", published at an annual rate.
  //
  // Convert the quarterly annualized rates into quarter-to-
  // quarter growth factors, then compound the latest four
  // quarters to get the YoY rate.
  // ---------------------------------------------------------
  if (metricId === "us-gdp-real") {
    const quarterlyRates = history
      .slice(-5)
      .map((p) => ({
        date: p.date,
        value: Number(p.value),
      }))
      .filter((p) => Number.isFinite(p.value));

    const qoq = annualizedToQuarterlyRate(
      latest.value
    );

    let yoy: number | null = null;

    if (quarterlyRates.length >= 5) {
      const lastFour = quarterlyRates.slice(-4);

      const growthFactor = lastFour.reduce(
        (factor, p) =>
          factor * Math.pow(1 + p.value / 100, 1 / 4),
        1
      );

      yoy = (growthFactor - 1) * 100;
    }

    return {
      yoy,
      mom: qoq,
      secondLabel: "QoQ",
    };
  }

  // ---------------------------------------------------------
  // Published rate series
  //
  // If the source itself publishes a percentage rate, use
  // that value directly for the displayed period.
  // ---------------------------------------------------------
  if (transform === "published_rate") {
    const latest = history[history.length - 1]?.value ?? null;

    if (metricId === "ea-wage-growth") {
      return {
        yoy: latest,
        mom: null,
        secondLabel: "QoQ",
      };
    }

    if (metricId?.includes("yoy")) {
      return {
        yoy: latest,
        mom: null,
        secondLabel: "MoM",
      };
    }

    if (metricId?.includes("mom")) {
      return {
        yoy: null,
        mom: latest,
        secondLabel: "MoM",
      };
    }

    if (metricId?.includes("qoq")) {
      return {
        yoy: null,
        mom: latest,
        secondLabel: "QoQ",
      };
    }

    // Published rate with no explicit yoy/mom/qoq suffix.
    // Calculate percentage-point changes for rate series.
    const periodsPerYear =
      frequency === "quarterly" ? 4 : 12;

    const priorYearIndex =
      history.length - 1 - periodsPerYear;

    const priorPeriodIndex =
      history.length - 2;

    const priorYear =
      priorYearIndex >= 0
        ? history[priorYearIndex]?.value ?? null
        : null;

    const priorPeriod =
      priorPeriodIndex >= 0
        ? history[priorPeriodIndex]?.value ?? null
        : null;

    return {
      yoy:
        latest != null && priorYear != null
          ? latest - priorYear
          : null,

      mom:
        latest != null && priorPeriod != null
          ? latest - priorPeriod
          : null,

      secondLabel:
        frequency === "quarterly" ? "QoQ" : "MoM",
    };
  }

  const prior = history[history.length - 2];

  // Find the closest observation one year earlier rather than
  // requiring an exact date. This matters especially for weekly
  // series such as jobless claims.
  const latestTime = new Date(
    `${latest.date.slice(0, 10)}T00:00:00Z`
  ).getTime();

  const targetYearAgo =
    latestTime - 365.25 * 24 * 60 * 60 * 1000;

  const priorYear = history
    .filter((p) => {
      const t = new Date(
        `${p.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      return (
        t <= targetYearAgo + 14 * 24 * 60 * 60 * 1000 &&
        t >= targetYearAgo - 14 * 24 * 60 * 60 * 1000
      );
    })
    .sort((a, b) => {
      const ta = new Date(
        `${a.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      const tb = new Date(
        `${b.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      return (
        Math.abs(ta - targetYearAgo) -
        Math.abs(tb - targetYearAgo)
      );
    })[0];

  const levelLike =
    transform === "level" ||
    transform === "index";

  const yoy =
  levelLike &&
  priorYear &&
  priorYear.value !== 0
    ? ((latest.value / priorYear.value) - 1) * 100
    : transform === "pct_change_yoy"
      ? latest.value
      : transform === "pct_change_mom" &&
          frequency === "monthly"
        ? calculateCompoundedYoY(history)
        : null;

  const mom =
  levelLike &&
  prior &&
  prior.value !== 0
    ? ((latest.value / prior.value) - 1) * 100
    : transform === "pct_change_mom" ||
        transform === "published_rate" ||
        transform === "pct_change"
      ? latest.value
      : null;

  return {
    yoy,
    mom,
    secondLabel,
  };
}
function formatAbsoluteValue(
  value: number | null | undefined,
  unit?: string
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  const normalizedUnit = unit?.toLowerCase() ?? "";

  if (normalizedUnit.includes("thousand")) {
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}M`;
    }

    return `${Math.round(value)}K`;
  }

  if (normalizedUnit === "number") {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }

    if (Math.abs(value) >= 1000) {
      return `${Math.round(value / 1000)}K`;
    }

    return `${Math.round(value)}`;
  }

  return value.toFixed(1);
}
function shiftPeriod(date: string, deltaMonths: number) {
  const d = new Date(
    `${date.slice(0, 10)}T00:00:00Z`
  );

  if (Number.isNaN(d.getTime())) return "";

  d.setUTCMonth(d.getUTCMonth() + deltaMonths);

  return (
    d.toISOString().slice(0, 7) +
    (date.length > 7 ? "-01" : "")
  );
}

function labelForMetric(m: Metric) {
  return m.shortName || m.name;
}

function findNode(
  spec: IndicatorSpec,
  id: string
): UiNode | null {
  const walk = (nodes?: UiNode[]): UiNode | null => {
    for (const node of nodes ?? []) {
      if (node.metricId === id || node.id === id) {
        return node;
      }

      const found = walk(node.children);

      if (found) return found;
    }

    return null;
  };

  return walk(spec.components);
}

function ratesForSpec(
  spec: IndicatorSpec,
  metrics: Record<string, DetailPayload | undefined>
) {
  const rateSpec = (spec.metricId.startsWith("uk-ppi-") || spec.metricId.startsWith("ea-ppi-")) && spec.metricId.endsWith("-yoy")
    ? {
        ...spec,
        yoyMetricId: spec.yoyMetricId ?? spec.metricId,
        momMetricId: spec.momMetricId ?? spec.metricId.replace(/-yoy$/, "-mom"),
      }
    : spec;
  const root = metrics[rateSpec.metricId];
const isUsHeadlineCpi =
  spec.id === "us-cpi-card" ||
  spec.metricId === "us-cpi";
  const base = root
    ? calculateRates(
        root.history,
        root.meta.transform,
        root.meta.frequency,
        root.meta.id
      )
    : {
        yoy: null,
        mom: null,
        secondLabel: "MoM",
      };

  const yoyHistory = rateSpec.yoyMetricId
  ? normalizeHistory(
      metrics[rateSpec.yoyMetricId]?.history ?? []
    )
  : [];

const configuredMomHistory = rateSpec.momMetricId
  ? normalizeHistory(
      metrics[rateSpec.momMetricId]?.history ?? []
    )
  : [];

const cpiMomHistory = isUsHeadlineCpi
  ? normalizeHistory(
      metrics["us-cpi-mom"]?.history ?? []
    )
  : [];

const momHistory =
  isUsHeadlineCpi && cpiMomHistory.length
    ? cpiMomHistory
    : configuredMomHistory;

const yoyMetric = rateSpec.yoyMetricId
  ? metrics[rateSpec.yoyMetricId]
  : undefined;

const isUnderlyingPublishedInflation = UNDERLYING_INFLATION_METRIC_IDS.has(spec.metricId);
const publishedUnderlyingRates = isUnderlyingPublishedInflation
  ? getUnderlyingInflationPublishedRates(spec, Object.fromEntries(
      Object.entries(metrics).map(([id, payload]) => [id, payload?.history])
    ))
  : null;
const yoy = publishedUnderlyingRates
  ? publishedUnderlyingRates.yoy
  : isUnderlyingPublishedInflation
  ? yoyHistory.at(-1)?.value ?? null
  : yoyHistory.length
  ? yoyMetric?.meta.transform === "level"
    ? calculateRates(
        yoyHistory,
        yoyMetric.meta.transform,
        yoyMetric.meta.frequency,
        yoyMetric.meta.id
      ).yoy
    : yoyHistory[yoyHistory.length - 1].value
  : base.yoy;

const cpiMomLatest = isUsHeadlineCpi
  ? metrics["us-cpi-mom"]?.meta.latest?.value ?? null
  : null;

const mom = publishedUnderlyingRates
  ? publishedUnderlyingRates.mom
  : isUnderlyingPublishedInflation
  ? momHistory.at(-1)?.value ?? null
  : isUsHeadlineCpi
  ? cpiMomLatest ??
    (momHistory.length
      ? momHistory[momHistory.length - 1].value
      : base.mom)
  : momHistory.length
    ? momHistory[momHistory.length - 1].value
    : base.mom;

  const secondLabel =
    root?.meta.frequency === "quarterly"
      ? "QoQ"
      : "MoM";

  return {
    yoy,
    mom,
    secondLabel,
  };
}
function getCardKpis(
  spec: IndicatorSpec,
  metric: DetailPayload | undefined,
  allMetrics: Record<string, DetailPayload | undefined>,
  surface: "front" | "detail" = "detail"
) {
  if (!metric) {
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: null,
      rightLabel: "MoM",
      rightValue: null,
      showRight: true,
    };
  }

  const id = metric.meta.id;

  // Expectation series are published rate levels for every country. Compare
  // the latest two observations directly instead of deriving change rates.
  if (isPublishedExpectationMetric(metric)) {
    const history = getPublishedExpectationReadingsAsOf(metric.history ?? []);
    return {
      mode: "level" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  // PPI detail cards use ONS-published YoY and MoM series. Route them through
  // the paired measure lookup explicitly so display-mode classification for
  // an individual series cannot hide the monthly value.
  if ((id.startsWith("uk-ppi-") || id.startsWith("ea-ppi-")) && id.endsWith("-yoy")) {
    const rates = ratesForSpec(spec, { ...allMetrics, [spec.metricId]: metric });
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: rates.yoy,
      rightLabel: "MoM",
      rightValue: rates.mom,
      showRight: true,
    };
  }

  if (spec.id === "uk-wages-card") {
    const rates = ratesForSpec(spec, { ...allMetrics, [spec.metricId]: metric });
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: rates.yoy,
      rightLabel: "MoM",
      rightValue: rates.mom,
      showRight: true,
    };
  }

  if (isQuarterlyGdpMetric(id)) {
    return getMetricKpis(metric);
  }

  const changeKpis = surface === "front" ? laborChangeKpis(id, metric.history ?? []) : laborPublishedKpis(id, metric.history ?? []);
  if (changeKpis) return changeKpis;

  // UK monthly GDP: show only the published MoM value.
  if (UK_GROWTH_MONTHLY_MOM_IDS.has(id)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  // UK net-trade contribution is a percentage-point contribution,
  // not a normal YoY/MoM growth rate.
  if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "net-trade-pp" as const,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }
if (isUSNetExportsMetric(metric)) {
  const history = normalizeHistory(
    metric.history ?? []
  );

  return {
    mode: "level",
    leftLabel: "Latest",
    leftValue: history.at(-1)?.value ?? null,
    rightLabel: "Prior",
    rightValue: history.at(-2)?.value ?? null,
    showRight: true,
  };
}
  // Retail Sales: front card shows MoM only;
  // opened detail card shows both YoY and MoM.
  if (
    (
      id === "uk-retail-sales-total-ex-fuel" ||
      id === "us-retail-sales-total"
    ) &&
    surface === "front"
  ) {
    const rates = ratesForSpec(spec, {
      ...allMetrics,
      [spec.metricId]: metric,
    });

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue: rates.mom,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (isPublishedExpectationMetric(metric) || getDisplayMode(id) !== "normal") {
    return getMetricKpis(metric);
  }

  const rates = ratesForSpec(spec, {
    ...allMetrics,
    [spec.metricId]: metric,
  });

  return {
    mode: "normal" as const,
    leftLabel: "YoY",
    leftValue: rates.yoy,
    rightLabel: rates.secondLabel,
    rightValue: rates.mom,
    showRight: true,
  };
}

function ExpectationMetricPreview({
  spec,
  metrics,
}: {
  spec: IndicatorSpec;
  metrics: Record<string, DetailPayload | undefined>;
}) {
  const entries: UiNode[] = [];
  const collect = (nodes: UiNode[] = []) => {
    nodes.forEach((node) => {
      if (node.metricId) entries.push(node);
      if (node.children?.length) collect(node.children);
    });
  };
  collect(spec.components);

  return (
    <div className="expectation-metric-preview" aria-label="Current expectation readings">
      <span className="expectation-preview-heading">Current readings</span>
      <div className="expectation-preview-list">
        {entries.map((entry) => {
          const payload = entry.metricId ? metrics[entry.metricId] : undefined;
          const value = payload?.history?.at(-1)?.value;
          return (
            <div className="expectation-preview-item" key={entry.id} title={entry.label}>
              <span>{entry.label}</span>
              <strong>{formatExpectationValue(payload, value)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function MetricBadge({
  importance,
}: {
  importance?: string;
}) {
  const tone =
    importance === "critical"
      ? "badge-critical"
      : importance === "high"
        ? "badge-high"
        : importance === "medium"
          ? "badge-medium"
          : "badge-low";

  return (
    <span className={clsx("macro-badge", tone)}>
      {importance || "supporting"}
    </span>
  );
}

function ComponentPreview({
  nodes,
  metrics,
}: {
  nodes?: UiNode[];
  metrics: Record<string, DetailPayload | undefined>;
}) {
  const flat: UiNode[] = [];

  const walk = (xs: UiNode[]) =>
    xs.forEach((x) => {
      if (x.metricId) {
        flat.push(x);
      } else if (x.children) {
        const first = x.children.find(
          (c) => c.metricId
        );

        if (first?.metricId) {
          flat.push(first);
        }
      }
    });

  walk(nodes ?? []);

  return (
    <div className="component-preview">
      <div className="component-title">
        Key Components
      </div>

      {flat.slice(0, 4).map((node) => {
        const d = node.metricId
          ? metrics[node.metricId]
          : undefined;

        const isAbsoluteChange =
          d?.meta.id === "uk-employment-change";

        const rates =
          d && !isAbsoluteChange
            ? calculateRates(
                d.history,
                d.meta.transform,
                d.meta.frequency,
                d.meta.id
              )
            : null;

        const latestValue =
          d?.history?.at(-1)?.value ?? null;
const displayedMom =
  rates?.mom ??
  (d?.meta.transform === "pct_change_mom"
    ? latestValue
    : null);
        return (
          <div
            className="component-row"
            key={node.id}
          >
            <span>{node.label}</span>

            <span className="component-values">
              {isAbsoluteChange ? (
                <>
                  <b className={changeColor(latestValue)}>
                    {latestValue == null
                      ? "—"
                      : `${
                          latestValue > 0 ? "+" : ""
                        }${latestValue.toFixed(1)}k`}
                  </b>

                  <i>—</i>
                </>
              ) : (
                <>
                  <b>
                    {rates
                      ? percentagePointIds.has(
                          node.metricId ?? ""
                        )
                        ? pp(rates.yoy)
                        : pct(rates.yoy)
                      : "—"}
                  </b>

                  <i
                    className={changeColor(
                      rates?.mom
                    )}
                  >
                    {rates
                      ? percentagePointIds.has(
                          node.metricId ?? ""
                        )
                        ? pp(rates.mom)
                        : pct(rates.mom)
                      : "—"}
                  </i>
                </>
              )}
            </span>
          </div>
        );
      })}

      {flat.length > 4 && (
        <div className="component-more">
          + {flat.length - 4} more components
        </div>
      )}
    </div>
  );
}
function IndicatorCard({
  spec,
  metric,
  componentMetrics,
  groupLabel,
  highlighted = false,
  onOpen,
}: {
  spec: IndicatorSpec;
  metric: DetailPayload | undefined;
  componentMetrics: Record<
    string,
    DetailPayload | undefined
  >;
  groupLabel?: string;
  highlighted?: boolean;
  onOpen: () => void;
}) {
  const m = metric?.meta;
  const isUSClaimsCard = spec.id === "us-claims-card";

  const cardKpis = getCardKpis(
    spec,
    metric,
    componentMetrics,
    "front"
  );

  const invert =
    m?.subcategory?.includes("unemployment") ||
    m?.subcategory?.includes("claims") ||
    m?.id?.includes("unemployment") ||
    m?.id?.includes("claims");

  return (
    <article
      className={clsx("macro-card group", highlighted && "is-release-highlighted")}
      data-released-highlight={highlighted ? "true" : undefined}
      onClick={onOpen}
    >
      <div className="macro-card-head">
        <div className="min-w-0">
          <div className="eyebrow">
            {m?.region} · {groupLabel ?? m?.category}
          </div>

          <h3>{displayMetricTitle(spec, metric)}</h3>
        </div>

        <MetricBadge importance={m?.importance} />
      </div>

      {spec.expectationGroup ? (
        <ExpectationMetricPreview spec={spec} metrics={componentMetrics} />
      ) : isUSClaimsCard ? (
        <div className="macro-values" aria-label="Latest jobless claims counts">
          {[
            { id: "us-initial-claims", label: "Initial Claims", payload: metric ?? componentMetrics["us-initial-claims"] },
            { id: "us-continuing-claims", label: "Continuing Claims", payload: componentMetrics["us-continuing-claims"] },
          ].map((claim) => (
            <div className="rate-box" key={claim.id}>
              <span>{claim.label}</span>
              <strong>{formatClaimsCount(latestClaimsValue(claim.payload))}</strong>
            </div>
          ))}
        </div>
      ) : <div className="macro-values">
        <div className="rate-box">
          <span>{cardKpis.leftLabel}</span>

          <strong
            className={
              cardKpis.mode === "normal" || cardKpis.mode === "absolute-change"
                ? changeColor(
                    cardKpis.leftValue,
                    invert
                  )
                : ""
            }
          >
            {cardKpis.mode === "normal" ? (
              percentagePointIds.has(
                spec.metricId
              ) ? (
                pp(cardKpis.leftValue)
              ) : (
                pct(cardKpis.leftValue)
              )
            ) : cardKpis.mode === "absolute-change" ? (
              formatAbsoluteChangeValue(cardKpis.leftValue, metric)
            ) : (
              formatMetricValue(
                cardKpis.leftValue,
                metric
              )
            )}
          </strong>
        </div>

        {cardKpis.showRight && (
          <div className="rate-box">
            <span>{cardKpis.rightLabel}</span>

            <strong
              className={
                cardKpis.mode === "normal" || cardKpis.mode === "absolute-change"
                  ? changeColor(
                      cardKpis.rightValue,
                      invert
                    )
                  : ""
              }
            >
              {cardKpis.mode === "normal" ? (
                percentagePointIds.has(
                  spec.metricId
                ) ? (
                  pp(cardKpis.rightValue)
                ) : (
                  pct(cardKpis.rightValue)
                )
              ) : cardKpis.mode === "absolute-change" ? (
                formatAbsoluteChangeValue(cardKpis.rightValue, metric)
              ) : (
                formatMetricValue(
                  cardKpis.rightValue,
                  metric
                )
              )}
            </strong>
          </div>
        )}
      </div>}

      <div
        className={clsx(
          "macro-spark",
          invert
            ? "text-[var(--down)]"
            : "text-[var(--accent)]"
        )}
        style={{
          width: "100%",
          height: "70px",
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <MiniRateChart
          spec={spec}
          root={metric}
          allMetrics={{
            ...componentMetrics,
            [spec.metricId]: metric,
          }}
        />
      </div>

      <div className="release-line">
        <CalendarDays size={14} />

        <span>
          Updated:{" "}
          {metric?.displayReleasedAt
            ? formatObsDate(
                metric.displayReleasedAt
              )
            : "—"}
        </span>

        {displayReleaseStage(metric?.meta.releaseStage) && (
          <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-ink)]">
            {displayReleaseStage(metric?.meta.releaseStage)}
          </span>
        )}

        <span className="release-source">
          Source:{" "}
          {formatLiveSourceLabel(m?.liveSource)}
        </span>
      </div>

      <button
        className="detail-button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        View details <ChevronRight size={15} />
      </button>
    </article>
  );
}
function LabourChartStudio({ category, specs, metrics, onOpen, highlightedMetricId, selectedId, onSelectionChange, actionLabel = "View details" }: {
  category: "activity" | "labour";
  specs: IndicatorSpec[];
  metrics: Record<string, DetailPayload | undefined>;
  onOpen: (spec: IndicatorSpec) => void;
  highlightedMetricId: string | null;
  selectedId: string | null;
  onSelectionChange: (id: string) => void;
  actionLabel?: string;
}) {
  const active = resolveStudioSelection(specs, selectedId);
  const [traceRun, setTraceRun] = useState(0);
    const [retailMeasure, setRetailMeasure] = useState<"paired" | "mom" | "yoy" | "3m3m">("mom");
    const [showThreeMonth, setShowThreeMonth] = useState(false);
    useEffect(() => { const selectedMetric = metrics[active?.metricId ?? ""]; const canPair = Boolean(selectedMetric?.threeMonth?.history?.length && ["US", "EA"].includes(selectedMetric.meta.region)); setRetailMeasure(canPair ? "paired" : "mom"); setShowThreeMonth(false); }, [active?.id]);
  if (!active) return null;
  const metric = metrics[active.metricId];
    const hasThreeMonth = !isLaborChangeMetric(metric?.meta.id) && Boolean(metric?.threeMonth?.history?.length);
  const readings = getCardKpis(active, metric, metrics, "detail");
  const isUsRetailSales = category === "activity" && active.id === "us-retail-sales-card";
  const isUkRetailSales = category === "activity" && active.id === "uk-retail-sales-card";
  const isUkWageGrowth = category === "labour" && active.id === "uk-wages-card";
  const isEaRetailSales = category === "activity" && active.id === "ea-retail-sales-card";
  const isRetailSales = isUsRetailSales || isUkRetailSales || isEaRetailSales;
  const controlGroup = isUsRetailSales ? metrics["us-retail-sales-control-group"] : undefined;
  const controlGroupSpec = controlGroup ? {
    ...active,
    id: "us-retail-sales-control-card",
    metricId: controlGroup.meta.id,
    title: "Retail Sales Control Group",
    components: [
      { id: "food-beverage", label: "Food & Beverage", metricId: "us-retail-food-beverage" },
      { id: "general-merchandise", label: "General Merchandise", metricId: "us-retail-general-merchandise" },
      { id: "nonstore", label: "Nonstore (Online)", metricId: "us-retail-nonstore" },
    ],
  } : null;
  const exFuelId = isUkRetailSales ? "uk-retail-sales-ex-fuel" : isEaRetailSales ? "ea-retail-sales-ex-fuel" : null;
  const exFuelMetric = exFuelId ? metrics[exFuelId] : undefined;
  const exFuelSpec = exFuelMetric ? {
    ...active,
    id: `${active.id}-ex-fuel-card`,
    metricId: exFuelMetric.meta.id,
    title: "Retail Sales ex Fuel",
  } : null;
    const ukHeadlineYoyMetric = isUkRetailSales ? metrics["uk-retail-sales-total-yoy"] : undefined;
    const ukExFuelYoyMetric = isUkRetailSales ? metrics["uk-retail-sales-ex-fuel-yoy"] : undefined;
  const headlineRates = isRetailSales ? getCardKpis(active, metric, metrics, "detail") : null;
  const controlRates = controlGroup && controlGroupSpec ? getCardKpis(controlGroupSpec, controlGroup, metrics, "detail") : null;
  const exFuelRates = exFuelMetric && exFuelSpec ? getCardKpis(exFuelSpec, exFuelMetric, metrics, "detail") : null;
  const supplementalRetailMetric = controlGroup ?? exFuelMetric;
  const supplementalRetailRates = controlGroup ? controlRates : exFuelRates;
  const supplementalRetailSpec = controlGroupSpec ?? exFuelSpec;
  const supplementalRetailTitle = isUsRetailSales ? "Retail Sales Control Group" : "Retail Sales ex Fuel";
  const retailRateText = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    const headlineYoyReading = isUkRetailSales
      ? normalizeHistory(ukHeadlineYoyMetric?.history ?? []).at(-1)?.value ?? null
      : headlineRates?.leftValue;
    const headlineThreeMonthReading = normalizeHistory(metric?.threeMonth?.history ?? []).at(-1)?.value ?? null;
    const supplementalYoyReading = isUkRetailSales
      ? normalizeHistory(ukExFuelYoyMetric?.history ?? []).at(-1)?.value ?? null
      : supplementalRetailRates?.leftValue;
    const supplementalThreeMonthReading = normalizeHistory(supplementalRetailMetric?.threeMonth?.history ?? []).at(-1)?.value ?? null;
    const retailThreeMonthLabel = metric?.threeMonth?.label ?? "3m/3m";
    const supplementalThreeMonthLabel = supplementalRetailMetric?.threeMonth?.label ?? retailThreeMonthLabel;
    const sharedRetailDate = (headline: string | null | undefined, exFuel: string | null | undefined) => {
      const first = headline ? formatObsDate(headline) : '—';
      const second = exFuel ? formatObsDate(exFuel) : '—';
      return first === second ? first : `Headline: ${first}; Ex-fuel: ${second}`;
    };

 const formatReading = (value: number | null | undefined, spec: IndicatorSpec, payload: DetailPayload | undefined) => {
    const kpis = getCardKpis(spec, payload, metrics, "front");
    return kpis.mode === "normal" ? percentagePointIds.has(spec.metricId) ? pp(value) : pct(value)
      : kpis.mode === "absolute-change" ? formatAbsoluteChangeValue(value, payload)
      : formatMetricValue(value, payload);
  };
  const observation = normalizeHistory(metric?.history ?? []).at(-1)?.date;
  const claims = active.id === "us-claims-card";
  const displaySelectedValue = (kpis: ReturnType<typeof getCardKpis>, spec: IndicatorSpec, payload: DetailPayload | undefined) => {
    if (spec.id === "us-claims-card") return formatClaimsCount(latestClaimsValue(payload));
    return formatReading(kpis.leftValue, spec, payload);
  };
  return <div className="labour-studio" data-category={category}>
    <p className="labour-studio-intro">Select an indicator to explore its published trend.</p>
    <div className="labour-studio-selectors" role="group" aria-label="Labour market indicators"
      style={category === "activity" ? { gridTemplateColumns: `repeat(${specs.length}, minmax(0, 1fr))` } : undefined}>
      {specs.map(spec => {
        const payload = metrics[spec.metricId];
        const kpis = getCardKpis(spec, payload, metrics, "front");
        const isUsJobOpenings = spec.metricId === "us-jolts-openings";
        const jobOpeningsHistory = isUsJobOpenings ? normalizeHistory(payload?.history ?? []) : [];
        const latestJobOpenings = jobOpeningsHistory.at(-1)?.value ?? null;
        const priorJobOpenings = jobOpeningsHistory.at(-2)?.value ?? null;
        const formatJobOpeningsLevel = (value: number | null) => value == null ? "—" : `${(value / 1000).toFixed(1)}M`;
        const jobOpeningsChange = latestJobOpenings != null && priorJobOpenings != null ? latestJobOpenings - priorJobOpenings : null;
        const selectorMeasures = category === "activity" ? categoryMeasurePair(spec, payload, metrics) : null;
          const supplementalMetricId = spec.id === "us-retail-sales-card"
            ? "us-retail-sales-control-group"
            : spec.id === "uk-retail-sales-card"
              ? "uk-retail-sales-ex-fuel"
              : spec.id === "ea-retail-sales-card"
                ? "ea-retail-sales-ex-fuel"
                : null;
          const supplementalMetric = supplementalMetricId ? metrics[supplementalMetricId] : undefined;
          const supplementalSpec: IndicatorSpec | null = supplementalMetric ? {
            ...spec,
            id: `${spec.id}-supplemental-selector`,
            metricId: supplementalMetric.meta.id,
            title: spec.id === "us-retail-sales-card" ? "Retail Sales Control Group" : "Retail Sales ex Fuel",
          } : null;
          const supplementalKpis = supplementalMetric && supplementalSpec
            ? getCardKpis(supplementalSpec, supplementalMetric, metrics, "detail")
            : null;
        return <button key={spec.id} type="button" aria-pressed={active.id === spec.id}
          aria-controls="labour-studio-chart" className={clsx("labour-studio-selector", active.id === spec.id && "is-active", highlightedMetricId && specContainsMetric(spec, highlightedMetricId) && "is-release-highlighted")}
          onClick={() => {
            onSelectionChange(spec.id);
            if (category === "labour") setTraceRun(run => run + 1);
          }}>
          <span className="labour-studio-name">{displayMetricTitle(spec, payload)}</span>
            {isUsJobOpenings ? <span className="labour-studio-pair" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              <span>Latest <b>{formatJobOpeningsLevel(latestJobOpenings)}</b></span>
              <span>Prior <b>{formatJobOpeningsLevel(priorJobOpenings)}</b></span>
              <span>Change <b>{formatLaborChange(jobOpeningsChange, payload?.meta ?? { id: "us-jolts-openings", unit: "thousands" })}</b></span>
            </span> : supplementalKpis && supplementalSpec ? <span className="labour-studio-pair">
              <span>Headline · MoM <b>{displaySelectedValue(kpis, spec, payload)}</b></span>
              <span>{supplementalSpec.title} · MoM <b>{retailRateText(supplementalKpis.rightValue ?? supplementalKpis.leftValue)}</b></span>
            </span> : spec.id === "us-claims-card" ? <span className="labour-studio-pair"><span>Initial <b>{formatClaimsCount(latestClaimsValue(payload))}</b></span><span>Continuing <b>{formatClaimsCount(latestClaimsValue(metrics["us-continuing-claims"]))}</b></span></span> : selectorMeasures?.showPair ? <span className="labour-studio-pair"><span>{selectorMeasures.leftLabel} <b>{selectorMeasures.format(selectorMeasures.leftValue)}</b></span><span>{selectorMeasures.rightLabel} <b>{selectorMeasures.format(selectorMeasures.rightValue)}</b></span></span> : kpis.showRight ? <span className="labour-studio-pair"><span>{kpis.leftLabel} <b>{formatReading(kpis.leftValue, spec, payload)}</b></span><span>{kpis.rightLabel} <b>{formatReading(kpis.rightValue, spec, payload)}</b></span></span> : <><strong>{displaySelectedValue(kpis, spec, payload)}</strong><span className="labour-studio-measure">{kpis.leftLabel}</span></>}
          <small className="studio-card-updated">Updated {payload?.displayReleasedAt ? formatObsDate(payload.displayReleasedAt) : "—"}</small>
        </button>;
      })}
    </div>
    {isRetailSales && <div className="us-retail-headline-cards" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, margin: "12px 0" }}>
        <article style={{ position: "relative", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 48px 14px 18px", background: "var(--accent-soft, var(--panel))" }}><button type="button" aria-label="Open Headline Retail Sales component card" title="Open component card" onClick={() => onOpen(active)} style={{ position: "absolute", right: 12, top: 12, display: "grid", placeItems: "center", width: 32, height: 32, border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", color: "var(--country-series)", cursor: "pointer" }}><ChevronRight size={18} /></button><h4 style={{ margin: "0 0 10px", fontSize: 15 }}>Headline Retail Sales</h4><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><div><span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>MoM · {getLatestPeriodDate(metric) ? formatObsDate(getLatestPeriodDate(metric)!) : "latest"}</span><strong style={{ display: "block", fontSize: 24, color: "var(--country-series)" }}>{retailRateText(headlineRates?.rightValue)}</strong></div><div><span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>YoY · {getLatestPeriodDate(metric) ? formatObsDate(getLatestPeriodDate(metric)!) : "latest"}</span><strong style={{ display: "block", fontSize: 24 }}>{retailRateText(headlineYoyReading)}</strong></div></div></article>
        {supplementalRetailMetric && <article style={{ position: "relative", border: "1px solid var(--country-series)", borderRadius: 10, padding: "14px 48px 14px 18px", background: "var(--accent-soft, var(--panel))" }}><button type="button" aria-label={`Open ${supplementalRetailTitle} component card`} title="Open component card" onClick={() => supplementalRetailSpec && onOpen(supplementalRetailSpec)} style={{ position: "absolute", right: 12, top: 12, display: "grid", placeItems: "center", width: 32, height: 32, border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", color: "var(--country-series)", cursor: "pointer" }}><ChevronRight size={18} /></button><h4 style={{ margin: "0 0 10px", fontSize: 15 }}>{supplementalRetailTitle}</h4><div style={{ display: "grid", gridTemplateColumns: supplementalYoyReading != null ? "1fr 1fr" : "1fr", gap: 16 }}><div><span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>MoM · {getLatestPeriodDate(supplementalRetailMetric) ? formatObsDate(getLatestPeriodDate(supplementalRetailMetric)!) : "latest"}</span><strong style={{ display: "block", fontSize: 24, color: "var(--country-series)" }}>{retailRateText(supplementalRetailRates?.rightValue ?? supplementalRetailRates?.leftValue)}</strong></div>{supplementalYoyReading != null && <div><span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>YoY · {getLatestPeriodDate(supplementalRetailMetric) ? formatObsDate(getLatestPeriodDate(supplementalRetailMetric)!) : "latest"}</span><strong style={{ display: "block", fontSize: 24 }}>{retailRateText(supplementalYoyReading)}</strong></div>}</div></article>}
    </div>}
    {isUsRetailSales && <p style={{ margin: "-4px 0 10px", color: "var(--muted)", fontSize: 11 }}>Control Group is calculated from Census seasonally adjusted sales: total less motor vehicles, gasoline, building materials, and food services.</p>}
    {isUkRetailSales && <p style={{ margin: "-4px 0 10px", color: "var(--muted)", fontSize: 11 }}>Retail Sales ex Fuel is the ONS all-retail volume series excluding automotive fuel.</p>}
    {isEaRetailSales && <p style={{ margin: "-4px 0 10px", color: "var(--muted)", fontSize: 11 }}>Retail Sales ex Fuel is Eurostat retail trade volume excluding automotive fuel (NACE G47_X_G473).</p>}
    <div id="labour-studio-chart" data-category={category} className={`labour-studio-stage${isRetailSales ? " is-retail-sales" : ""}`} aria-label={`${displayMetricTitle(active, metric)} chart and published readings`}>
      <div className="labour-studio-plot">
        <h3>{active.id === "us-wages-card" ? "Wage Growth — Average Hourly Earnings (AHE)" : category === "activity" && isQuarterlyGdpMetric(metric?.meta.id) ? `${displayMetricTitle(active, metric)} Growth` : displayMetricTitle(active, metric)}</h3>
         <p>{metric ? metric.meta.frequency : "Awaiting published observations"} · {YEAR}</p>
             <RateChart key={`${active.id}-${category === "labour" ? traceRun : 0}`} spec={active} root={metric} allMetrics={metrics} height={isRetailSales ? 360 : category === "labour" ? 360 : 300} chartType={category === "activity" ? "bar" : "line"} comparisonMetric={isUsRetailSales ? controlGroup : isUkRetailSales || isEaRetailSales ? exFuelMetric : undefined} retailYoyMetric={ukHeadlineYoyMetric} comparisonYoyMetric={ukExFuelYoyMetric} retailMeasure={retailMeasure} onRetailMeasureChange={setRetailMeasure} showThreeMonth={showThreeMonth} animateTrace={category === "labour"} />
      </div>
      <aside className={`labour-studio-reading${isRetailSales ? " is-retail-sales-reading" : ""}`}>
        <h4>{isUkWageGrowth ? "Published wage growth" : hasThreeMonth ? "Published readings and trend" : "Published readings"}</h4>
          {isUkWageGrowth ? <div style={{ display: "grid", gap: 12 }}>
            {[{ id: "uk-awe-regular-yoy", label: "AWE Regular Pay Growth" }, { id: "uk-awe-total-yoy", label: "AWE Total Pay Growth" }].map(item => {
              const payload = metrics[item.id];
              const point = normalizeHistory(payload?.history ?? []).at(-1);
              return <section key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "baseline" }}><span>{item.label} · YoY</span><strong>{retailRateText(point?.value)}</strong><small style={{ gridColumn: "1 / -1", color: "var(--muted)" }}>{point ? aweWindowLabel(point.date) : "No published observation"}</small></section>;
            })}
            <dl><div><dt>Source</dt><dd>ONS</dd></div><div><dt>Updated</dt><dd>{metric?.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"}</dd></div></dl>
          </div> : isRetailSales ? <UkRetailPublishedReadings measure={retailMeasure} readings={[
            { title: 'Headline Retail Sales', mom: headlineRates?.rightValue, yoy: headlineYoyReading, trend: headlineThreeMonthReading },
            ...(supplementalRetailMetric && supplementalRetailRates ? [{ title: supplementalRetailTitle, mom: supplementalRetailRates.rightValue ?? supplementalRetailRates.leftValue, yoy: supplementalYoyReading, trend: supplementalThreeMonthReading }] : []),
          ]} observation={sharedRetailDate(getLatestPeriodDate(metric), getLatestPeriodDate(supplementalRetailMetric))}
            source={formatLiveSourceLabel(metric?.meta.liveSource)} updated={sharedRetailDate(metric?.displayReleasedAt, supplementalRetailMetric?.displayReleasedAt)} /> : isRetailSales ? <div className="retail-published-reading-grid">
            <section style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline", columnGap: 12, rowGap: 8 }} aria-label="Headline Retail Sales published reading">
              <h5 style={{ gridColumn: "1 / -1", margin: 0, fontSize: 14 }}>Headline Retail Sales</h5>
              {retailMeasure === "mom" ? <><span>MoM · {getLatestPeriodDate(metric) ? formatObsDate(getLatestPeriodDate(metric)!) : "latest"}</span><strong>{retailRateText(headlineRates?.rightValue)}</strong></> : <>
              <span>YoY · {getLatestPeriodDate(isUkRetailSales ? ukHeadlineYoyMetric : metric) ? formatObsDate(getLatestPeriodDate(isUkRetailSales ? ukHeadlineYoyMetric : metric)!) : "latest"}</span><strong>{retailRateText(headlineYoyReading)}</strong>
              <span>{retailThreeMonthLabel} · {normalizeHistory(metric?.threeMonth?.history ?? []).at(-1)?.date ? formatObsDate(normalizeHistory(metric?.threeMonth?.history ?? []).at(-1)!.date) : "latest"}</span><strong>{retailRateText(headlineThreeMonthReading)}</strong>
              </>}
              <dl style={{ gridColumn: "1 / -1", marginTop: 6 }}>
                <div><dt>Observation</dt><dd>{getLatestPeriodDate(metric) ? formatObsDate(getLatestPeriodDate(metric)!) : "—"}</dd></div>
                <div><dt>Source</dt><dd>{formatLiveSourceLabel(metric?.meta.liveSource)}</dd></div>
                <div><dt>Updated</dt><dd>{metric?.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"}</dd></div>
              </dl>
            </section>
            {supplementalRetailMetric && supplementalRetailRates && <section style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline", columnGap: 12, rowGap: 8 }} aria-label={`${supplementalRetailTitle} published reading`}>
              <h5 style={{ gridColumn: "1 / -1", margin: 0, fontSize: 14 }}>{supplementalRetailTitle}</h5>
              {retailMeasure === "mom" ? <><span>MoM · {getLatestPeriodDate(supplementalRetailMetric) ? formatObsDate(getLatestPeriodDate(supplementalRetailMetric)!) : "latest"}</span><strong>{retailRateText(supplementalRetailRates.rightValue ?? supplementalRetailRates.leftValue)}</strong></> : <>
              <span>YoY · {getLatestPeriodDate(isUkRetailSales ? ukExFuelYoyMetric : supplementalRetailMetric) ? formatObsDate(getLatestPeriodDate(isUkRetailSales ? ukExFuelYoyMetric : supplementalRetailMetric)!) : "latest"}</span><strong>{retailRateText(supplementalYoyReading)}</strong>
              <span>{supplementalThreeMonthLabel} · {normalizeHistory(supplementalRetailMetric.threeMonth?.history ?? []).at(-1)?.date ? formatObsDate(normalizeHistory(supplementalRetailMetric.threeMonth?.history ?? []).at(-1)!.date) : "latest"}</span><strong>{retailRateText(supplementalThreeMonthReading)}</strong>
              </>}
              <dl style={{ gridColumn: "1 / -1", marginTop: 6 }}>
                <div><dt>Observation</dt><dd>{getLatestPeriodDate(supplementalRetailMetric) ? formatObsDate(getLatestPeriodDate(supplementalRetailMetric)!) : "—"}</dd></div>
                <div><dt>Source</dt><dd>{formatLiveSourceLabel(supplementalRetailMetric.meta.liveSource)}</dd></div>
                <div><dt>Updated</dt><dd>{supplementalRetailMetric.displayReleasedAt ? formatObsDate(supplementalRetailMetric.displayReleasedAt) : "—"}</dd></div>
              </dl>
            </section>}
        </div> : claims ? <div aria-label="Published jobless claims values" style={{ display: "grid", gridTemplateColumns: "minmax(56px, .65fr) minmax(0, 1fr) minmax(0, 1.1fr)", columnGap: 6, rowGap: 13, alignItems: "baseline" }}>
          <span />
          <h5 style={{ minWidth: 0, margin: 0, fontSize: 13 }}>Initial claims</h5>
          <h5 style={{ minWidth: 0, margin: 0, paddingLeft: 8, fontSize: 13 }}>Continuing claims</h5>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Weekly</span>
          <strong style={{ minWidth: 0, whiteSpace: "nowrap", fontSize: 17, lineHeight: 1.1, color: "var(--country-series)" }}>{formatClaimsCount(latestClaimsValue(metric))}</strong>
          <strong style={{ minWidth: 0, paddingLeft: 8, whiteSpace: "nowrap", fontSize: 17, lineHeight: 1.1, color: "var(--up)" }}>{formatClaimsCount(latestClaimsValue(metrics["us-continuing-claims"]))}</strong>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>4-week average</span>
          <strong style={{ minWidth: 0, whiteSpace: "nowrap", fontSize: 17, lineHeight: 1.1, color: "var(--country-series)" }}>{formatClaimsCount(metric?.threeMonth?.history.at(-1)?.value ?? null)}</strong>
          <strong style={{ minWidth: 0, paddingLeft: 8, whiteSpace: "nowrap", fontSize: 17, lineHeight: 1.1, color: "var(--up)" }}>{formatClaimsCount(metrics["us-continuing-claims"]?.threeMonth?.history.at(-1)?.value ?? null)}</strong>
        </div> : active.id === "us-net-exports-card" ? <><span>Latest</span><strong>{formatUsNetExportsValue(readings.leftValue)}</strong><span>Prior</span><strong className="labour-studio-secondary">{formatUsNetExportsValue(readings.rightValue)}</strong></> : category === "activity" && categoryMeasurePair(active, metric, metrics).showPair ? <><span>{categoryMeasurePair(active, metric, metrics).leftLabel}</span><strong>{categoryMeasurePair(active, metric, metrics).format(categoryMeasurePair(active, metric, metrics).leftValue)}</strong><span>{categoryMeasurePair(active, metric, metrics).rightLabel}</span><strong className="labour-studio-secondary">{categoryMeasurePair(active, metric, metrics).format(categoryMeasurePair(active, metric, metrics).rightValue)}</strong></> : <>
          <span>{readings.leftLabel}</span><strong>{isLaborChangeMetric(metric?.meta.id) ? formatMetricValue(readings.leftValue, metric) : formatReading(readings.leftValue, active, metric)}</strong>
          {hasThreeMonth && ["US", "UK"].includes(metric?.meta.region ?? "") && <><span>{metric?.threeMonth?.label}</span><strong>{metric?.threeMonth?.history.at(-1) ? formatMetricValue(metric.threeMonth.history.at(-1)!.value, metric) : "—"}</strong></>}
          {readings.showRight && <><span>{readings.rightLabel}</span><strong className="labour-studio-secondary">{isLaborChangeMetric(metric?.meta.id) ? formatMetricValue(readings.rightValue, metric) : formatReading(readings.rightValue, active, metric)}</strong></>}

          {!isRetailSales && <dl>
          <div><dt>Observation</dt><dd>{observation ? formatObsDate(observation) : "—"}</dd></div>
          <div><dt>Source</dt><dd>{formatLiveSourceLabel(metric?.meta.liveSource)}</dd></div>
          <div><dt>Updated</dt><dd>{metric?.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"}</dd></div>
          </dl>}
          </>}
        <button type="button" className="detail-button" onClick={() => onOpen(active)}>{actionLabel} <ChevronRight size={15} /></button>
      </aside>
    </div>
    <p className="labour-studio-note">Each indicator retains its published units and frequency. View details for the full breakdown.</p>
  </div>;
}
function categoryMeasurePair(spec: IndicatorSpec, root: DetailPayload | undefined, metrics: Record<string, DetailPayload | undefined>) {
  const payload = root;
  if (spec.id === "us-net-exports-card") return { showPair: true, leftLabel: "Latest", leftValue: null, rightLabel: "Prior", rightValue: null, format: () => "—" };
  const history = normalizeHistory(payload?.history ?? []);
  const latest = history.at(-1);
  const id = payload?.meta.id ?? spec.metricId;
  const formatPercent = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

  if (isQuarterlyGdpMetric(id)) {
    const pair = latestQuarterPair(history);
    return { showPair:true, leftLabel:pair.latest ? `Latest (${pair.latest.quarter})` : "Latest quarter", leftValue:pair.latest?.value ?? null, rightLabel:pair.prior ? `Prior (${pair.prior.quarter})` : "Prior quarter", rightValue:pair.prior?.value ?? null, format:formatPercent };
  }
  if (id === "us-participation" || id === "us-jolts-openings" || id === "uk-vacancies") {
    const kpis = getMetricKpis(payload);
    const format = (value: number | null) => value == null ? "—" : formatMetricValue(value, payload);
    return { showPair:true, leftLabel:"Latest", leftValue:kpis.leftValue, rightLabel:"Prior", rightValue:kpis.rightValue, format };
  }
  if (spec.id === "uk-consumption-card") {
    const current = latest?.value;
    const previousYear = history.find(point => point.date.slice(0, 4) === String(Number(latest?.date.slice(0, 4)) - 1) && point.date.slice(5, 7) === latest?.date.slice(5, 7))?.value;
    const previousQuarter = history.at(-2)?.value;
    const yoy = current != null && previousYear != null && previousYear !== 0 ? (current / previousYear - 1) * 100 : null;
    const qoq = current != null && previousQuarter != null && previousQuarter !== 0 ? (current / previousQuarter - 1) * 100 : null;
    return { showPair:true, leftLabel:"YoY", leftValue:yoy, rightLabel:"QoQ", rightValue:qoq, format:formatPercent };
  }
  if (spec.id === "uk-capital-card") {
    const yoyHistory = normalizeHistory(metrics["uk-gfcf-yoy"]?.history ?? []);
    return { showPair:true, leftLabel:"YoY", leftValue:yoyHistory.at(-1)?.value ?? null, rightLabel:"QoQ", rightValue:metrics["uk-gfcf-qoq"]?.history?.at(-1)?.value ?? null, format:formatPercent };
  }
  if (["us-real-pce-growth", "us-real-private-investment", "ea-household-consumption", "ea-gfcf", "ea-government-consumption", "ea-exports", "ea-imports"].includes(id)) {
    const rates = calculateRates(history, payload?.meta.transform, payload?.meta.frequency, id);
    const isQuarterly = payload?.meta.frequency === "quarterly";
    return { showPair:true, leftLabel:"YoY", leftValue:rates.yoy, rightLabel:isQuarterly ? "QoQ" : rates.secondLabel, rightValue:rates.mom, format:formatPercent };
  }
  return { showPair:false, leftLabel:"", leftValue:null, rightLabel:"", rightValue:null, format:formatPercent };
}
function InflationComparisonStudio({ region, specs, metrics, highlightedMetricId, onOpen }: { region: Region; specs: IndicatorSpec[]; metrics: Record<string, DetailPayload | undefined>; highlightedMetricId: string | null; onOpen: (spec: IndicatorSpec) => void }) {
  const [view, setView] = useState<"comparison" | "underlying" | "ppi">("comparison");
  const [selectedIds, setSelectedIds] = useState<string[]>(specs.length ? [specs[0].id] : []);
  const [measure, setMeasure] = useState<"paired" | "YoY" | "MoM" | "3m3m">("paired");
  const [chartRange, setChartRange] = useState({ from: 2025, to: 2026 });
  const [isDefaultChartRange, setIsDefaultChartRange] = useState(true);
  const handleChartRangeChange = useCallback((range: { from: number; to: number }, isDefault: boolean) => {
    setChartRange(current => retainHistoryRangeIdentity(current, range));
    setIsDefaultChartRange(current => current === isDefault ? current : isDefault);
  }, []);
  const colors = ["#17634e", "#426d95", "#a65c3c", "#8170a7", "#b27a38", "#567c6c", "#9a5669"];
  const ppiCard = specs.find(spec => spec.id.endsWith("-ppi-card"));
  const ppiSpecs = ppiComparisonSpecs(ppiCard);
  const displaySpecs = view === "ppi" ? ppiSpecs : specs.filter(spec => !spec.id.endsWith("-ppi-card"));
  const selected = displaySpecs.filter(spec => selectedIds.includes(spec.id));
  const plottedSpecs = inflationPlotSpecs(selected);
  const series = plottedSpecs.map(spec => {
    const primaryMeasure = measure === "paired" ? "YoY" : measure;
    const sourceId = primaryMeasure === "3m3m" ? spec.metricId : primaryMeasure === "YoY" ? spec.yoyMetricId ?? spec.metricId : spec.momMetricId ?? spec.metricId;
    const payload = metrics[sourceId] ?? metrics[spec.metricId];
    const rootMetric = metrics[spec.metricId];
    const history = normalizeHistory(payload?.history ?? []);
    const indexFallback = primaryMeasure === "YoY" && spec.id === "us-cpi-card" ? metrics["us-cpi-nsa"] ?? rootMetric : primaryMeasure === "YoY" && spec.id === "us-core-cpi-card" ? metrics["us-cpi-core-nsa"] ?? rootMetric : rootMetric;
    const rootHistory = normalizeHistory(indexFallback?.history ?? []);
    const rateHistory = primaryMeasure === "3m3m" ? normalizeHistory(payload?.threeMonth?.history ?? []) : inflationRateHistory(history, payload?.meta.transform, rootHistory, indexFallback?.meta.transform, primaryMeasure === "YoY" ? "yoy" : "mom");
    const values = new Map<string, number>();
    rateHistory.forEach(point => { if (point.value != null && Number.isFinite(point.value)) values.set(point.date.slice(0, 7), point.value); });
    const trendValues = new Map<string, number>();
    if (measure === "paired") normalizeHistory(rootMetric?.threeMonth?.history ?? []).forEach(point => { if (point.value != null && Number.isFinite(point.value)) trendValues.set(point.date.slice(0, 7), point.value); });
    return { spec, payload, values, trendValues };
  });
  const seriesTitle = (id: string | number) => {
    const key = String(id);
    const trend = key.endsWith("__trend");
    const spec = plottedSpecs.find(item => key === item.id || key === `${item.id}__trend`);
    const title = spec ? displayMetricTitle(spec, metrics[spec.metricId]) : key;
    return trend ? `${title} · ${metrics[spec?.metricId ?? ""]?.threeMonth?.label ?? (region === "US" ? "3m/3m SAAR" : "3-month average")}` : measure === "paired" ? `${title} · YoY` : title;
  };
  const periods = Array.from(new Set(series.flatMap(item => [...item.values.keys(), ...(measure === "paired" ? item.trendValues.keys() : [])]))).sort();
  const points: Array<{ date: string; period: string; label: string; [key: string]: string | number | null }> = periods.map(key => {
    const [year, month] = key.split("-").map(Number);
    const label = new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    const values: Record<string, number | null> = {};
    for (const item of series) { values[item.spec.id] = item.values.get(key) ?? null; if (measure === "paired") values[`${item.spec.id}__trend`] = item.trendValues.get(key) ?? null; }
    return { date: key, period: key, label, ...values };
  });
  const seriesPeak = (spec: IndicatorSpec) => points.reduce((peak, point) => {
    const value = point[spec.id];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(peak, value) : peak;
  }, Number.NEGATIVE_INFINITY);
  const peakShadeSpec = view === "comparison" && plottedSpecs.length > 2
    ? [...plottedSpecs].sort((a, b) => seriesPeak(b) - seriesPeak(a))[0]
    : undefined;
  const readingFor = (spec: IndicatorSpec) => {
    const metric = metrics[spec.metricId];
    const kpis = getCardKpis(spec, metric, metrics, "front");
    const readMeasure = measure === "paired" ? "YoY" : measure;
    const fmtRate = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    const sourceId = readMeasure === "3m3m" ? spec.metricId : readMeasure === "YoY" ? spec.yoyMetricId ?? spec.metricId : spec.momMetricId ?? spec.metricId;
    const payload = metrics[sourceId] ?? metric;
    const sourceHistory = normalizeHistory(payload?.history ?? []);
    const rootHistory = normalizeHistory(metric?.history ?? []);
    const rateHistory = (id: string | undefined, mode: "yoy" | "mom") => {
      const preferred = id ? metrics[id] : metric;
      const fallback = mode === "yoy" && spec.id === "us-cpi-card" ? metrics["us-cpi-nsa"] ?? metric : mode === "yoy" && spec.id === "us-core-cpi-card" ? metrics["us-cpi-core-nsa"] ?? metric : metric;
      return inflationRateHistory(normalizeHistory(preferred?.history ?? []), preferred?.meta.transform, mode === "mom" ? rootHistory : normalizeHistory(fallback?.history ?? []), mode === "mom" ? metric?.meta.transform : fallback?.meta.transform, mode);
    };
    const selectedRates = readMeasure === "3m3m" ? normalizeHistory(metric?.threeMonth?.history ?? []) : rateHistory(sourceId, readMeasure === "YoY" ? "yoy" : "mom");
    const latestRate = selectedRates.at(-1);
    const latestTrend = normalizeHistory(metric?.threeMonth?.history ?? []).at(-1);
    const latestPeriod = latestRate?.date ?? getLatestPeriodDate(metric);
    const observationKey = (getLatestPeriodDate(metric) ?? latestPeriod)?.slice(0, 7);
    const valueAtObservation = (history: Array<{ date: string; value: number | null }>) => observationKey
      ? history.findLast(point => point.date.slice(0, 7) === observationKey)?.value ?? null
      : null;
    const yoyReading = valueAtObservation(rateHistory(spec.yoyMetricId, "yoy"));
    const momReading = valueAtObservation(rateHistory(spec.momMetricId, "mom"));
    const threeMonthReading = valueAtObservation(normalizeHistory(metric?.threeMonth?.history ?? []));
    const rootRates = rootHistory.length ? calculateRates(rootHistory, metric?.meta.transform, metric?.meta.frequency, spec.metricId) : { yoy: null, mom: null, secondLabel: "MoM" };
    const alternateId = readMeasure === "3m3m" ? undefined : readMeasure === "YoY" ? spec.momMetricId : spec.yoyMetricId;
    const alternateMode = readMeasure === "YoY" ? "mom" : "yoy";
    const alternateRates = rateHistory(alternateId, alternateMode);
    const alternateRate = alternateRates.findLast(point => point.date.slice(0, 7) === latestRate?.date.slice(0, 7));
    const selectedReading = latestRate?.value ?? (readMeasure !== "3m3m" && (metric?.meta.transform === "level" || metric?.meta.transform === "index") ? readMeasure === "YoY" ? rootRates.yoy : rootRates.mom : readMeasure === "3m3m" ? null : readMeasure === "YoY" ? kpis.leftValue : kpis.showRight ? kpis.rightValue : null);
    const otherReading = measure === "paired" ? latestTrend?.value ?? null : readMeasure === "3m3m" ? null : alternateRate?.value ?? (metric?.meta.transform === "level" || metric?.meta.transform === "index" ? readMeasure === "YoY" ? rootRates.mom : rootRates.yoy : readMeasure === "YoY" ? kpis.rightValue : kpis.leftValue);
    const alternatePayload = alternateId ? metrics[alternateId] : undefined;
    const preferredHasLatest = sourceHistory.some(point => point.date.slice(0, 7) === latestRate?.date.slice(0, 7));
    const fallbackPayload = readMeasure === "YoY" && spec.id === "us-cpi-card" ? metrics["us-cpi-nsa"] ?? metric : readMeasure === "YoY" && spec.id === "us-core-cpi-card" ? metrics["us-cpi-core-nsa"] ?? metric : metric;
    const readingPayload = readMeasure === "3m3m" ? metric : preferredHasLatest ? payload : fallbackPayload;
    const alternateHasLatest = alternatePayload?.history?.some(point => point.date.slice(0, 7) === latestRate?.date.slice(0, 7));
    const otherFallbackPayload = alternateMode === "yoy" && spec.id === "us-cpi-card" ? metrics["us-cpi-nsa"] ?? metric : alternateMode === "yoy" && spec.id === "us-core-cpi-card" ? metrics["us-cpi-core-nsa"] ?? metric : metric;
    const otherPayload = measure === "paired" ? metric : readMeasure === "3m3m" ? undefined : alternateHasLatest ? alternatePayload : otherFallbackPayload;
    return { kpis, fmtRate, selectedReading, otherReading, yoyReading, momReading, threeMonthReading, latestPeriod, releaseDate: readingPayload?.displayReleasedAt ? formatObsDate(readingPayload.displayReleasedAt) : "—", secondReleaseDate: otherPayload?.displayReleasedAt ? formatObsDate(otherPayload.displayReleasedAt) : "—", source: formatLiveSourceLabel(readingPayload?.meta.liveSource ?? readingPayload?.meta.liveProvider ?? readingPayload?.meta.source), hasSecond: otherReading != null, secondSource: formatLiveSourceLabel(otherPayload?.meta.liveSource ?? otherPayload?.meta.liveProvider ?? otherPayload?.meta.source), secondPeriod: latestPeriod };
  };
  const modeTabs = <div className="inflation-mode-tabs" role="tablist" aria-label="Inflation views">
    <button type="button" role="tab" aria-selected={view === "comparison"} onClick={() => { setView("comparison"); setMeasure("paired"); setSelectedIds(specs.filter(spec => !spec.id.endsWith("-ppi-card")).slice(0, 1).map(spec => spec.id)); }}>{region === "US" ? "CPI & PCE" : region === "UK" ? "CPI & CPIH" : "HICP"}</button>
    <button type="button" role="tab" aria-selected={view === "ppi"} onClick={() => { setView("ppi"); setMeasure(region === "UK" ? "paired" : "YoY"); setSelectedIds(((region === "US" || region === "EA") ? ppiSpecs : ppiSpecs.slice(0, 1)).map(spec => spec.id)); }}>PPI</button>
    {region === "US" && <button type="button" role="tab" aria-selected={view === "underlying"} onClick={() => setView("underlying")}>Underlying inflation</button>}
  </div>;
  if (view === "underlying" && region === "US") return <div className="inflation-studio-shell">{modeTabs}<UnderlyingInflationMeasures metrics={metrics} onOpen={onOpen} /></div>;
  return <div className="inflation-studio-shell">{modeTabs}<div className="inflation-studio">
    <div className="inflation-studio-controls" role="group" aria-label="Inflation indicators">{displaySpecs.map((spec, index) => { const active = selectedIds.includes(spec.id); return <button key={spec.id} type="button" aria-pressed={active} className={clsx("inflation-chip", active && "is-active", highlightedMetricId && specContainsMetric(spec, highlightedMetricId) && "is-release-highlighted")} style={{ "--series-color": colors[index % colors.length] } as React.CSSProperties} onClick={() => setSelectedIds(current => active ? current.filter(id => id !== spec.id) : [...current, spec.id])}><i />{displayMetricTitle(spec, metrics[spec.metricId])}</button>; })}
       <div className="inflation-measure-toggle" role="group" aria-label="Inflation measure">{([...(view === "ppi" ? (region === "UK" ? ["paired" as const] : region === "EA" || region === "US" ? ["YoY" as const, "3m3m" as const] : ["YoY" as const]) : ["paired" as const]), "MoM" as const]).map(value => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{value === "paired" ? (view === "ppi" && region === "UK" ? "YoY + 3m/3m SAAR" : region === "UK" ? "YoY + 3-month average" : region === "EA" ? "YoY + 3-month avg" : "YoY + 3m/3m SAAR") : value === "3m3m" ? "3m/3m SAAR" : value}</button>)}</div>
    </div>
    <div className="inflation-data-layout">
       <section className="inflation-chart-panel" aria-label="Inflation comparison chart">
       <div className="inflation-chart-heading"><div className="inflation-chart-title"><h3>{view === "ppi" ? "PPI" : region === "EA" ? "HICP" : "Inflation"} comparison</h3><span>{measure === "paired" ? `YoY and ${view === "ppi" && region === "UK" ? "3m/3m SAAR" : region === "UK" ? "3-month average" : region === "EA" ? "3-month avg YoY" : "3m/3m SAAR"}` : measure === "3m3m" ? (region === "UK" ? "3-month average" : region === "EA" ? view === "ppi" ? "3m/3m SAAR" : "3-month avg YoY" : "3m/3m SAAR") : measure} change · {isDefaultChartRange ? "last 12 months" : chartRange.from === chartRange.to ? chartRange.from : `${chartRange.from}–${chartRange.to}`}</span></div><div className="inflation-chart-legend" aria-label="Chart series">{selected.flatMap(spec => { const color = colors[plottedSpecs.findIndex(item => item.id === spec.id) % colors.length]; return measure === "paired" ? [<span key={spec.id}><i style={{ borderTop: `2px solid ${color}` }} />{seriesTitle(spec.id)}{region === "US" ? " · left axis" : ""}</span>, <span key={`${spec.id}-trend`}><i style={{ borderTop: `2px dotted ${color}` }} />{seriesTitle(`${spec.id}__trend`)}{region === "US" ? " · right axis" : ""}</span>] : [<span key={spec.id}><i style={{ borderTop: `2px solid ${color}` }} />{seriesTitle(measure === "3m3m" ? spec.id + "__trend" : spec.id)}</span>]; })}</div></div>
        <div className="inflation-plot">{plottedSpecs.length ? <HistoryChartViewport dates={points.map(point => point.period)} frequency="monthly" height={352} label="Inflation comparison" onRangeChange={handleChartRangeChange}>{(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearPoints = isDefaultWindow ? filterHistoryToTrailing12Months(points) : filterHistoryByYearRange(points, fromYear, toYear); const peakBaseline = measure === "YoY" || measure === "paired" ? 2 : 0; const chartPoints = yearPoints.map(point => { const value = peakShadeSpec ? point[peakShadeSpec.id] : null; return { ...point, peakShade: typeof value === "number" && value > peakBaseline ? value : null }; }); const splitUsAxes = region === "US" && measure === "paired"; const primaryValues = yearPoints.flatMap(point => plottedSpecs.map(spec => point[spec.id]).filter((value): value is number => value != null && Number.isFinite(value))); const secondaryValues = yearPoints.flatMap(point => plottedSpecs.map(spec => point[`${spec.id}__trend`]).filter((value): value is number => value != null && Number.isFinite(value))); const pairedTicks = splitUsAxes ? getPairedAxisTicks(primaryValues, secondaryValues, 7, 0.05) : null; const yearTicks = pairedTicks?.primaryTicks ?? getNiceTicks([...primaryValues, ...(measure === "paired" ? secondaryValues : [])]); const trendTicks = pairedTicks?.secondaryTicks ?? []; return <ResponsiveContainer width={plotWidth} height="100%"><LineChart data={chartPoints} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}><CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical /><XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} minTickGap={18} interval="preserveStartEnd" /><YAxis yAxisId="primary" allowDataOverflow unit="%" width={52} ticks={yearTicks} domain={getNiceTickDomain(yearTicks)} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />{splitUsAxes && trendTicks.length > 0 && <YAxis yAxisId="secondary" orientation="right" allowDataOverflow unit="%" width={58} ticks={trendTicks} domain={getNiceTickDomain(trendTicks)} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} />}<Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} formatter={(value, name) => [Number(value).toFixed(1) + "%", seriesTitle(name ?? "")] } labelFormatter={(label) => String(label)} content={measure === "paired" ? ({ active, label, payload }) => { if (!active || !payload?.length) return null; const grouped = new Map<string, { yoy?: number; trend?: number }>(); for (const entry of payload) { const key = String(entry.dataKey ?? ""); const isTrend = key.endsWith("__trend"); const id = isTrend ? key.slice(0, -7) : key; if (!plottedSpecs.some(spec => spec.id === id) || entry.value == null || !Number.isFinite(Number(entry.value))) continue; const values = grouped.get(id) ?? {}; values[isTrend ? "trend" : "yoy"] = Number(entry.value); grouped.set(id, values); } return <div className="inflation-paired-tooltip"><strong className="inflation-paired-tooltip-period">{String(label)}</strong><div className="inflation-paired-tooltip-head"><span>Indicator</span><span>YoY</span><span>{region === "UK" ? view === "ppi" ? "3m/3m SAAR" : "3-month avg" : "3m/3m SAAR"}</span></div>{[...grouped].map(([id, values]) => <div className="inflation-paired-tooltip-row" key={id}><span><i style={{ background: colors[plottedSpecs.findIndex(spec => spec.id === id) % colors.length] }} />{seriesTitle(id)}</span><b>{values.yoy == null ? "—" : values.yoy.toFixed(1) + "%"}</b><b>{values.trend == null ? "—" : values.trend.toFixed(1) + "%"}</b></div>)}</div>; } : undefined} />{peakShadeSpec && <Area yAxisId="primary" dataKey="peakShade" type="linear" baseValue={peakBaseline} stroke="none" fill={colors[plottedSpecs.findIndex(spec => spec.id === peakShadeSpec.id) % colors.length]} fillOpacity={0.14} tooltipType="none" isAnimationActive={false} />}{plottedSpecs.map(spec => <Area key={`shade-${spec.id}`} yAxisId="primary" dataKey={spec.id} type="linear" baseValue={yearTicks[0] ?? "dataMin"} stroke="none" fill={colors[plottedSpecs.findIndex(item => item.id === spec.id) % colors.length]} fillOpacity={0.07} tooltipType="none" isAnimationActive={false} />)}{plottedSpecs.flatMap(spec => {
  const color = colors[plottedSpecs.findIndex(item => item.id === spec.id) % colors.length];
  const trendKey = `${spec.id}__trend`;
  return [
    <Line key={spec.id} yAxisId="primary" connectNulls={false} type="linear" dataKey={spec.id} name={spec.id} stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} /> ,
    ...(measure === "paired" ? [<Line key={trendKey} yAxisId={splitUsAxes ? "secondary" : "primary"} connectNulls={false} type="linear" dataKey={trendKey} name={trendKey} stroke={color} strokeWidth={2.5} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />] : []),
  ];
})}</LineChart></ResponsiveContainer>; }}</HistoryChartViewport> : <div className="inflation-no-selection">Select an indicator to plot its published history.</div>}</div>
      {region === "US" && measure === "paired" && chartRange.from <= 2025 && chartRange.to >= 2025 && plottedSpecs.some(spec => ["us-cpi-card", "us-core-cpi-card"].includes(spec.id)) && <p className="inflation-data-note">BLS did not publish CPI indexes for October 2025 during the federal funding lapse. Since 3m/3m SAAR needs four consecutive seasonally adjusted index values, CPI and Core CPI are blank for October 2025 through January 2026; values resume in February. No estimates are substituted.</p>}
      {region === "UK" && view === "ppi" && measure === "paired" && <p className="inflation-data-note">The UK PPI 3m/3m SAAR is compounded from three monthly ONS rates. ONS PPI is not seasonally adjusted, so seasonal effects remain in this annualized trend.</p>}
      </section>
      <section className="inflation-reading-panel" aria-label="Latest inflation readings table">
        <div className="inflation-reading-heading"><h3>{view === "ppi" ? "Latest producer price readings" : "Latest inflation readings"}</h3><span>Published release date and observation period are shown separately.</span></div>
        <div className="inflation-reading-wrap" role="region" aria-label="Latest inflation readings" tabIndex={0}><table className={clsx("inflation-reading-table", (region === "US" || region === "UK") && "has-three-rates")}><thead><tr><th>Indicator</th>{(region === "US" || region === "UK") ? <><th>YoY</th><th>MoM</th><th>{region === "UK" ? view === "ppi" ? "3m/3m SAAR" : "3-month average" : "3m/3m SAAR"}</th></> : <><th>{measure === "paired" ? "YoY" : measure === "3m3m" ? "3m/3m SAAR" : measure}</th>{measure !== "3m3m" && <th>{measure === "paired" ? (region === "EA" ? "3-month avg YoY" : "3m/3m SAAR") : measure === "YoY" ? "MoM" : "YoY"}</th>}</>}<th>Release date</th><th>Period</th><th>Source</th><th aria-label="Details" /></tr></thead><tbody>{displaySpecs.map((spec, index) => { const reading = readingFor(spec); const active = selectedIds.includes(spec.id); const secondValue = reading.otherReading; const showThreeRates = region === "US" || region === "UK"; return <tr key={spec.id} className={clsx(active && "selected-reading", highlightedMetricId && specContainsMetric(spec, highlightedMetricId) && "is-release-highlighted")} style={{ "--series-color": colors[index % colors.length] } as React.CSSProperties}><th scope="row"><i />{displayMetricTitle(spec, metrics[spec.metricId])}</th>{showThreeRates ? <><td>{spec.groupOnly ? "By component" : reading.fmtRate(reading.yoyReading)}</td><td>{spec.groupOnly ? "By component" : reading.fmtRate(reading.momReading)}</td><td>{spec.groupOnly ? "By component" : reading.fmtRate(reading.threeMonthReading)}</td></> : <><td>{spec.groupOnly ? "By component" : reading.fmtRate(reading.selectedReading)}</td>{measure !== "3m3m" && <td>{spec.groupOnly ? "By component" : reading.hasSecond ? reading.fmtRate(secondValue) : "—"}</td>}</>}<td>{reading.releaseDate}{reading.hasSecond && reading.secondReleaseDate !== reading.releaseDate ? <small className="reading-meta">{measure === "paired" ? (region === "UK" ? "3-month average" : region === "EA" ? "3-month avg YoY" : "3m/3m SAAR") : measure === "YoY" ? "MoM" : "YoY"}: {reading.secondReleaseDate}</small> : null}</td><td>{reading.latestPeriod ? formatObsDate(reading.latestPeriod) : "—"}</td><td>{reading.source}{reading.hasSecond && reading.secondSource !== reading.source ? <small className="reading-meta">{measure === "paired" ? (region === "UK" ? "3-month average" : region === "EA" ? "3-month avg YoY" : "3m/3m SAAR") : measure === "YoY" ? "MoM" : "YoY"}: {reading.secondSource}</small> : null}</td><td><button type="button" aria-label={`View ${displayMetricTitle(spec, metrics[spec.metricId])} details`} onClick={() => onOpen(spec)}><ChevronRight size={15} /></button></td></tr>; })}</tbody></table></div>
      </section>
    </div>
  </div></div>;
}

const UNDERLYING_INFLATION_MEASURES = [
  { id: "us-sticky-cpi", title: "Sticky CPI", source: "Atlanta Fed" },
  { id: "us-core-sticky-cpi", title: "Core Sticky CPI", source: "Atlanta Fed" },
  { id: "us-cleveland-median-pce", title: "Median PCE", source: "Cleveland Fed" },
  { id: "us-dallas-trimmed-mean-pce", title: "Trimmed Mean PCE", source: "Dallas Fed" },
  { id: "us-cleveland-median-cpi", title: "Median CPI", source: "Cleveland Fed" },
] as const;
const UNDERLYING_INFLATION_METRIC_IDS = new Set<string>([
  "us-sticky-cpi",
  "us-core-sticky-cpi",
  "us-flexible-cpi",
  "us-cleveland-median-cpi",
  "us-cleveland-trimmed-cpi",
]);

function UnderlyingInflationMeasures({ metrics, onOpen }: { metrics: Record<string, DetailPayload | undefined>; onOpen: (spec: IndicatorSpec) => void }) {
  const [measure, setMeasure] = useState<"paired" | "YoY" | "MoM">("paired");
  return <div role="tabpanel" aria-label="Underlying inflation measures">
    <div className="underlying-inflation-toolbar">
      <span>Published inflation rates · select a measure</span>
      <div className="inflation-measure-toggle" role="group" aria-label="Underlying inflation measure">{(["paired", "MoM"] as const).map(value => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{value === "paired" ? "YoY + 3m/3m" : value}</button>)}</div>
    </div>
    <div className="underlying-inflation-grid">
    {UNDERLYING_INFLATION_MEASURES.map((item, index) => {
      const payload = metrics[item.id];
      const momPayload = metrics[`${item.id}-mom`];
      const selectedPayload = measure === "MoM" ? momPayload : payload;
      const trendHistory = measure === "paired" ? normalizeHistory(payload?.threeMonth?.history ?? []) : [];
      const history = normalizeHistory(selectedPayload?.history ?? []);
      const latest = history.at(-1);
      const color = ["#17634e", "#426d95", "#a65c3c", "#8170a7", "#b27a38"][index];
      const spec: IndicatorSpec = { id: item.id, metricId: item.id, title: item.title, yoyMetricId: item.id, momMetricId: `${item.id}-mom` };
      return <article className="underlying-inflation-card" key={item.id}>
        <header><div><h3>{item.title}</h3><span>{item.source} · monthly · {measure === "paired" ? "YoY and 3-month trend" : measure === "YoY" ? "12-month change" : item.source === "Atlanta Fed" ? "1-month change · annualized source converted" : "1-month change"}</span></div><b>{latest ? `${latest.value > 0 ? "+" : ""}${latest.value.toFixed(1)}%` : "—"}</b></header>
        <div className="underlying-inflation-chart">{history.length ? <HistoryChartViewport dates={history.map(point => point.date)} frequency="monthly" height={304} label={`${item.title} ${measure} history`}>{(plotWidth, fromYear, toYear, isDefaultWindow) => {
          const visibleHistory = isDefaultWindow ? filterHistoryToTrailing12Months(history) : filterHistoryByYearRange(history, fromYear, toYear);
          const visibleTrend = isDefaultWindow ? filterHistoryToTrailing12Months(trendHistory) : filterHistoryByYearRange(trendHistory, fromYear, toYear);
          const trendByMonth = new Map(visibleTrend.map(point => [point.date.slice(0, 7), point.value]));
          const valueByMonth = new Map(visibleHistory.map(point => [point.date.slice(0, 7), point.value]));
          const months = [...new Set([...valueByMonth.keys(), ...trendByMonth.keys()])].sort();
          const chartData = months.map(month => ({ date: `${month}-01`, label: formatObsDate(`${month}-01`), value: valueByMonth.get(month) ?? null, trend: trendByMonth.get(month) ?? null }));
          const axisTicks = getNiceTicks(chartData.flatMap(point => [point.value, point.trend].filter((value): value is number => value != null && Number.isFinite(value))), 8, measure === "MoM" ? 0.05 : 0.1);
          const trendLabel = payload?.threeMonth?.label ?? "3-month average";
          return <ResponsiveContainer width={plotWidth || "100%"} height="100%"><LineChart data={chartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}><CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical /><XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} interval="preserveStartEnd" minTickGap={18} axisLine={{ stroke: "var(--line-strong)" }} tickLine={false} /><YAxis allowDataOverflow unit="%" width={42} ticks={axisTicks} domain={getNiceTickDomain(axisTicks)} tick={{ fill: "var(--muted)", fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} formatter={(value, name) => [`${Number(value).toFixed(2)}%`, String(name ?? item.title)]} /><Legend verticalAlign="top" align="right" height={20} iconType="line" wrapperStyle={{ fontSize: 9 }} /><Area dataKey="value" type="linear" baseValue={axisTicks[0] ?? "dataMin"} stroke="none" fill={color} fillOpacity={0.18} tooltipType="none" isAnimationActive={false} /><Line dataKey="value" name="YoY" type="linear" stroke={color} strokeWidth={2.2} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />{trendHistory.length > 0 && <Line dataKey="trend" name={trendLabel} type="linear" stroke={color} strokeWidth={2.2} strokeDasharray="2 5" dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />}</LineChart></ResponsiveContainer>;
        }}</HistoryChartViewport> : <p>No monthly observations are loaded for this measure yet.</p>}</div>
        <footer><span>Observation: {latest ? formatObsDate(latest.date) : "—"}</span><span>Source: {formatLiveSourceLabel(selectedPayload?.meta.liveSource ?? item.source)}</span><button type="button" onClick={() => onOpen(spec)}>Details <ChevronRight size={14} /></button></footer>
      </article>;
    })}
    </div>
  </div>;
}

function ExpectationGroupStudio({ region, specs, metrics, onMetricOpen, highlightedMetricId }: { region: Region; specs: IndicatorSpec[]; metrics: Record<string, DetailPayload | undefined>; onMetricOpen: (metricId: string) => void; highlightedMetricId: string | null }) {
  const visibleSpecs = region === "UK" ? specs.filter(spec => spec.expectationGroup !== "professional") : specs;
  const groups = Array.from(new Set(visibleSpecs.map(spec => spec.expectationGroup).filter((group): group is NonNullable<IndicatorSpec["expectationGroup"]> => Boolean(group))));
  const [group, setGroup] = useState<string>(groups[0] ?? "consumer");
  const active = visibleSpecs.find(spec => spec.expectationGroup === group) ?? visibleSpecs[0];
  if (!active) return null;
  const candidateIds = active.chartMetricIds?.length ? active.chartMetricIds : collectMetricIds(active.components);
  const entries = candidateIds.map(id => metrics[id]).filter((item): item is DetailPayload => Boolean(item));
  const orderedEntries = active.id === "us-inflation-expectations-wage"
    ? [...entries].sort((a, b) => Number(b.meta.id === "us-atlanta-wage") - Number(a.meta.id === "us-atlanta-wage"))
    : entries;
  return <div className="expectation-studio">
    <div className="expectation-group-tabs" role="tablist" aria-label="Expectation groups">{groups.map(item => <button key={item} type="button" role="tab" aria-selected={group === item} onClick={() => setGroup(item)}>{item === "consumer" ? "Consumer" : item === "wage" ? "Household & wage" : item === "business" ? "Business" : item === "market" ? "Market-based" : item === "professional" ? (region === "UK" ? "Professional" : "Professional") : "Model-based"}</button>)}</div>
    <div className={clsx("expectation-studio-panel", active.id === "us-inflation-expectations-wage" && "expectation-studio-panel--nyfed-wide")}><div className="expectation-studio-chart"><ExpectationCharts spec={active} allMetrics={metrics} /></div><aside><h3>Latest published readings</h3>{orderedEntries.map(metric => { const latest = expectationSeries(metrics, metric.meta.id).data.at(-1); return <button key={metric.meta.id} type="button" className={clsx("expectation-reading", highlightedMetricId === metric.meta.id && "is-release-highlighted")} aria-label={`Open chart for ${metric.meta.shortName || metric.meta.name}`} onClick={() => onMetricOpen(metric.meta.id)}><div><strong>{metric.meta.shortName || metric.meta.name}</strong><span>{metric.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"} · {formatLiveSourceLabel(metric.meta.liveSource)}</span></div><b>{formatExpectationValue(metric, latest?.value)}</b><ChevronRight size={15} aria-hidden="true" /></button>; })}{entries.length === 0 && <p>No published readings are available for this group.</p>}</aside></div><p className="expectation-studio-note">Historical published expectations by source and horizon.</p>
  </div>;
}
function expectationHorizon(metricId: string, label: string) {
  const text = `${metricId} ${label}`.toLowerCase();

  // Check the compound horizons before the simple "5y" match.
  if (
    text.includes("5y5y") ||
    text.includes("5y-5y") ||
    text.includes("five-year, five-year") ||
    text.includes("five year five year")
  ) {
    return "5Y5Y";
  }

  if (
    text.includes("5-10y") ||
    text.includes("5–10y") ||
    text.includes("5 10y") ||
    text.includes("5 to 10y")
  ) {
    // The UI treats the Citi/YouGov 5–10Y measure as the
    // long-term "5Y" bucket so it can be compared directly
    // with the BoE 5Y component.
    return "5Y";
  }

  const match = text.match(/(?:^|[^0-9])(\d{1,2})\s*y(?:ear)?(?:$|[^a-z0-9])/i);
  if (match) {
    return `${match[1]}Y`;
  }

  // Some expectation metrics are inherently year-ahead series but their
  // metric id does not contain "1y" (for example Atlanta Fed Wage Tracker).
  return "1Y";
}

function expectationSeries(
  allMetrics: Record<string, DetailPayload | undefined>,
  id: string,
  label?: string
) {
  const metric = allMetrics[id]?.meta;
  const componentLabel =
    label ??
    metric?.shortName ??
    metric?.name ??
    id;

  const data = getPublishedExpectationReadingsAsOf(allMetrics[id]?.history ?? []);

  const displayData = id === "uk-inflation-comp-5y5y" && data.length
    ? (() => {
        const latest = new Date(`${data[data.length - 1]!.date}T00:00:00Z`);
        latest.setUTCDate(latest.getUTCDate() - 29);
        const cutoff = latest.toISOString().slice(0, 10);
        return data.filter((point) => point.date >= cutoff);
      })()
    : data;

  return {
    id,
    label: componentLabel,
    horizon: expectationHorizon(id, componentLabel),
    frequency: metric?.frequency,
    data: displayData,
  };
}

function expectationChartNote(
  horizon: string,
  series: ReturnType<typeof expectationSeries>[] = []
) {
  if (series.some((item) => item.id === "uk-inflation-comp-5y5y")) {
    return "Bank of England implied inflation curve · daily · last 30 days.";
  }
  return `${horizon} expectation${horizon === "1Y" ? "" : "s"} — each line is a component/source.`;
}

function ExpectationCharts({
  spec,
  allMetrics,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  if (!spec.expectationGroup) return null;

  const configuredGroups = EXPECTATION_CHART_GROUPS[spec.id];
  if (configuredGroups) {
    const expanded = EXPANDED_EXPECTATION_GROUP_IDS.has(spec.id);
    return (
      <div className={expanded ? "grid gap-4 expectation-comparison-grid--expanded" : "grid gap-4 xl:grid-cols-2"}>
        {configuredGroups.map((group) => {
          const series = group.series
            .filter(({ id }) => Boolean(allMetrics[id]))
            .map(({ id, axis }) => ({
              ...expectationSeries(allMetrics, id),
              axis,
            }));

          if (!series.length) return null;

          return (
            <ExpectationComparisonChart
              key={`${spec.id}-${group.key}`}
              title={group.title}
              note={group.note}
              series={series}
              expanded={expanded}
              hideMarkers={MARKERLESS_EXPECTATION_GROUP_IDS.has(spec.id)}
            />
          );
        })}
      </div>
    );
  }

  /*
   * US Wage Expectations has a fixed structure:
   *
   * 1. NY Fed SCE inflation expectations
   * 2. NY Fed SCE household financial expectations
   * 3. NY Fed SCE labor-market expectations
   * 4. Atlanta Fed Wage Growth Tracker
   *
   * Do NOT group these by generic horizon because that mixes
   * unrelated household, labor and wage series together.
   */

  const isUsWageExpectations =
    spec.id === "us-inflation-expectations-wage";

  if (isUsWageExpectations) {
    const chartGroups = Object.values(NYFED_OVERVIEW_CHART_GROUPS);

    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {chartGroups.map((group) => {
          const series = group.ids
            .filter((id) =>
              Boolean(allMetrics[id])
            )
            .map((id) => {
              const item = expectationSeries(allMetrics, id);
              if (group.key === "nyfed-inflation") return item;

              if (group.key === "pay-growth") return item;
              const axis = NYFED_EXPECTATION_AXIS_BY_METRIC_ID[id] ?? "left";
              return {
                ...item,
                axis,
                label: `${item.label} (${axis})`,
              };
            })
          if (!series.length) {
            return null;
          }

          return (
            <ExpectationComparisonChart
              key={`${spec.id}-${group.key}`}
              title={group.title}
              note={group.note}
              series={series}
              showAlternateMonthlyTicks
            />
          );
        })}
      </div>
    );
  }
const isUsBusinessExpectations =
  spec.id === "us-inflation-expectations-business";

  if (isUsBusinessExpectations) {
  const chartGroups = [
    {
      key: "atlanta-bie",
      title: "Atlanta Fed BIE",
      note: "Monthly 1Y business inflation expectations.",
      ids: [
        "us-atlanta-bie-1y",
      ],
    },
      {
        key: "cleveland-sofie",
        title: "Cleveland Fed SoFIE",
        note: "Quarterly 1Y business inflation expectations.",
        ids: [
          "us-cleveland-sofie-1y",
        ],
      },
      {
        key: "cleveland-sofie-5y",
        title: "Cleveland Fed SoFIE · 5-Year",
        note: "Quarterly long-term business inflation expectations.",
        ids: [
          "us-cleveland-sofie-5y",
        ],
      },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {chartGroups.map((group) => {
        const series = group.ids
          .filter((id) =>
            Boolean(allMetrics[id])
          )
          .map((id) =>
            expectationSeries(
              allMetrics,
              id
            )
          )
        if (!series.length) {
          return null;
        }

        return (
          <ExpectationComparisonChart
            key={`${spec.id}-${group.key}`}
            title={group.title}
            note={group.note}
            series={series}
          />
        );
      })}
    </div>
  );
}
  /*
   * Keep the existing generic behavior for all other
   * expectation groups.
   */

  const ids = (
    spec.chartMetricIds?.length
      ? spec.chartMetricIds
      : collectMetricIds(
          spec.components
        )
  ).filter((id) =>
    Boolean(allMetrics[id])
  );

  if (!ids.length) {
    return (
      <div className="expectation-comparison-empty" role="status">
        No series data is available for this card.
      </div>
    );
  }

  const series = ids.map((id) =>
    expectationSeries(
      allMetrics,
      id
    )
  );

  const grouped = new Map<
    string,
    ReturnType<
      typeof expectationSeries
    >[]
  >();

  for (const item of series) {
    if (!item.data.length) continue;

    const bucket =
      grouped.get(item.horizon) ?? [];

    bucket.push(item);

    grouped.set(
      item.horizon,
      bucket
    );
  }

  const explicitGroups: Record<string, Array<{ key: string; title: string; note: string; ids: string[] }>> = {
    "uk-inflation-expectations-business": [
      {
        key: "dmp-cpi-1y",
        title: "BoE Decision Maker Panel · CPI 1-Year Expectations",
        note: "Businesses’ expected consumer price inflation one year ahead.",
        ids: ["uk-dmp-inflation-exp-1y"],
      },
      {
        key: "dmp-cpi-3y",
        title: "BoE Decision Maker Panel · CPI 3-Year Expectations",
        note: "Businesses’ expected consumer price inflation three years ahead.",
        ids: ["uk-dmp-inflation-exp-3y"],
      },
      {
        key: "dmp-own-price",
        title: "BoE Decision Maker Panel · Own-Price Expectations",
        note: "Businesses’ expected own-price growth.",
        ids: ["uk-dmp-own-price-exp-1y"],
      },
    ],
    "ea-inflation-expectations-business": [
      {
        key: "selling-prices",
        title: "ECB SAFE · Selling-Price Expectations",
        note: "Expected selling-price growth over the next year.",
        ids: ["ea-safe-selling-price-exp-1y"],
      },
      {
        key: "input-costs",
        title: "ECB SAFE · Input-Cost Expectations",
        note: "Expected non-labour input-cost growth over the next year.",
        ids: ["ea-safe-input-cost-exp-1y"],
      },
      {
        key: "wages",
        title: "ECB SAFE · Wage Expectations",
        note: "Businesses’ expected wage growth over the next year.",
        ids: ["ea-safe-wage-exp-1y"],
      },
    ],
    "ea-inflation-expectations-wage": [
      {
        key: "wage-tracker",
        title: "ECB Wage Tracker",
        note: "Agreed wage growth, including and excluding one-off payments.",
        ids: ["ea-wage-tracker", "ea-wage-tracker-ex-oneoff"],
      },
      {
        key: "spf-wages",
        title: "ECB SPF · Wage Expectations",
        note: "Professional forecasters’ wage and labour-cost outlook.",
        ids: ["ea-spf-wage-exp-1y"],
      },
    ],
  };

  const explicit = explicitGroups[spec.id];
  if (explicit) {
    const groups = explicit.map((group) => ({
      ...group,
      series: group.ids
        .filter((id) => Boolean(allMetrics[id]))
        .map((id) => expectationSeries(allMetrics, id)),
    })).filter((group) => group.series.length > 0);

    if (groups.length) {
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => (
            <ExpectationComparisonChart
              key={`${spec.id}-${group.key}`}
              title={group.title}
              note={group.note}
              series={group.series}
            />
          ))}
        </div>
      );
    }
  }

  if (!grouped.size) {
    return (
      <div className="expectation-comparison-empty" role="status">
        No historical observations are available for this expectation group yet.
      </div>
    );
  }

  const horizonOrder = [
    "1Y",
    "2Y",
    "3Y",
    "4Y",
    "5Y",
    "5–10Y",
    "5Y5Y",
    "10Y",
    "30Y",
  ];

  const charts = [
    ...grouped.entries(),
  ].sort(([a], [b]) => {
    const ai =
      horizonOrder.indexOf(a);
    const bi =
      horizonOrder.indexOf(b);

    if (
      ai !== -1 &&
      bi !== -1
    ) {
      return ai - bi;
    }

    if (ai !== -1) return -1;
    if (bi !== -1) return 1;

    return a.localeCompare(b);
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {charts.map(
        ([horizon, horizonSeries]) => (
          <ExpectationComparisonChart
            key={`${spec.id}-${horizon}`}
            title={`${horizon} Expectations`}
            note={expectationChartNote(horizon, horizonSeries)}
            series={horizonSeries}
          />
        )
      )}
    </div>
  );
}
function collectMetricIds(nodes: UiNode[] | undefined): string[] {
  const out: string[] = [];
  const walk = (xs: UiNode[]) => {
    for (const node of xs) {
      if (node.metricId) out.push(node.metricId);
      if (node.momMetricId) out.push(node.momMetricId);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes ?? []);
  return out;
}

function getNodeMetricKpis(
  node: UiNode,
  metric: DetailPayload | undefined,
  allMetrics: Record<string, DetailPayload | undefined>
) {
  if (!metric) return null;

  // Some aggregate component nodes are backed by separate published YoY
  // and MoM series rather than an index series from which both can be derived.
  if (node.momMetricId) {
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: metric.history?.at(-1)?.value ?? null,
      rightLabel: "MoM",
      rightValue: allMetrics[node.momMetricId]?.history?.at(-1)?.value ?? null,
      showRight: true,
    };
  }

  return getMetricKpis(metric);
}

function ExpectationKpis({
  spec,
  allMetrics,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  if (!spec.expectationGroup) return null;

  const ids = [...new Set([
    ...collectMetricIds(spec.components),
    ...(spec.chartMetricIds ?? []),
  ])];
  const items = ids.map((id) => allMetrics[id]).filter((payload): payload is DetailPayload => Boolean(payload));
  const value = (payload: DetailPayload | undefined) => getPublishedExpectationReadingsAsOf(payload?.history ?? []).at(-1)?.value ?? null;
  const fmt = (payload: DetailPayload | undefined) => {
    const v = value(payload);
    return formatExpectationValue(payload, v);
  };

  return (
    <div className="expectation-kpi-grid grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((payload) => (
        <div className="rate-box" key={payload.meta.id}>
          <span>{payload.meta.shortName || payload.meta.name}</span>
          <strong>{fmt(payload)}</strong>
          <small>{getPublishedExpectationReadingsAsOf(payload.history ?? []).at(-1)?.date ? formatObsDate(getPublishedExpectationReadingsAsOf(payload.history ?? []).at(-1)!.date) : "—"}</small>
        </div>
      ))}
    </div>
  );
}

function ClaimsKpis({
  initial,
  continuing,
}: {
  initial: DetailPayload | undefined;
  continuing: DetailPayload | undefined;
}) {
  return (
    <>
      {[
        { id: "us-initial-claims", label: "Initial Claims", payload: initial },
        { id: "us-continuing-claims", label: "Continuing Claims", payload: continuing },
      ].map((claim) => {
        const latest = normalizeHistory(claim.payload?.history ?? []).at(-1);
        const latestValue = latest?.value ?? claim.payload?.meta.latest?.value ?? null;
        const latestDate = latest?.date ?? claim.payload?.meta.latest?.date;
        const averageValue = normalizeHistory(claim.payload?.threeMonth?.history ?? []).at(-1)?.value ?? null;
        return (
          <div className="drawer-kpi" key={claim.id}>
            <span>{claim.label}</span>
            <strong style={{ display: "block", marginTop: 4 }}>
              {formatClaimsCount(latestValue)}
            </strong>
            <small style={{ display: "block", marginTop: 4, color: "var(--muted)" }}>
              {latestDate ? formatObsDate(latestDate) : "Latest published week"}
            </small>
            {claim.payload?.threeMonth && <>
              <span style={{ display: "block", marginTop: 10 }}>{claim.payload.threeMonth.label}</span>
              <strong style={{ display: "block", marginTop: 4 }}>{formatClaimsCount(averageValue)}</strong>
            </>}
          </div>
        );
      })}
    </>
  );
}

function ExpectationComponentsTable({
  spec,
  allMetrics,
  onComponentOpen,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const rows = [...new Set([
    ...collectMetricIds(spec.components),
    ...(spec.chartMetricIds ?? []),
  ])]
    .map((id) => allMetrics[id])
    .filter((payload): payload is DetailPayload => Boolean(payload));

  return (
    <div className="expectation-data-table overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="min-w-[900px] w-full text-left text-[11px]">
        <thead>
  <tr>
    <th className="px-3 py-2">Name</th>
    <th className="px-3 py-2">Short Name</th>
    <th className="px-3 py-2 text-right">Latest</th>
    <th className="px-3 py-2 text-right">Prior</th>
    <th className="px-3 py-2">Unit</th>
    <th className="px-3 py-2">Frequency</th>
    <th className="px-3 py-2">Source</th>
    <th className="px-3 py-2">Latest period</th>
    <th className="px-3 py-2">Released</th>
    <th className="px-3 py-2"></th>
  </tr>
</thead>
        <tbody>
          {rows.map((payload) => (
            <tr key={payload.meta.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-2 font-medium text-[var(--ink)]">{payload.meta.name}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.shortName}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatExpectationValue(payload, payload.history.at(-1)?.value)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatExpectationValue(payload, payload.history.at(-2)?.value)}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.unit}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.frequency}</td>
              <td className="px-3 py-2 text-[var(--muted)]">
                {formatLiveSourceLabel(payload.meta.liveSource)}
                {payload.meta.officialUrl && (
                  <a href={payload.meta.officialUrl} target="_blank" rel="noreferrer" className="expectation-source-link ml-1" aria-label={`Open official series source for ${payload.meta.shortName}`}>
                    ↗
                  </a>
                )}
              </td>
              <td className="px-3 py-2 text-[var(--muted)]">{getLatestPeriodDate(payload) ? formatObsDate(getLatestPeriodDate(payload)!) : "—"}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{(payload.displayReleasedAt ?? payload.releases?.at(-1)?.releasedAt) ? formatObsDate((payload.displayReleasedAt ?? payload.releases?.at(-1)?.releasedAt)!) : "—"}</td>
              <td className="px-3 py-2 text-right">
  <button
    type="button"
    className="component-detail-button"
    style={{
      position: "relative",
      zIndex: 3,
      transform: "translateX(-20px)",
    }}
    onClick={(e) => {
      e.stopPropagation();
      onComponentOpen(payload.meta.id);
    }}
    aria-label={`View ${
      payload.meta.shortName || payload.meta.name
    } details`}
  >
    <ChevronRight size={16} />
  </button>
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getInflationDistributionNodes(nodes: UiNode[]): UiNode[] {
  const leaves: UiNode[] = [];

  const walk = (items: UiNode[]) => {
    items.forEach((node) => {
      if (node.metricId) {
        leaves.push(node);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    });
  };

  walk(nodes);
  return leaves;
}

function InflationDistribution({
  nodes,
  metrics,
  latestPeriod,
}: {
  nodes: UiNode[];
  metrics: Record<string, DetailPayload | undefined>;
  latestPeriod?: string | null;
}) {
  const rows = getInflationDistributionNodes(nodes)
    .map((node) => {
      const metric = node.metricId ? metrics[node.metricId] : undefined;
      if (!metric) return null;

      const rates = calculateRates(
        metric.history ?? [],
        metric.meta.transform,
        metric.meta.frequency,
        metric.meta.id
      );

      const value = Number(rates.yoy);
      if (!Number.isFinite(value)) return null;

      return {
        id: node.id,
        label: node.label,
        value,
      };
    })
    .filter((row): row is { id: string; label: string; value: number } => Boolean(row))
    .sort((a, b) => b.value - a.value);

  if (!rows.length) return null;

  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <section className="inflation-distribution">
      <div className="inflation-distribution-head">
        <div>
          <h3>Inflation Distribution</h3>
          <p>
            Current component YoY readings
            {latestPeriod ? ` · ${formatObsDate(latestPeriod)}` : ""}
          </p>
        </div>
        <span>{YEAR} only</span>
      </div>

      <div className="inflation-distribution-grid">
        {rows.map((row) => {
          const positive = row.value >= 0;
          const width = Math.max(
            4,
            Math.min(100, (Math.abs(row.value) / maxAbs) * 100)
          );

          return (
            <div className="inflation-distribution-row" key={row.id}>
              <div className="inflation-distribution-label" title={row.label}>
                {row.label}
              </div>
              <div className="inflation-distribution-track">
                <span
                  className={clsx(
                    "inflation-distribution-bar",
                    positive ? "positive" : "negative"
                  )}
                  style={{ width: `${width}%` }}
                />
                <span className="inflation-distribution-zero" />
              </div>
              <div
                className={clsx(
                  "inflation-distribution-value",
                  positive ? "positive" : "negative"
                )}
              >
                {pct(row.value)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComponentDetailDrawer({
  region,
  metricId,
  allMetrics,
  components = [],
  onClose,
}: {
  region: Region;
  metricId: string;
  allMetrics: Record<string, DetailPayload | undefined>;
  components?: UiNode[];
  onClose: () => void;
}) {
  const requestedMetric = allMetrics[metricId];

  if (!requestedMetric) return null;

  const componentMeasures = getPublishedComponentMeasureIds(requestedMetric.meta.id);
  const spec = normalizeUnderlyingInflationDetailSpec({
    id: `${requestedMetric.meta.id}-component`,
    title: requestedMetric.meta.shortName || requestedMetric.meta.name,
    metricId: requestedMetric.meta.id,
    ...componentMeasures,
  });
  const metric = allMetrics[spec.metricId] ?? requestedMetric;

  const cardKpis = getCardKpis(spec, metric, allMetrics);
  const isExpectation = isPublishedExpectationMetric(metric);
  const latestPeriodDate = getLatestPeriodDate(metric);

  const renderKpi = (value: number | null | undefined) => {
    if (isExpectation) return formatExpectationValue(metric, value);
    if (cardKpis.mode === "absolute-change") return formatAbsoluteChangeValue(value, metric);
    if (cardKpis.mode === "normal") {
      return percentagePointIds.has(metric.meta.id)
        ? pp(value)
        : pct(value);
    }

    return formatMetricValue(value, metric);
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        padding: 18,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <aside
        className="detail-drawer flight-deck-drawer flight-deck-series-dialog"
        role="dialog"
        aria-modal="true"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(920px, calc(100vw - 32px))",
          maxWidth: 920,
          height: "min(72vh, 660px)",
          maxHeight: "72vh",
          minHeight: 0,
          overflow: "hidden",
          boxSizing: "border-box",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,.38)",
        }}
      >
        <div
          className="drawer-header"
          style={{
            flex: "0 0 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            padding: "18px 20px 9px",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="eyebrow">
              {region} · {metric.meta.category?.toUpperCase() ?? ""}
            </div>

            <div
              className="drawer-title-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  minWidth: 0,
                  color: "var(--text)",
                  lineHeight: 1.12,
                  fontSize: "clamp(24px, 3vw, 34px)",
                  letterSpacing: "-0.02em",
                }}
              >
                {displayMetricTitle(spec, metric)}
              </h2>

              <MetricBadge importance={metric.meta.importance} />
            </div>

            <p
              style={{
                margin: "8px 0 0",
                lineHeight: 1.45,
                color: "var(--muted)",
                overflowWrap: "anywhere",
              }}
            >
              {metric.meta.releaseName || "Official data series"}
              {` · Live source: ${formatLiveSourceLabel(metric.meta.liveSource)}`}
              {metric.meta.frequency ? ` · ${metric.meta.frequency}` : ""}
            </p>
          </div>

          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            style={{
              flex: "0 0 auto",
              width: 40,
              height: 40,
              minWidth: 40,
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={21} />
          </button>
        </div>

        <div
          className="drawer-release"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
            minWidth: 0,
            padding: "10px 24px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span>Release date: <b>{metric.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"}</b></span>
          <span>Latest period: <b>{latestPeriodDate ? formatObsDate(latestPeriodDate) : "—"}</b></span>
          <span>Live source: <b>{formatLiveSourceLabel(metric.meta.liveSource)}</b></span>
          <span>Frequency: <b>{metric.meta.frequency ?? "—"}</b></span>
          {displayReleaseStage(metric.meta.releaseStage) && <span>Data type: <b>{displayReleaseStage(metric.meta.releaseStage)}</b></span>}
        </div>

        <div
          className="drawer-kpis"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: cardKpis.showRight
              ? "repeat(2, minmax(0, 1fr))"
              : "minmax(0, 1fr)",
            gap: 14,
            minWidth: 0,
            padding: "16px 24px 18px",
          }}
        >
          <div
            className="drawer-kpi"
            style={{
              minWidth: 0,
              background: "var(--panel-2, var(--panel))",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <span>{cardKpis.leftLabel}</span>
            <strong
              className={
                cardKpis.mode === "normal"
                  ? changeColor(cardKpis.leftValue)
                  : ""
              }
              style={{ display: "block", marginTop: 4 }}
            >
              {renderKpi(cardKpis.leftValue)}
            </strong>
          </div>

          {cardKpis.showRight && (
            <div
              className="drawer-kpi"
              style={{
                minWidth: 0,
                background: "var(--panel-2, var(--panel))",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <span>{cardKpis.rightLabel}</span>
              <strong
                className={
                  cardKpis.mode === "normal"
                    ? changeColor(cardKpis.rightValue)
                    : ""
                }
                style={{ display: "block", marginTop: 4 }}
              >
                {renderKpi(cardKpis.rightValue)}
              </strong>
            </div>
          )}
        </div>

        <div
          className="drawer-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
  className="drawer-scroll-inner"
  style={{
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "0 24px 28px",
    overflow: "visible",
  }}
>
            <section
  className="drawer-chart"
  style={{
    width: "100%",
    minWidth: 0,
    margin: "0 0 18px",
    padding: 16,
    boxSizing: "border-box",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    overflow: "visible",
  }}
>
              <div
                className="drawer-section-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, color: "var(--text)" }}>
                  {displayMetricTitle(spec, metric)}
                </h3>
                <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                  Last 12 months
                </span>
              </div>

              <div
  style={{
    width: "100%",
    minWidth: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
  <RateChart
    spec={spec}
    root={metric}
    allMetrics={allMetrics}
    height={360}
    showRetailSalesBoth={metric.meta.id === "us-retail-sales-total"}
  />
</div>
            </section>

            {metric.meta.category?.toLowerCase().includes("inflation") && components.length > 0 && (
              <InflationDistribution
                nodes={components}
                metrics={allMetrics}
                latestPeriod={latestPeriodDate}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailDrawer({
  region,
  spec,
  root,
  allMetrics,
  onClose,
  onComponentOpen,
}: {
  region: Region;
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
  onClose: () => void;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selectedSeriesId, setSelectedSeriesId] = useState(spec.metricId);
  const [driverTab, setDriverTab] = useState<"history" | "drivers">(
    (region === "EA" && spec.metricId.startsWith("ea-ppi-") && spec.id !== "ea-ppi-card") || ["us-retail-sales-card", "us-retail-sales-control-card", "uk-retail-sales-card", "ea-retail-sales-card"].includes(spec.id) ? "drivers" : "history"
  );
  const hasContributions = Boolean(CONTRIBUTION_CONFIGS[spec.metricId]);
  const isUkWageCard = region === "UK" && spec.id === "uk-wages-card";
  const isEaWageCard = region === "EA" && spec.id === "ea-wages-card";
  const isUsJoltsCard = region === "US" && spec.id === "us-jolts-card";
  const isUsCpiDriverCard = region === "US" && ["us-cpi", "us-cpi-core"].includes(spec.metricId);
  const isUsPpiDriverCard = region === "US" && (spec.metricId === "us-ppi-final-demand" || spec.metricId.startsWith("us-ppi-intermediate-"));
  const isUkInflationDriverCard = region === "UK" && ["uk-cpi-yoy", "uk-cpih-yoy"].includes(spec.metricId);
  const isUkPpiDriverCard = region === "UK" && spec.metricId.startsWith("uk-ppi-");
  const isEaHicpDriverCard = region === "EA" && ["ea-hicp-yoy", "ea-core-hicp-yoy", "ea-food-hicp-yoy", "ea-energy-hicp-yoy", "ea-goods-hicp-yoy", "ea-services-hicp-yoy"].includes(spec.metricId);
  const isEaPpiDriverCard = region === "EA" && spec.metricId.startsWith("ea-ppi-");
  const isEaPpiOverviewCard = region === "EA" && spec.id === "ea-ppi-card";
  const isEaPpiComponentCard = isEaPpiDriverCard && !isEaPpiOverviewCard;
  const isUsPceDriverCard = region === "US" && ["us-pce-card", "us-core-pce-card"].includes(spec.id);
  const isCorePceDriverCard = spec.id === "us-core-pce-card";
  const isRetailDriverCard = ["us-retail-sales-card", "us-retail-sales-control-card", "uk-retail-sales-card", "ea-retail-sales-card"].includes(spec.id)
    || (region === "UK" && ["uk-retail-sales-total-ex-fuel", "uk-retail-sales-ex-fuel"].includes(spec.metricId))
    || (region === "US" && ["us-retail-sales-total", "us-retail-sales-control-group"].includes(spec.metricId))
    || (region === "EA" && ["ea-retail-sales-total-ex-motor-vehicles", "ea-retail-sales-ex-fuel"].includes(spec.metricId));
  const showDriversOnly = isUsCpiDriverCard || isUsPpiDriverCard || isUkInflationDriverCard || isUkPpiDriverCard || isEaHicpDriverCard || isEaPpiOverviewCard || isUsPceDriverCard;
  const hasDriverView = hasContributions || isUsPpiDriverCard || isUkPpiDriverCard || isEaHicpDriverCard || isEaPpiDriverCard || isRetailDriverCard || isUsPceDriverCard;

  const rateSpec = normalizeUnderlyingInflationDetailSpec(spec);
  const rateRoot = allMetrics[rateSpec.metricId] ?? root;
  const cardKpis = getCardKpis(rateSpec, rateRoot, allMetrics, "detail");
  // UK PPI subcomponents are attached to the published Output/Input parent
  // nodes in the hierarchy. Recover them from that source if a caller opened
  // a parent using a lightweight spec that omitted its nested children.
  const ukPpiChildren = region === "UK" && spec.metricId.startsWith("uk-ppi-")
    ? DASHBOARD.UK.prices
      .find((item) => item.id === "uk-ppi-card")
      ?.components?.find((node) => node.metricId === spec.metricId)?.children
    : undefined;
  const allNodes = stableDetailNodes(
    spec.components?.length ? spec.components : ukPpiChildren
  );
  const retailComponentNodes = region === "US"
    ? DASHBOARD.US.activity.find((item) => item.id === "us-retail-sales-card")?.components ?? allNodes
    : region === "EA"
      ? DASHBOARD.EA.activity.find((item) => item.id === "ea-retail-sales-card")?.components ?? allNodes
      : allNodes;
  const pceHeadlineComponents = DASHBOARD.US.prices.find((item) => item.id === "us-pce-card")?.components ?? [];
  const corePceExcludedIds = new Set(["us-pce-food", "us-pce-energy"]);
  const withoutCorePceExclusions = (nodes: UiNode[]): UiNode[] => nodes
    .filter((node) => !node.metricId || !corePceExcludedIds.has(node.metricId))
    .map((node) => ({ ...node, children: node.children ? withoutCorePceExclusions(node.children) : undefined }));
  const corePceComponents: UiNode[] = isCorePceDriverCard
    ? withoutCorePceExclusions(pceHeadlineComponents)
    : [];
  const flightDeckRows: Array<{ node: UiNode; depth: number; group: string; parentIds: string[]; hasChildren: boolean }> = [];
  const collectFlightDeckRows = (nodes: UiNode[], depth = 0, group = "", parentIds: string[] = []) => {
    nodes.forEach((node) => {
      const payload = node.metricId ? allMetrics[node.metricId] : undefined;
      const hasChildren = Boolean(node.children?.length);
      if ((payload && (payload.meta.id !== spec.metricId || spec.id === "us-claims-card")) || hasChildren) {
        flightDeckRows.push({ node, depth, group: group || spec.title || "Component", parentIds, hasChildren });
      }
      if (hasChildren) collectFlightDeckRows(node.children!, depth + 1, payload ? node.label : group, [...parentIds, node.id]);
    });
  };
  collectFlightDeckRows(allNodes);
  const latestPeriodDate = getLatestPeriodDate(root);
  const expectationMetricIds = [...new Set([
    ...collectMetricIds(allNodes),
    ...(spec.chartMetricIds ?? []),
  ])];
  const expectationPayloads = expectationMetricIds
    .map((id) => allMetrics[id])
    .filter((payload): payload is DetailPayload => Boolean(payload));
  const expectationSources = [...new Set(expectationPayloads
    .map((payload) => payload.meta.liveSource ? formatLiveSourceLabel(payload.meta.liveSource) : null)
    .filter((source): source is string => Boolean(source)))];
  const expectationFrequencies = [...new Set(expectationPayloads
    .map((payload) => payload.meta.frequency?.trim())
    .filter((frequency): frequency is string => Boolean(frequency)))];
  const latestExpectationRelease = expectationPayloads
    .flatMap((payload) => [payload.displayReleasedAt, payload.releases?.at(-1)?.releasedAt])
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  const isExpectation =
    spec.id.includes("expectations_") ||
    root?.meta.subcategory?.startsWith("expectations_") ||
    isInflationExpectationSpecId(spec);
  if (isExpectation && flightDeckRows.length === 0) {
    expectationPayloads.forEach((payload) => flightDeckRows.push({
      node: { id: payload.meta.id, label: payload.meta.shortName || payload.meta.name, metricId: payload.meta.id },
      depth: 0,
      group: spec.title || "Expectations",
      parentIds: [],
      hasChildren: false,
    }));
  }
  const effectiveSelectedSeriesId = flightDeckRows.some(({ node }) => node.metricId === selectedSeriesId)
    ? selectedSeriesId
    : flightDeckRows[0]?.node.metricId ?? spec.metricId;
  const isUSClaimsCard = spec.id === "us-claims-card" || root?.meta.id === "us-initial-claims";

  useEffect(() => {
    setOpen(Object.fromEntries(allNodes.filter((node) => node.children?.length).map((node) => [node.id, true])));
    setSelectedSeriesId(flightDeckRows[0]?.node.metricId ?? spec.metricId);
  }, [spec.id, spec.metricId, allNodes]);

  const renderNode = (node: UiNode, depth = 0): React.ReactNode => {
    const d = node.metricId ? allMetrics[node.metricId] : undefined;
    const componentKpis = getNodeMetricKpis(node, d, allMetrics);
    const officialWeight = getOfficialComponentWeight(node.metricId);
    const hasChildren = !!node.children?.length;
    const expanded = !!open[node.id];

    const renderValue = (value: number | null | undefined) => {
      if (!d || !componentKpis) return "—";
      if (componentKpis.mode === "normal") {
        return percentagePointIds.has(d.meta.id) ? pp(value) : pct(value);
      }
      return formatMetricValue(value, d);
    };

    const currentLatest = getLatestPeriodDate(d);

    return (
      <div
        key={`${node.id}-${depth}`}
        className={clsx("drawer-node", depth > 0 && "drawer-node-child")}
        style={{ width: "100%", minWidth: 0 }}
      >
        <div
          className={clsx("drawer-row", hasChildren && "drawer-group")}
          style={{
            display: "grid",
            gridTemplateColumns: "24px minmax(150px, 1.2fr) 78px 78px minmax(110px, 1fr) 30px",
            alignItems: "center",
            columnGap: 4,
            width: "100%",
            minWidth: 0,
            minHeight: 56,
            padding: "7px 10px",
            boxSizing: "border-box",
            background: hasChildren
              ? "var(--panel-2, var(--panel))"
              : "var(--panel)",
            borderTop: "1px solid var(--line)",
            cursor: d ? "pointer" : "default",
          }}
          onClick={() => d && setSelectedSeriesId(d.meta.id)}
        >
          <button
            type="button"
            className="node-toggle"
            onClick={() => {
              if (hasChildren) {
                setOpen((v) => ({ ...v, [node.id]: !expanded }));
              }
            }}
            aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
            style={{
              width: 30,
              height: 30,
              minWidth: 30,
              display: "grid",
              placeItems: "center",
              justifySelf: "center",
              padding: 0,
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          >
            {hasChildren ? (
              expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
            ) : (
              <span className="node-dot" />
            )}
          </button>

          <div
            className="node-name"
            style={{
              minWidth: 0,
              color: "var(--text)",
              fontWeight: hasChildren ? 700 : 500,
              fontSize: depth > 0 ? 12 : 13,
              lineHeight: 1.35,
              overflowWrap: "anywhere",
              whiteSpace: "normal",
              paddingLeft: depth ? Math.min(depth * 16, 32) : 0,
            }}
          >
            <span>{node.label}</span>
            {officialWeight && <small className="flight-deck-weight">Basket weight {formatOfficialComponentWeight(officialWeight.value)}</small>}
            {!d && !hasChildren && <small className="flight-deck-unmapped">Official category · detailed series unavailable</small>}
          </div>

          <div
            className="node-rate"
            style={{
              minWidth: 0,
              textAlign: "right",
              color: "var(--text)",
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
              {isExpectation
                ? formatExpectationValue(d, d?.history?.at(-1)?.value)
                : renderValue(componentKpis?.leftValue)}
          </div>

          <div
            className="node-rate"
            style={{
              minWidth: 0,
              textAlign: "right",
              color: "var(--text)",
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
              {isExpectation
                ? formatExpectationValue(d, d?.history?.at(-2)?.value)
              : componentKpis?.showRight
                ? renderValue(componentKpis.rightValue)
                : "—"}
          </div>

          <div
            className="node-trend"
            style={{
              minWidth: 0,
              width: "100%",
              height: 34,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
            }}
          >
            {isExpectation ? (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {currentLatest ? formatObsDate(currentLatest) : "—"}
              </span>
            ) : d ? (
              <Spark
                data={d.history}
                frequency={d.meta.frequency}
                compact
              />
            ) : (
              <span style={{ color: "var(--muted)" }}>—</span>
            )}
          </div>

          {d && <button
            type="button"
            className="component-detail-button"
            onClick={(e) => {
              e.stopPropagation();
              if (d?.meta.id) onComponentOpen(d.meta.id, node.children ?? []);
            }}
            aria-label={`View ${node.label} details`}
            style={{
              width: 30,
              height: 30,
              minWidth: 30,
              display: "grid",
              placeItems: "center",
              justifySelf: "end",
              padding: 0,
              borderRadius: 8,
              boxSizing: "border-box",
              marginRight: 0,
            }}
          >
            <ChevronRight size={16} />
          </button>}
        </div>

        {hasChildren && expanded && (
          <div
            className="drawer-children"
            style={{
              width: "100%",
              minWidth: 0,
              margin: 0,
              padding: 0,
              boxSizing: "border-box",
              borderLeft: "1px solid var(--line)",
              background: "rgba(255,255,255,.012)",
            }}
          >
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const componentLeftHeader = cardKpis.leftLabel;
  const componentRightHeader = cardKpis.showRight ? cardKpis.rightLabel : "";

  const renderKpi = (value: number | null | undefined) => {
    if (cardKpis.mode === "absolute-change") return formatAbsoluteChangeValue(value, rateRoot);
    if (cardKpis.mode === "normal") {
      return percentagePointIds.has(spec.metricId) ? pp(value) : pct(value);
    }
    return formatMetricValue(value, root);
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        padding: 14,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <aside
        className={clsx("detail-drawer", "flight-deck-drawer", allNodes.length > 0 && "has-component-field", isExpectation && "flight-deck-expectations", isUsPpiDriverCard && "us-ppi-demand-card", (isUkPpiDriverCard || isEaPpiDriverCard || isEaHicpDriverCard) && "ppi-drivers-card")}
        role="dialog"
        aria-modal="true"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(980px, calc(100vw - 32px))",
          maxWidth: 980,
          height: "min(78vh, 720px)",
          maxHeight: "78vh",
          minHeight: 0,
          overflow: "hidden",
          boxSizing: "border-box",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,.38)",
        }}
      >
        <div
          className="drawer-header"
          style={{
            flex: "0 0 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            padding: "18px 20px 9px",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="eyebrow">
              {region} · {root?.meta.category?.toUpperCase() ?? ""}
            </div>

            <div
              className="drawer-title-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  minWidth: 0,
                  color: "var(--text)",
                  lineHeight: 1.12,
                  fontSize: "clamp(26px, 3vw, 36px)",
                  letterSpacing: "-0.02em",
                }}
              >
                {displayMetricTitle(spec, root)}
              </h2>

              <MetricBadge importance={root?.meta.importance} />
            </div>

            <p
              style={{
                margin: "8px 0 0",
                lineHeight: 1.45,
                color: "var(--muted)",
                overflowWrap: "anywhere",
              }}
            >
              {isExpectation
                ? spec.expectationGroup === "consumer"
                  ? region === "EA"
                    ? "ECB Consumer Expectations Survey (CES)"
                    : "BoE Inflation Attitudes Survey + Citi/YouGov"
                  : spec.expectationGroup === "business"
                    ? region === "EA"
                      ? "ECB SAFE Survey"
                      : region === "UK"
                        ? "BoE Decision Maker Panel"
                        : "Atlanta Fed BIE + Cleveland Fed SoFIE"
                    : spec.expectationGroup === "market"
                      ? region === "EA"
                        ? "Euro Area Inflation Compensation"
                        : region === "UK"
                          ? "UK Inflation Swaps"
                          : "5Y5Y FWD + 5Y + 10Y"
                      : spec.expectationGroup === "professional"
                        ? region === "EA"
                          ? "ECB Survey of Professional Forecasters"
                          : "BoE Market Participants Survey"
                        : spec.expectationGroup === "wage"
                          ? region === "EA"
                            ? "ECB Wage Tracker + ECB SPF"
                            : region === "UK"
                            ? "BoE DMP"
                              : "New York Fed SCE + Atlanta Fed Wage Growth Tracker"
                          : "Inflation expectations"
                : `${root?.meta.releaseName ?? "Official data series"} · Live source: ${formatLiveSourceLabel(root?.meta.liveSource)}${root?.meta.frequency ? ` · ${root.meta.frequency}` : ""}`}
            </p>
          </div>

          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            style={{
              flex: "0 0 auto",
              width: 40,
              height: 40,
              minWidth: 40,
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={21} />
          </button>
        </div>

        <div
          className={clsx("drawer-release", isExpectation && "expectation-release-meta")}
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: isExpectation
              ? "repeat(4, minmax(0, 1fr))"
              : "repeat(4, minmax(0, 1fr))",
            gap: 10,
            minWidth: 0,
            padding: "10px 24px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {isExpectation ? (
            <>
              <span>
                Sources: <b>{expectationSources.length ? expectationSources.join(" · ").toUpperCase() : "—"}</b>
              </span>
              <span>
                Frequency: <b>{expectationFrequencies.length ? expectationFrequencies.join(" + ") : "—"}</b>
              </span>
              <span>Latest release: <b>{latestExpectationRelease ? formatObsDate(latestExpectationRelease) : "—"}</b></span>
              <span>Coverage: <b>{spec.title ?? "Inflation expectations"}</b></span>
            </>
          ) : (
            <>
              <span>Release date: <b>{root?.displayReleasedAt ? formatObsDate(root.displayReleasedAt) : "—"}</b></span>
              <span>Latest period: <b>{latestPeriodDate ? formatObsDate(latestPeriodDate) : "—"}</b></span>
              <span>Live source: <b>{formatLiveSourceLabel(root?.meta.liveSource)}</b></span>
              <span>Frequency: <b>{root?.meta.frequency ?? "—"}</b></span>
            </>
          )}
        </div>

        {!isRetailDriverCard && <div
          className="drawer-kpis"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: isExpectation
              ? "minmax(0, 1fr)"
              : cardKpis.showRight
                ? "repeat(2, minmax(0, 1fr))"
                : "minmax(0, 1fr)",
            gap: 14,
            minWidth: 0,
            padding: "16px 24px 18px",
          }}
        >
          {spec.groupOnly ? <p style={{ margin: 0, color: 'var(--muted)', gridColumn: '1 / -1' }}>View the published component indexes below. BLS does not publish an overall Intermediate Demand rate.</p> : isExpectation ? (
            <ExpectationKpis spec={spec} allMetrics={allMetrics} />
          ) : isUSClaimsCard ? (
            <ClaimsKpis
              initial={root}
              continuing={allMetrics["us-continuing-claims"]}
            />
          ) : (
            <>
              <div
                className="drawer-kpi"
                style={{
                  minWidth: 0,
                  background: "var(--panel-2, var(--panel))",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "14px 16px",
                }}
              >
                <span>{cardKpis.leftLabel}</span>
                <strong
                  className={cardKpis.mode === "normal" ? changeColor(cardKpis.leftValue) : ""}
                  style={{ display: "block", marginTop: 4 }}
                >
                  {renderKpi(cardKpis.leftValue)}
                </strong>
              </div>

              {cardKpis.showRight && (
                <div
                  className="drawer-kpi"
                  style={{
                    minWidth: 0,
                    background: "var(--panel-2, var(--panel))",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "14px 16px",
                  }}
                >
                  <span>{cardKpis.rightLabel}</span>
                  <strong
                    className={cardKpis.mode === "normal" ? changeColor(cardKpis.rightValue) : ""}
                    style={{ display: "block", marginTop: 4 }}
                  >
                    {renderKpi(cardKpis.rightValue)}
                  </strong>
                </div>
              )}
            </>
          )}
        </div>}

        <div
          className="drawer-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
  className={clsx("drawer-scroll-inner", (isRetailDriverCard || showDriversOnly || (hasContributions && driverTab === "drivers") || (isEaPpiComponentCard && driverTab === "drivers")) && "drawer-scroll-inner--drivers")}
  style={{
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "0 24px 28px",
    overflow: "visible",
  }}
>
            {isUkInflationDriverCard && <div className="inflation-measure-toggle uk-inflation-toggle" role="group" aria-label="UK inflation measure" style={{ justifyContent: "flex-end", margin: "12px 0" }}>
              <button type="button" aria-pressed={spec.metricId === "uk-cpi-yoy"} onClick={() => onComponentOpen("uk-cpi-yoy")}>CPI</button>
              <button type="button" aria-pressed={spec.metricId === "uk-cpih-yoy"} onClick={() => onComponentOpen("uk-cpih-yoy")}>CPIH</button>
            </div>}
            {hasDriverView && !isEaPpiComponentCard && !isRetailDriverCard && !showDriversOnly && <div className="component-card-tabs" role="tablist" aria-label="Component card view"><button type="button" role="tab" aria-selected={driverTab === "history"} onClick={() => setDriverTab("history")}>History &amp; components</button><button type="button" role="tab" aria-selected={driverTab === "drivers"} onClick={() => setDriverTab("drivers")}>What’s driving it?</button></div>}
            {isRetailDriverCard ? <RetailDrivers region={region} components={retailComponentNodes} metrics={allMetrics} onComponentOpen={onComponentOpen} rootMetricId={spec.metricId} /> : showDriversOnly || (hasContributions && driverTab === "drivers") ? (isUsPceDriverCard ? <PceDrivers components={isCorePceDriverCard ? corePceComponents : allNodes} metrics={allMetrics} rootMetricId={spec.metricId} core={isCorePceDriverCard} onComponentOpen={onComponentOpen} /> : isUsPpiDriverCard || isUkPpiDriverCard || isEaPpiDriverCard || (isEaHicpDriverCard && !hasContributions) ? <PpiDrivers components={isEaHicpDriverCard ? [{ id: spec.metricId, label: spec.title ?? "HICP component", metricId: spec.metricId, momMetricId: spec.momMetricId }] : allNodes.length ? allNodes : [{ id: spec.metricId, label: spec.title ?? "PPI component", metricId: spec.metricId, momMetricId: spec.momMetricId }]} metrics={allMetrics} onComponentOpen={onComponentOpen} rootMetricId={spec.metricId} subtitle={isEaHicpDriverCard ? "Published Eurostat HICP component rates" : undefined} /> : <InflationContributions metricId={spec.metricId} metrics={allMetrics} onComponentOpen={(metricId) => onComponentOpen(metricId)} />) : <>
            <section
  className="drawer-chart"
  style={{
    width: "100%",
    minWidth: 0,
    margin: "0 0 18px",
    padding: 16,
    boxSizing: "border-box",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    overflow: "visible",
  }}
>
              <div
                className="drawer-section-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, color: "var(--text)" }}>
                  {isUSClaimsCard ? "Jobless Claims" : spec.id === "us-wages-card" ? "Wage Growth — Average Hourly Earnings (AHE)" : displayMetricTitle(spec, root)}
                </h3>
                <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                  {isExpectation ? "Historical observations" : "Last 12 months"}
                </span>
              </div>

              <div
  className={isExpectation ? "drawer-chart-content expectation-chart-content" : "drawer-chart-content"}
  style={{
    width: "100%",
    minWidth: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
  {isExpectation ? (
  <div className="expectation-chart-scroll">
    <div className="expectation-chart-content">
      <ExpectationCharts
        spec={spec}
        allMetrics={allMetrics}
      />
    </div>
  </div>
) : (
  <div className="drawer-chart-content">
    <RateChart
      spec={rateSpec}
      root={rateRoot}
      allMetrics={allMetrics}
      height={isEaPpiComponentCard || isRetailDriverCard ? 300 : 420}
    showRetailSalesBoth={["us-retail-sales-total", "us-retail-sales-control-group"].includes(rateRoot?.meta.id ?? "")}
    />
  </div>
)}
</div>
</section>

            {isEaPpiComponentCard && <><div className="component-card-tabs" role="tablist" aria-label="Component card view"><button type="button" role="tab" aria-selected={driverTab === "drivers"} onClick={() => setDriverTab((current) => current === "drivers" ? "history" : "drivers")}>What’s driving it?</button></div>{driverTab === "drivers" && <PpiDrivers components={allNodes.length ? allNodes : [{ id: spec.metricId, label: spec.title ?? "PPI component", metricId: spec.metricId, momMetricId: spec.momMetricId }]} metrics={allMetrics} onComponentOpen={onComponentOpen} rootMetricId={spec.metricId} />}</>}

            {!isUkWageCard && !isEaPpiComponentCard && !isRetailDriverCard && !isExpectation && root?.meta.category?.toLowerCase().includes("inflation") && allNodes.length > 0 && (
              <InflationDistribution nodes={allNodes} metrics={allMetrics} latestPeriod={latestPeriodDate} />
            )}

            {isUkWageCard && <UkWageComponentTable allMetrics={allMetrics} onOpen={(row) => {
              const regularId = row.id === "real-pay" ? "uk-awe-real-regular-yoy" : "uk-awe-regular-yoy";
              const totalId = row.id === "real-pay" ? "uk-awe-real-total-yoy" : "uk-awe-total-yoy";
              onComponentOpen(regularId, [{ id: `${row.id}-total`, label: "Total pay", metricId: totalId }]);
            }} />}
            {isEaWageCard && <EaWageComponentTable allMetrics={allMetrics} onOpen={(metricId) => onComponentOpen(metricId)} />}
            {isUsJoltsCard && <UsJoltsRateComponentTable allMetrics={allMetrics} onOpen={(metricId) => onComponentOpen(metricId)} />}
            {!isUkWageCard && !isEaWageCard && !isUsJoltsCard && !isEaPpiComponentCard && !isRetailDriverCard && flightDeckRows.length > 0 && (
              <section className={clsx("flight-deck-field", ["us-retail-sales-card", "uk-retail-sales-card", "ea-retail-sales-card"].includes(spec.id) && "retail-weight-field")}>
                {(() => {
                  const isRetailWeightField = ["us-retail-sales-card", "uk-retail-sales-card", "ea-retail-sales-card"].includes(spec.id);
                  return <>
                <div className="flight-deck-field-head">
                  <div><h3>The component field</h3><p>Small multiples make the published series easy to compare</p></div>
                  <span>Last 12 months · {flightDeckRows.length} series</span>
                </div>
                <div className="flight-deck-columns"><span>Series</span><span>Last 12 months</span><span>{isRetailWeightField ? "Official index weight" : "Weight"}</span><span>Published measures</span><span></span></div>
                <div className="flight-deck-rows">
                  {flightDeckRows.filter(({ parentIds }) => parentIds.every((id) => open[id])).map(({ node, depth, group, hasChildren }, index) => {
                    const payload = node.metricId ? allMetrics[node.metricId] : undefined;
                    const officialWeight = isRetailWeightField ? null : getOfficialComponentWeight(node.metricId);
                    const officialRetailWeight = isRetailWeightField ? getOfficialRetailIndexWeight(node.metricId) : null;
                    const retailWeightAvailability = isRetailWeightField ? getRetailWeightAvailability(node.metricId) : null;
                    const kpis = payload ? getMetricKpis(payload) : null;
                    const current = payload?.history?.at(-1)?.value;
                    const pair = getNodeMetricKpis(node, payload, allMetrics);
                    const miniMeasure = pair?.leftLabel === "MoM" || (pair?.leftLabel === "YoY" && pair.rightLabel === "MoM" && pair.rightValue != null)
                      ? "mom"
                      : pair?.leftLabel === "YoY"
                        ? "yoy"
                        : "raw";
                    const miniSeries = payload ? selectComponentMiniSeries(node, payload, allMetrics, miniMeasure) : null;
                    const trendPoints = filterHistoryToTrailing12Months(miniSeries?.data ?? []);
                    const trendSpan = trendPoints.length
                      ? `${formatChartDate(trendPoints[0].date, miniSeries?.frequency, true)} — ${formatChartDate(trendPoints.at(-1)!.date, miniSeries?.frequency, true)}`
                      : "Last 12 months";
                    const formatPairValue = (value: number | null | undefined) => {
                      if (value == null || !Number.isFinite(value)) return "—";
                      if (pair?.mode === "normal" || pair?.mode === "published-growth") {
                        return percentagePointIds.has(payload!.meta.id) ? pp(value) : pct(value);
                      }
                      return formatMetricValue(value, payload);
                    };
                    const leftValue = !payload || !pair ? "—" : isExpectation ? formatExpectationValue(payload, current) : formatPairValue(pair.leftValue);
                    const rightValue = !payload || !pair || !pair.showRight ? "—" : isExpectation ? "" : formatPairValue(pair.rightValue);
                    const leftLabel = isExpectation ? "Reading" : pair?.leftLabel ?? "";
                    const rightLabel = !isExpectation && pair?.showRight ? pair.rightLabel : "";
                    const chosen = Boolean(payload && effectiveSelectedSeriesId === payload.meta.id);
                    return <div key={node.id} className={clsx("flight-deck-row", chosen && "is-selected", `tone-${index % 4}`, hasChildren && "is-group", depth > 0 && "is-subcomponent")}>
                      <span className="flight-deck-series-name" style={{ paddingLeft: isUsPpiDriverCard ? depth * 16 : Math.min(depth * 12, 24) }}>
                        <button type="button" className="flight-deck-disclosure" aria-label={`${open[node.id] ? "Collapse" : "Expand"} ${node.label}`} onClick={() => hasChildren && setOpen((currentOpen) => ({ ...currentOpen, [node.id]: !currentOpen[node.id] }))}>
                          {hasChildren ? open[node.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span className="flight-deck-dot" />}
                        </button>
                        <button type="button" className="flight-deck-name-copy" onClick={() => payload && setSelectedSeriesId(payload.meta.id)}><b>{node.label}</b>{payload && <small>{group}{payload.meta.unit ? ` · ${payload.meta.unit}` : ""}</small>}</button>
                      </span>
                      <span className="flight-deck-spark">{payload && miniSeries?.data.length ? <><Spark data={miniSeries.data} frequency={miniSeries.frequency} compact /><small>{trendSpan}</small></> : <small>{hasChildren ? "Select to expand category" : "Published trend unavailable"}</small>}</span>
                      <span className="flight-deck-component-weight">{officialRetailWeight ? <a href={officialRetailWeight.source} target="_blank" rel="noreferrer" title={`${officialRetailWeight.basis}; ${officialRetailWeight.year} share of all UK retailing`}>{formatOfficialRetailIndexWeight(officialRetailWeight.value)}</a> : isRetailWeightField && retailWeightAvailability ? <a href={retailWeightAvailability.source} target="_blank" rel="noreferrer" title={retailWeightAvailability.explanation}>{retailWeightAvailability.label}</a> : officialWeight ? <a href={officialWeight.source} target="_blank" rel="noreferrer" title={`${officialWeight.basis}; share of the full basket`}>{formatOfficialComponentWeight(officialWeight.value)}</a> : <span title="No applicable published component weight is mapped">—</span>}</span>
                      <span className="flight-deck-measures" style={{ gridColumn: "4 / 6" }}>
                        <span className="flight-deck-value">{leftValue}<small>{leftLabel}</small></span>
                        {rightLabel && <span className="flight-deck-value">{rightValue}<small>{rightLabel}</small></span>}
                      </span>
                      <span className="flight-deck-action">{payload && <button type="button" aria-label={`Open ${node.label} component card`} onClick={() => onComponentOpen(payload.meta.id, node.children ?? [])}><ChevronRight size={16} /></button>}</span>
                    </div>;
                  })}
                </div>
                <p className="flight-deck-note">{isRetailWeightField ? <>UK values use ONS 2025 percentages of all retailing; Non-Food Stores sums ONS-published non-food groups, and Total ex Fuel is the complement of the published fuel share. US Census category series are sales estimates, not a fixed-weight index. Eurostat uses 2021 turnover weights; some detailed weights are confidential and public weights have not yet been mapped here. Select a value or status for its official source and definition.</> : <>Weight shows the published 2026 share of the full CPI/CPIH/HICP basket. Select a weight to view its source. — means no applicable published weight is mapped.</>}</p>
                {spec.id === "us-pce-card" && <p className="flight-deck-note">Headline PCE is grouped into goods and services. Core PCE excludes food and energy and remains a separate aggregate.</p>}
                  </>;
                })()}
              </section>
            )}
            </>}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function CountryDashboard({
  region,
}: {
  region: string;
}) {
  const r = region.toUpperCase() as Region;
  
const [theme, setTheme] = useState<"light" | "dark">("light");

useEffect(() => {
  const saved = window.localStorage.getItem("macrohub-editorial-theme");

  const initialTheme =
    saved === "dark" ? "dark" : "light";

  setTheme(initialTheme);
  document.documentElement.dataset.theme = initialTheme;
  window.localStorage.setItem("macrohub-editorial-theme", initialTheme);
}, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("macrohub-editorial-theme", nextTheme);
  };

  const [metrics, setMetrics] = useState<Record<string, DetailPayload>>(
    () => getClientJsonCache<Record<string, DetailPayload>>(`dashboard:${r}`) ?? {}
  );

  const [selected, setSelected] =
    useState<IndicatorSpec | null>(null);
  const [studioSelections, setStudioSelections] = useState<Partial<Record<MacroCategory, string>>>({});
    const [selectedComponent, setSelectedComponent] =
  useState<{ metricId: string; children: UiNode[] } | null>(null);

  const [loading, setLoading] = useState(
    () => getClientJsonCache<Record<string, DetailPayload>>(`dashboard:${r}`) == null
  );

  const [error, setError] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(false);
  const [recentReleaseMetricId, setRecentReleaseMetricId] = useState<string | null>(null);
  const [highlightedMetricId, setHighlightedMetricId] = useState<string | null>(null);
  const [releaseToasts, setReleaseToasts] = useState<DashboardToast[]>([]);
  const highlightTimer = useRef<number | null>(null);

  const specsByCategory = DASHBOARD[r];

  const openMetric = useCallback((metricId: string, preferredSpec?: IndicatorSpec, preferredCategory?: MacroCategory, showDetails = true) => {
    let foundSpec = preferredSpec;
    let foundCategory = preferredCategory;
    if (!foundSpec) {
      for (const [category, specs] of Object.entries(specsByCategory ?? {}) as [MacroCategory, IndicatorSpec[]][]) {
        foundSpec = specs.find(spec => specContainsMetric(spec, metricId));
        if (foundSpec) { foundCategory = category; break; }
      }
    }
    if (!foundSpec || !foundCategory) return;
    const categorySpecs = specsByCategory[foundCategory] as IndicatorSpec[];
    const actualSpec = categorySpecs.find(spec => spec.id === foundSpec!.id) ?? foundSpec;
    setStudioSelections(current => ({ ...current, [foundCategory!]: actualSpec.id }));
    const findNode = (nodes: UiNode[] = []): UiNode | undefined => {
      for (const node of nodes) { if (node.metricId === metricId || node.momMetricId === metricId) return node; const child = findNode(node.children); if (child) return child; }
    };
    const isPrimary = actualSpec.metricId === metricId;
    const componentNode = findNode(actualSpec.components);
    if (showDetails) {
      if (!isPrimary) setSelectedComponent({ metricId: componentNode?.metricId ?? metricId, children: componentNode?.children ?? [] });
      else setSelected(actualSpec);
    }
    window.setTimeout(() => document.getElementById(`economic-${foundCategory}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [specsByCategory]);

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const metricId = params.get("openMetric");
    if (!metricId) return;

    for (const [category, specs] of Object.entries(specsByCategory ?? {}) as [MacroCategory, IndicatorSpec[]][]) {
      const matchingSpec = specs.find((spec) => specContainsMetric(spec, metricId));
      if (!matchingSpec) continue;

      params.delete("openMetric");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      openMetric(metricId, matchingSpec, category);
      return;
    }
  }, [loading, openMetric, r, specsByCategory]);

  useEffect(() => {
    const onReleaseNotice = (event: Event) => {
      const notice = (event as CustomEvent<ReleaseNotice>).detail;
      if (!notice) return;
      const id = `${notice.kind}:${notice.metricId}:${notice.stage ?? "released"}:${Date.now()}`;
      setReleaseToasts((current) => [...current.slice(-2), { ...notice, id }]);
      window.setTimeout(() => {
        setReleaseToasts((current) => current.filter((toast) => toast.id !== id));
      }, notice.kind === "released" ? 9000 : 6500);

      if (notice.kind !== "released") return;
      if (notice.region === "US" || notice.region === "UK" || notice.region === "EA") {
        if (notice.region !== r) {
          window.location.assign(`/country/${notice.region.toLowerCase()}?openMetric=${encodeURIComponent(notice.metricId)}`);
          return;
        }
      } else {
        return;
      }

      setRecentReleaseMetricId(notice.metricId);
      setHighlightedMetricId(notice.metricId);
      void refreshClientJson<Record<string, DetailPayload>>(
        `dashboard:${r}`,
        `/api/dashboard/${r}`,
        "Dashboard request failed"
      ).then((payload) => {
        setMetrics(payload);
        setSavedSnapshot(false);
        openMetric(notice.metricId);
      }).catch(() => {
        openMetric(notice.metricId);
      });
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => {
        setHighlightedMetricId((current) => current === notice.metricId ? null : current);
      }, 15_000);
    };
    window.addEventListener("macrohub:release-notice", onReleaseNotice);
    return () => {
      window.removeEventListener("macrohub:release-notice", onReleaseNotice);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, [openMetric, r, specsByCategory]);

  useEffect(() => {
  if (!specsByCategory) return;

  let dead = false;
  let requestInFlight = false;

  async function loadDashboard(showLoading = false) {
    if (requestInFlight) return;
    requestInFlight = true;
    if (showLoading) {
      setLoading(true);
      setError("");
    }

    try {
      const payload = await refreshClientJson<Record<string, DetailPayload>>(
        `dashboard:${r}`,
        `/api/dashboard/${r}`,
        "Dashboard request failed"
      );

      if (dead) return;

      setMetrics(payload);
      setSavedSnapshot(false);
      setLoading(false);
      setError("");
    } catch {
      if (dead) return;

      // Do not wipe already-loaded data
      // just because a background refresh failed.
      if (showLoading) {
        setError(
          "Unable to load dashboard data."
        );
        setLoading(false);
      }
    } finally {
      requestInFlight = false;
    }
  }

  const cachedPayload = getClientJsonCache<Record<string, DetailPayload>>(`dashboard:${r}`);

  // Initial load
  loadDashboard(cachedPayload == null);

  // Background refresh every 10 seconds.
  // This allows the UI to pick up a newly
  // ingested JOLTS value automatically.
  const refreshTimer = window.setInterval(() => {
    loadDashboard(false);
  }, 10_000);

  return () => {
    dead = true;
    window.clearInterval(refreshTimer);
  };
}, [r, specsByCategory]);
  if (!specsByCategory) {
    return (
      <div className="p-10">
        Unknown country.
      </div>
    );
  }

  const countryName = REGION_LABEL[r];

  const categoryMeta: Record<
    MacroCategory,
    {
      title: string;
      description: string;
      icon: string;
      tone: string;
    }
  > = {
    prices: {
      title: "Prices & Inflation",
      description:
        "Target measures, consumer prices and cost pressures",
      icon: "▥",
      tone: "inflation-band",
    },
    activity: {
      title: "Economic Activity & Demand",
      description:
        "Output, spending and economic activity",
      icon: "▥",
      tone: "growth-band",
    },
    labour: {
      title: "Labour Market, Wages & Productivity",
      description:
        "Employment, pay, labour slack and productivity",
      icon: "●●",
      tone: "jobs-band",
    },
    monetary: {
      title: "Monetary & Financial Conditions",
      description: "Policy rates, credit, yields and financial transmission",
      icon: "◉",
      tone: "monetary-band",
    },
    expectations: {
      title: "Expectations & Outlook",
      description: "Households, businesses, forecasters and market measures",
      icon: "◌",
      tone: "expectations-band",
    },
    external: {
      title: "External, Housing & Fiscal Context",
      description: "Trade, external demand and related macro context",
      icon: "↗",
      tone: "external-band",
    },
  };

  return (
    <div className="macro-page editorial-dashboard" data-region={r.toLowerCase()}>
      <header className="macro-topbar">
        <Link href="/" className="brand">
          <div className="brand-mark">
            ◎
          </div>

          <div>
            <b>MacroHub</b>
            <span>
              Global Macro Dashboard
            </span>
          </div>
        </Link>

        <nav className="editorial-primary-nav" aria-label="Main navigation">
          <Link href="/">Overview</Link>
          <Link href="/country/us" aria-current="page">Countries</Link>
          <Link href="/calendar">Calendar</Link>
          <Link href="/latest-updated">Latest Updated</Link>
        </nav>

        <GlobalMetricSearch />

        <nav
          className="country-nav"
          aria-label="Country"
        >
          {(
            ["US", "UK", "EA"] as Region[]
          ).map((code) => (
            <a
              key={code}
              href={`/country/${code.toLowerCase()}`}
              data-country={code.toLowerCase()}
              className={clsx(
                "country-pill",
                code === r && "active"
              )}
            >
              <span>
                {REGION_FLAG[code]}
              </span>

              {code === "EA"
                ? "Euro Area"
                : code}
            </a>
          ))}
        </nav>

        <button
  type="button"
  className="theme-toggle"
  onClick={toggleTheme}
  aria-label={
    theme === "dark"
      ? "Switch to light theme"
      : "Switch to dark theme"
  }
>
  <span className="theme-toggle-icon">
    {theme === "dark" ? "☀" : "☾"}
  </span>

  <span className="theme-toggle-label">
    {theme === "dark" ? "Light" : "Dark"}
  </span>
</button>

        <div className="source-note">
          <b>
            Data from official sources
          </b>

          <span>
            Last updated:{" "}
            {new Date().toLocaleDateString(
              "en-US",
              {
                month: "short",
                day: "numeric",
                year: "numeric",
              }
            )}
          </span>
        </div>
      </header>

      <div className="macro-dashboard-layout">
        <aside className="country-chapter-rail" aria-label="Country economic sections">
          <div className="chapter-country"><span>{REGION_FLAG[r]}</span><strong>{countryName}</strong></div>
          <nav>{([
            ["prices", "Prices & Inflation"], ["activity", "Activity & Demand"], ["labour", "Labour Market"], ["expectations", "Expectations"],
          ] as [MacroCategory, string][]).filter(([category]) => (specsByCategory[category] as IndicatorSpec[]).length > 0).map(([category, label], index) => <a key={category} href={`#economic-${category}`}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav>
          <div className="chapter-landmark" aria-hidden="true">{r === "UK" ? "♜" : r === "EA" ? "◉" : "♜"}</div>
        </aside>

        <main className="macro-content">
        <Link
          href="/"
          className="back-home"
        >
          <span aria-hidden="true">
            ←
          </span>{" "}
          Back to MacroHub home
        </Link>

        <div className="country-heading">
          <div className="country-flag">
            {REGION_FLAG[r]}
          </div>

          <div className="country-title-row">
  <div>
    <h1>{countryName}</h1>

    <p>
      Macroeconomic indicators for{" "}
      {YEAR} · all data from official
      sources
    </p>
  </div>

  <RefreshDataButton
    onComplete={() => {
      window.location.reload();
    }}
  />
</div>
        </div>

        <nav className="economic-section-nav" aria-label="Economic sections">
          {([
            ["prices", "Prices & inflation"],
            ["activity", "Activity & demand"],
            ["labour", "Labour market"],
            ["monetary", "Monetary conditions"],
            ["expectations", "Expectations"],
          ] as [MacroCategory, string][]).filter(([category]) => specsByCategory[category].length > 0).map(([category, label]) => (
            <a key={category} href={`#economic-${category}`}>{label}</a>
          ))}
          <a className="economic-calendar-jump" href="#country-calendar">Release calendar ↗</a>
        </nav>

        {error && (
          <div className="macro-error">
            {error}
          </div>
        )}
        {savedSnapshot && (
          <div className="macro-error" role="status">
            Showing saved data while live updates are unavailable. Check each indicator’s date before using it.
          </div>
        )}

        {(
          [
            "prices",
            "activity",
            "labour",
            "monetary",
            "expectations",
          ] as MacroCategory[]
        ).map((category) => {
          const meta =
            categoryMeta[category];

          const allSpecs = specsByCategory[category];

const categorySpecs =
  category === "prices"
    ? r === "US"
      ? priceStudioSpecs(r, allSpecs)
      : allSpecs.filter((spec) => {
          // Remove Inflation Expectations from the main
          // inflation cards for UK and Euro Area.
          if (
            metrics[spec.metricId]?.meta.subcategory?.startsWith(
              "expectations_"
            )
          ) {
            return false;
          }

          // UK frontend-only exclusions.
          if (
            r === "UK" &&
            isUkInflationHiddenSpec(spec)
          ) {
            return false;
          }

          return true;
        })
    : allSpecs;

const specs = categorySpecs;

          const orderedSpecs = recentReleaseMetricId
            ? [...specs].sort((a, b) =>
                Number(specContainsMetric(b, recentReleaseMetricId)) -
                Number(specContainsMetric(a, recentReleaseMetricId))
              )
            : specs;

          // Keep the full taxonomy in the configuration, but do not render
          // empty sections where this project has no existing metric cards.
          if (orderedSpecs.length === 0) return null;

          return (
            <section
              key={category}
              id={`economic-${category}`}
              aria-labelledby={`economic-title-${category}`}
              className={clsx(
                "macro-band",
                meta.tone
              )}
            >
              <div className="band-label">
                <div className="band-icon">
                  {meta.icon}
                </div>

                <h2 id={`economic-title-${category}`}>{meta.title}</h2>

                <p>
                  {meta.description}
                </p>

                <strong>
                  {orderedSpecs.length}
                </strong>

                <span>indicators</span>
              </div>

              <div className="macro-band-content">
  {category === "prices" ? <InflationComparisonStudio key={r} region={r} specs={orderedSpecs} metrics={metrics} highlightedMetricId={highlightedMetricId} onOpen={setSelected} /> : category === "labour" || category === "activity" ? <LabourChartStudio key={`${r}-${category}`} category={category} specs={orderedSpecs} metrics={metrics} highlightedMetricId={highlightedMetricId} selectedId={studioSelections[category] ?? null} onSelectionChange={(id) => setStudioSelections(current => ({ ...current, [category]: id }))} onOpen={setSelected} /> : category === "expectations" ? <ExpectationGroupStudio key={r} region={r} specs={orderedSpecs.filter(spec => spec.expectationGroup)} metrics={metrics} onMetricOpen={(metricId) => { setSelected(null); setSelectedComponent(createExpectationMetricSelection(metricId)); }} highlightedMetricId={highlightedMetricId} /> :
  <div
    className="cards-grid"
  >
    {orderedSpecs.map((spec) => (
      <IndicatorCard
        key={spec.id}
        spec={spec}
        metric={
          metrics[spec.metricId]
        }
        componentMetrics={metrics}
        groupLabel={meta.title}
        highlighted={highlightedMetricId != null && specContainsMetric(spec, highlightedMetricId)}
        onOpen={() =>
          setSelected(spec)
        }
      />
    ))}
  </div>}

</div>
            </section>
          );
        })}
        {loading && (
          <div className="loading-strip">
            Loading current data from the
            existing API…
          </div>
        )}
        </main>
        <aside className="macro-calendar-sidebar" id="country-calendar" aria-label="Economic release calendar">
          <EconomicCalendarSidebar onReleaseSelect={(event) => {
            if (event.region === "US" || event.region === "UK" || event.region === "EA") {
              if (event.region !== r) {
                window.location.assign(`/country/${event.region.toLowerCase()}?openMetric=${encodeURIComponent(event.metricId)}`);
                return;
              }
            }
            openMetric(event.metricId);
          }} />
        </aside>
      </div>

      {releaseToasts.length > 0 && (
        <div className="release-notification-stack" aria-live="polite" aria-atomic="false">
          {releaseToasts.map((toast) => {
            const label = toast.region === "EA" ? "Euro Area" : toast.region;
            const actualMetric = metrics[toast.metricId];
            const actualValue = toast.actual == null
              ? "—"
              : actualMetric
                ? formatMetricValue(toast.actual, actualMetric)
                : new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(toast.actual);
            return (
              <div key={toast.id} className={`release-notification ${toast.kind}`} role="status">
                <span className="release-notification-mark" aria-hidden="true">{toast.kind === "released" ? "✓" : "◷"}</span>
                <div>
                  <strong>{toast.kind === "released" ? "Data released and updated" : "Release approaching"}</strong>
                  <p>
                    {toast.kind === "released"
                      ? <>{toast.metricName} · {label} — new value <b>{actualValue}</b></>
                      : <>{toast.metricName} · {label} is due {toast.stage === "2m" ? "in about 2 minutes" : (toast.secondsRemaining ?? 60) > 30 ? "in about 1 minute" : `in ${toast.secondsRemaining ?? 1} seconds`}</>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="macro-footer">
        <span>
          ◉ MacroHub · Bringing together
          official data from BLS, BEA, ONS,
          Eurostat and other trusted sources.
        </span>

        <span>
          All charts show {YEAR} only · no
          index levels displayed
        </span>
      </footer>

      {selected && (
  <DetailDrawer
  region={r}
  spec={selected}
  root={
    metrics[
      selected.metricId
    ]
  }
  allMetrics={metrics}
  onClose={() =>
    setSelected(null)
  }
  onComponentOpen={(metricId, children = []) => {
    if (metricId === 'us-pce' || metricId === 'us-core-pce') {
      const pceCard = DASHBOARD.US.prices.find((item) => item.metricId === metricId);
      if (pceCard) setSelected(pceCard);
    } else if (metricId.startsWith('us-ppi-')) {
      setSelected({ id: metricId, metricId, title: metrics[metricId]?.meta.shortName || metrics[metricId]?.meta.name,
        ...getPublishedComponentMeasureIds(metricId), components: children });
    } else if (metricId.startsWith('uk-ppi-') || metricId.startsWith('ea-ppi-') || ["ea-hicp-yoy", "ea-core-hicp-yoy", "ea-food-hicp-yoy", "ea-energy-hicp-yoy", "ea-goods-hicp-yoy", "ea-services-hicp-yoy"].includes(metricId)) {
      setSelected({ id: metricId, metricId, title: metrics[metricId]?.meta.shortName || metrics[metricId]?.meta.name,
        yoyMetricId: metricId.endsWith("-yoy") ? metricId : undefined,
        momMetricId: metricId.endsWith("-yoy") ? metricId.replace(/-yoy$/, "-mom") : undefined,
        components: children });
    } else if (metricId === "uk-cpi-yoy" || metricId === "uk-cpih-yoy") {
      const cardId = metricId === "uk-cpi-yoy" ? "uk-cpi-card" : "uk-cpih-card";
      const card = DASHBOARD.UK.prices.find((item) => item.id === cardId);
      if (card) {
        setSelected(card);
        setSelectedComponent(null);
      }
    } else setSelectedComponent({ metricId, children });
  }}
/>
)}
{selectedComponent && (
  <ComponentDetailDrawer
    region={r}
    metricId={selectedComponent.metricId}
    components={selectedComponent.children}
    allMetrics={metrics}
    onClose={() =>
      setSelectedComponent(null)
    }
  />
)}
    </div>
  );
}
