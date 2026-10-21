"use client";

import { useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { SunburstChart, type SunburstDatum } from "@/components/SunburstChart";
import { DriversBreakdownTable } from "@/components/DriversBreakdownTable";

type Point = { date: string; value: number };
type Metric = { meta: { unit?: string; frequency?: string }; history: Point[] };
type Metrics = Record<string, Metric | undefined>;

function monthLabel(period: string | null) {
  return period ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`)) : "—";
}

function previousMonth(period: string | null) {
  if (!period) return null;
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function periodValue(metric: Metric | undefined, period: string, measure: "yoy" | "mom"): number | null {
  if (!metric) return null;
  const points = [...metric.history].filter(point => Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date));
  const exact = points.filter(point => point.date.slice(0, 7) === period).at(-1);
  if (!exact) return null;
  const [year, month] = period.split("-").map(Number);
  const priorPeriod = measure === "yoy"
    ? `${year - 1}-${String(month).padStart(2, "0")}`
    : new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const prior = points.filter(point => point.date.slice(0, 7) === priorPeriod).at(-1);
  if (!prior || prior.value === 0) return null;
  return ((exact.value / prior.value) - 1) * 100;
}

export function PceDrivers({
  components,
  metrics,
  rootMetricId,
  core = false,
  onComponentOpen,
}: {
  components: UiNode[];
  metrics: Metrics;
  rootMetricId: string;
  core?: boolean;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const [measure, setMeasure] = useState<"yoy" | "mom">("yoy");
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const rootHistory = metrics[rootMetricId]?.history ?? [];
  const latestPeriod = [...new Set(rootHistory.map(point => point.date.slice(0, 7)))].sort().at(-1) ?? null;
  const rows = useMemo(() => {
    if (!latestPeriod) return new Map<string, number | null>();
    const period = latestPeriod;
    const result = new Map<string, number | null>();
    const walk = (nodes: UiNode[]) => nodes.forEach(node => {
      if (node.metricId) result.set(node.id, periodValue(metrics[node.metricId], period, measure));
      if (node.children?.length) walk(node.children);
    });
    walk(components);
    return result;
  }, [components, latestPeriod, metrics, measure]);

  const toSunburst = (node: UiNode): SunburstDatum => ({
    id: node.id,
    label: node.label,
    value: rows.get(node.id) ?? null,
    children: (node.children ?? []).map(toSunburst).filter(child => child.value != null || child.children?.some(nested => nested.value != null)),
  });
  const data = components.map(toSunburst).filter(node => node.value != null || node.children?.length);
  const headline = latestPeriod ? periodValue(metrics[rootMetricId], latestPeriod, measure) : null;
  const priorPeriod = previousMonth(latestPeriod);
  const tableRows: Array<{ id: string; label: string; depth: number; current: number | null; previous: number | null }> = [];
  const collectRows = (nodes: UiNode[], depth = 0) => nodes.forEach(node => {
    if (node.metricId) {
      const metric = metrics[node.metricId];
      const current = latestPeriod ? periodValue(metric, latestPeriod, measure) : null;
      const previous = priorPeriod ? periodValue(metric, priorPeriod, measure) : null;
      if (current != null || previous != null) tableRows.push({ id: node.id, label: node.label, depth, current, previous });
    }
    if (node.children?.length) collectRows(node.children, depth + 1);
  });
  collectRows(components);
  const formatRate = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const formatChange = (current: number | null, previous: number | null) => current == null || previous == null ? "—" : `${current - previous > 0 ? "+" : ""}${(current - previous).toFixed(2)} pp`;
  const metricName = core ? "Core PCE" : "PCE";

  return <section className="inflation-drivers ppi-drivers" aria-label={`${metricName} components`}>
    <header className="drivers-heading"><div><p>Published BEA component price indexes · latest matched release</p></div>
      <div className="drivers-controls">
        <div className="drivers-toggle" role="group" aria-label="PCE basket">{([false, true] as const).map(value => <button key={String(value)} type="button" aria-pressed={core === value} onClick={() => { if (core !== value) onComponentOpen(value ? "us-core-pce" : "us-pce"); }}>{value ? "Core" : "Headline"}</button>)}</div>
        <div className="drivers-toggle" role="group" aria-label="PCE component measure">{(["yoy", "mom"] as const).map(value => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{value.toUpperCase()}</button>)}</div>
      </div>
    </header>
    {!data.length ? <div className="drivers-empty">No matched BEA component price indexes are available for this period.</div> :
      <div className="drivers-chart-panel drivers-contribution-panel">
        <div className="drivers-chart-heading"><h4>{metricName} component inflation rates</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />{monthLabel(latestPeriod)}</span><span>Hover a segment for its rate</span></div></div>
        <div className="drivers-chart-table-layout"><SunburstChart data={data} centerLabel={`${metricName} · ${measure.toUpperCase()}`} centerValue={headline} period={monthLabel(latestPeriod)} unit="%" showLegend={false} highlightedId={hoveredComponent} onSelect={id => {
          const findNode = (nodes: UiNode[]): UiNode | undefined => {
            for (const node of nodes) {
              if (node.id === id || node.metricId === id) return node;
              const nested = node.children?.length ? findNode(node.children) : undefined;
              if (nested) return nested;
            }
          };
          const node = findNode(components);
          if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []);
        }} note={core
          ? "BEA does not publish a core component breakdown matching these categories. The available component indexes are broad PCE rates, not weighted contributions; the Core PCE headline is shown in the center."
          : "Published component index rates are not weighted contributions and do not add up to the PCE headline. The headline inflation rate is shown in the center."} />
        {tableRows.length > 0 && <DriversBreakdownTable
          title={`Behind the ${metricName} component rates`}
          unit={`Published rates · ${measure.toUpperCase()}`}
          columns={[{ label: "This month", detail: monthLabel(latestPeriod) }, { label: "Previous month", detail: monthLabel(priorPeriod) }, { label: "Change" }]}
          rows={tableRows.map(row => ({ id: row.id, label: row.label, depth: row.depth, polarity: row.current, cells: [formatRate(row.current), formatRate(row.previous), formatChange(row.current, row.previous)] }))}
          onRowHover={setHoveredComponent}
            onRowOpen={id => {
            const findNode = (nodes: UiNode[]): UiNode | undefined => {
              for (const node of nodes) {
                if (node.id === id) return node;
                const nested = node.children?.length ? findNode(node.children) : undefined;
                if (nested) return nested;
              }
            };
            const node = findNode(components);
            if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []);
          }}
        />}
        </div>
      </div>}
  </section>;
}
