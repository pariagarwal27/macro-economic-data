"use client";

import { useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { SunburstChart, type SunburstDatum } from "@/components/SunburstChart";
import { DriversBreakdownTable } from "@/components/DriversBreakdownTable";

type Point = { date: string; value: number };
type Metric = { meta: { unit?: string; frequency?: string }; history: Point[] };
type Metrics = Record<string, Metric | undefined>;

function nodeHasData(node: UiNode, metrics: Metrics): boolean {
  return Boolean(node.metricId && (metrics[node.metricId]?.history?.length ?? 0) > 0)
    || Boolean(node.children?.some(child => nodeHasData(child, metrics)));
}

export function RetailDrivers({
  region,
  components,
  metrics,
  rootMetricId,
  onComponentOpen,
}: {
  region: "US" | "UK" | "EA";
  components: UiNode[];
  metrics: Metrics;
  rootMetricId: string;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const rows = useMemo(() => {
    const nodes: Array<{ node: UiNode; depth: number }> = [];
    const visit = (items: UiNode[], depth: number) => items.forEach(node => {
      if (node.metricId !== rootMetricId && nodeHasData(node, metrics)) nodes.push({ node, depth });
      if (node.children?.length) visit(node.children, depth + 1);
    });
    visit(components, 0);
    return nodes.map(({ node, depth }) => {
      const history = node.metricId ? [...(metrics[node.metricId]?.history ?? [])]
        .filter(point => Number.isFinite(point.value))
        .sort((a, b) => a.date.localeCompare(b.date)) : [];
      return { node, depth, current: history.at(-1) ?? null, previous: history.at(-2) ?? null };
    });
  }, [components, metrics, rootMetricId]);

  const latestDate = rows.map(row => row.current?.date).filter((date): date is string => Boolean(date)).sort().at(-1);
  const periodLabel = latestDate ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${latestDate.slice(0, 7)}-01T00:00:00Z`)) : "latest release";
  const regionSource = region === "US" ? "U.S. Census Bureau" : region === "UK" ? "ONS" : "Eurostat";
  const rowsById = new Map(rows.map(row => [row.node.id, row]));
  const toSunburst = (node: UiNode): SunburstDatum => {
    const row = rowsById.get(node.id);
    return { id: node.id, label: node.label, value: row?.current?.value ?? null, children: (node.children ?? []).filter(child => rowsById.has(child.id)).map(toSunburst) };
  };
  const sunburstData = components.filter(node => rowsById.has(node.id)).map(toSunburst);
  const headlineReading = [...(metrics[rootMetricId]?.history ?? [])].filter(point => Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const headlineDate = headlineReading?.date ?? latestDate ?? "";
  const headlinePeriod = headlineDate ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${headlineDate.slice(0, 7)}-01T00:00:00Z`)) : periodLabel;
  const priorDate = latestDate ? new Date(Date.UTC(Number(latestDate.slice(0, 4)), Number(latestDate.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7) : null;
  const monthLabel = (period: string | null) => period ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`)) : "—";
  const formatRate = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
  const formatChange = (current: number | null, previous: number | null) => current == null || previous == null ? "—" : `${current - previous > 0 ? "+" : ""}${(current - previous).toFixed(2)} pp`;

  return <section className="inflation-drivers ppi-drivers retail-drivers" aria-label={`${region} retail sales components`}>
    <header className="drivers-heading"><div><p>Published retail sales component changes · {regionSource}</p></div></header>
    {rows.length === 0 ? <div className="drivers-empty">No published retail sales component readings are available yet.</div> :
      <div className="drivers-chart-panel drivers-contribution-panel">
        <div className="drivers-chart-heading"><h4>Retail sales change by group and component</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />Latest published reading · {periodLabel}</span><span>Hover a segment for its value</span></div></div>
        <div className="drivers-chart-table-layout"><SunburstChart data={sunburstData} centerLabel="Headline monthly change" centerValue={headlineReading?.value ?? null} period={headlinePeriod} unit="%" showLegend={false} highlightedId={hoveredComponent} onSelect={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }} note="Slice size compares the magnitude of published component changes within each group. These rates do not add up to the headline; published retail basket weights are not mapped consistently across countries." />
          <DriversBreakdownTable
            title="Published retail component changes"
            unit="Monthly rates · not weighted contributions"
            columns={[{ label: "This month", detail: monthLabel(latestDate?.slice(0, 7) ?? null) }, { label: "Previous month", detail: monthLabel(priorDate) }, { label: "Change" }]}
            rows={rows.map(row => ({ id: row.node.id, label: row.node.label, depth: row.depth, polarity: row.current?.value ?? null, cells: [formatRate(row.current?.value ?? null), formatRate(row.previous?.value ?? null), formatChange(row.current?.value ?? null, row.previous?.value ?? null)] }))}
            onRowHover={setHoveredComponent}
            onRowOpen={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }}
          />
        </div>
      </div>}
  </section>;
}
