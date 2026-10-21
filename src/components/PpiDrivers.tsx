"use client";

import { useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { SunburstChart, type SunburstDatum } from "@/components/SunburstChart";
import { DriversBreakdownTable } from "@/components/DriversBreakdownTable";

type Point = { date: string; value: number };
type Metric = { meta: { unit?: string; frequency?: string }; history: Point[] };
type Metrics = Record<string, Metric | undefined>;
type Row = { node: UiNode; depth: number; current: number | null; previous: number | null; period: string | null };

const rate = (metric: Metric | undefined, period?: string): number | null => {
  if (!metric) return null;
  const points = [...metric.history].filter(point => Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date));
  const match = period ? points.filter(point => point.date.slice(0, 7) === period).at(-1) : points.at(-1);
  return match?.value ?? null;
};
const previousMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};
const monthLabel = (period: string | null) => period
  ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`))
  : "—";
const formatRate = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
const formatChange = (current: number | null, previous: number | null) => current == null || previous == null ? "—" : `${current - previous > 0 ? "+" : ""}${(current - previous).toFixed(2)} pp`;

export function PpiDrivers({ components, metrics, onComponentOpen, rootMetricId, subtitle = "Published BLS PPI component inflation rates · grouped by published category" }: {
  components: UiNode[];
  metrics: Metrics;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
  rootMetricId?: string;
  subtitle?: string;
}) {
  const [measure, setMeasure] = useState<"yoy" | "mom">("yoy");
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const rows = useMemo(() => {
    // Keep the two demand overviews concise: show only their mutually
    // exclusive main categories. Detailed descendants and overlapping
    // production-stage series remain available from the category cards.
    const intermediateIds = ["us-ppi-intermediate-processed-goods", "us-ppi-intermediate-unprocessed-goods", "us-ppi-intermediate-services", "us-ppi-intermediate-construction"];
    const finalDemandIds = ["us-ppi-goods", "us-ppi-services", "us-ppi-construction"];
    const isIntermediateOverview = components.some(node => intermediateIds.includes(node.id));
    const isFinalDemandOverview = components.some(node => finalDemandIds.includes(node.id));
    const isMainOverview = isIntermediateOverview || isFinalDemandOverview;
    const primaryIds = isIntermediateOverview ? intermediateIds : isFinalDemandOverview ? finalDemandIds : [];
    const primary = isMainOverview ? components.filter(node => primaryIds.includes(node.id)) : components;
    const nodes: Array<{ node: UiNode; depth: number }> = [];
    const walk = (items: UiNode[], depth = 0) => items.forEach(node => {
      nodes.push({ node, depth });
      if (!isMainOverview && node.children?.length) walk(node.children, depth + 1);
    });
    walk(primary);
    return nodes.map(({ node, depth }): Row => {
      const yoy = metrics[node.metricId ?? ""];
      const mom = metrics[node.momMetricId ?? ""];
      const metric = measure === "mom" ? mom : yoy;
      const dates = [...new Set((metric?.history ?? []).map(point => point.date.slice(0, 7)))].sort();
      const period = dates.at(-1) ?? null;
      return { node, depth, current: rate(metric, period ?? undefined), previous: period ? rate(metric, previousMonth(period)) : null, period };
    });
  }, [components, metrics, measure]);
  if (!rows.length) return <div className="drivers-empty">No published Final Demand or Intermediate Demand components are configured.</div>;
  const latestPeriod = rows.map(row => row.period).filter((period): period is string => Boolean(period)).sort().at(-1) ?? null;
  const rowsById = new Map(rows.map(row => [row.node.id, row]));
  const toSunburst = (node: UiNode): SunburstDatum => {
    const row = rowsById.get(node.id);
    return { id: node.id, label: node.label, value: row?.current ?? null, children: (node.children ?? []).filter(child => rowsById.has(child.id)).map(toSunburst) };
  };
  const sunburstData = rows.filter(row => row.depth === 0).map(row => toSunburst(row.node));
  const rootMomId = rootMetricId?.endsWith("-final-demand") ? `${rootMetricId}-mom` : rootMetricId?.replace(/-yoy$/, "-mom") ?? rootMetricId;
  const rootSeries = metrics[measure === "mom" ? rootMomId ?? "" : rootMetricId ?? ""] ?? metrics[rootMetricId ?? ""];
  const headlineValue = rate(rootSeries, latestPeriod ?? undefined);

  const priorPeriod = latestPeriod ? previousMonth(latestPeriod) : null;

  return <section className="inflation-drivers ppi-drivers" aria-label="Producer Price Index component rates">
    <header className="drivers-heading"><div><p>{subtitle}</p></div>
      <div className="drivers-controls"><div className="drivers-toggle" role="group" aria-label="PPI component measure">{(["yoy", "mom"] as const).map(value => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{value.toUpperCase()}</button>)}</div></div>
    </header>
    <div className="drivers-chart-panel drivers-contribution-panel"><div className="drivers-chart-heading"><h4>{measure === "yoy" ? "Year-over-year" : "Month-over-month"} component rates</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />Latest published data · {monthLabel(latestPeriod)}</span><span>Hover a segment for its value</span></div></div>
      <div className="drivers-chart-table-layout"><SunburstChart data={sunburstData} centerLabel="Published PPI rate" centerValue={headlineValue} period={monthLabel(latestPeriod)} unit="%" showLegend={false} highlightedId={hoveredComponent} onSelect={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }} note="Slice size compares the magnitude of component inflation rates within each group. PPI component rates are not additive contributions; source weights are not available for this breakdown." />
        <DriversBreakdownTable
          title="Published PPI component rates"
          unit={`${measure.toUpperCase()} · not weighted contributions`}
          columns={[{ label: "This month", detail: monthLabel(latestPeriod) }, { label: "Previous month", detail: monthLabel(priorPeriod) }, { label: "Change" }]}
          rows={rows.map(row => ({ id: row.node.id, label: row.node.label, depth: row.depth, polarity: row.current, cells: [formatRate(row.current), formatRate(row.previous), formatChange(row.current, row.previous)] }))}
          onRowHover={setHoveredComponent}
            onRowOpen={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }}
        />
      </div>
    </div>
  </section>;
}
