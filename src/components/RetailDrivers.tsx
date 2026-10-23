"use client";

import { useEffect, useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { SunburstChart, type SunburstDatum } from "@/components/SunburstChart";
import { DriversBreakdownTable } from "@/components/DriversBreakdownTable";
import { retailDriverRate } from '@/lib/retail-driver-readings';

type Point = { date: string; value: number; rawValue?: number | null };
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
  const [ukSeries, setUkSeries] = useState('uk-retail-sales-ex-fuel');
  const [usSeries, setUsSeries] = useState(rootMetricId === 'us-retail-sales-control-group' ? 'us-retail-sales-control-group' : 'us-retail-sales-total');
  const [eaSeries, setEaSeries] = useState('ea-retail-sales-ex-fuel');
  const [measure, setMeasure] = useState<'mom'|'yoy'>('mom');
  const [selectedMonth, setSelectedMonth] = useState('');
  const isUk = region === 'UK';
  const isUs = region === 'US';
  const isEa = region === 'EA';
  useEffect(() => {
    if (isUs) setUsSeries(rootMetricId === 'us-retail-sales-control-group' ? 'us-retail-sales-control-group' : 'us-retail-sales-total');
    if (isEa) setEaSeries(rootMetricId === 'ea-retail-sales-ex-fuel' ? 'ea-retail-sales-ex-fuel' : 'ea-retail-sales-total-ex-motor-vehicles');
    setSelectedMonth('');
  }, [region, rootMetricId, isUs, isEa]);
  const seriesId = isUk ? ukSeries : isUs ? usSeries : isEa ? eaSeries : rootMetricId;
  const activeRootId = seriesId;
  const familyMetricIds = [...new Set([rootMetricId, ...components.flatMap(function collect(node): string[] { return [...(node.metricId ? [node.metricId] : []), ...(node.children ?? []).flatMap(collect)]; })])];
  const months = [...new Set(familyMetricIds.flatMap(id => [
    ...(metrics[id]?.history ?? []).map(point => point.date.slice(0,7)),
    ...(isUk ? (metrics[id === 'uk-retail-sales-ex-fuel' ? 'uk-retail-sales-ex-fuel-yoy' : `${id}-yoy`]?.history ?? []).map(point => point.date.slice(0,7)) : []),
  ]))].sort().reverse();
  const activeMonth = selectedMonth || months[0] || '';
  const rows = useMemo(() => {
    const nodes: Array<{ node: UiNode; depth: number }> = [];
    const visit = (items: UiNode[], depth: number) => items.forEach(node => {
      const excludedUkNode = isUk && (node.metricId === 'uk-retail-sales-total-ex-fuel' || (ukSeries === 'uk-retail-sales-ex-fuel' && node.metricId === 'uk-retail-automotive-fuel'));
      const excludedUsNode = isUs && (node.metricId === 'us-retail-sales-total' || node.metricId === 'us-retail-sales-control-group' || (usSeries === 'us-retail-sales-control-group' && ['us-retail-motor-vehicles','us-retail-gasoline','us-retail-food-services','us-retail-total-ex-auto-gas'].includes(node.metricId ?? '')));
      const excludedEaNode = isEa && (['ea-retail-sales-total-ex-motor-vehicles','ea-retail-sales-ex-fuel'].includes(node.metricId ?? '') || (eaSeries === 'ea-retail-sales-ex-fuel' && node.metricId === 'ea-retail-automotive-fuel'));
      if (node.metricId !== activeRootId && !excludedUkNode && !excludedUsNode && !excludedEaNode && nodeHasData(node, metrics)) nodes.push({ node, depth });
      if (node.children?.length) visit(node.children, depth + 1);
    });
    visit(components, 0);
    return nodes.map(({ node, depth }) => {
      const history = node.metricId ? [...(metrics[node.metricId]?.history ?? [])]
        .filter(point => Number.isFinite(point.value))
        .sort((a, b) => a.date.localeCompare(b.date)) : [];
      const derivedFromLevels = isUs && node.metricId === 'us-retail-sales-control-group';
      const componentMonth = activeMonth && (history.some(point => point.date.startsWith(activeMonth)) || derivedFromLevels && (metrics['us-retail-sales-total']?.history ?? []).some(point => point.date.startsWith(activeMonth))) ? activeMonth : history.at(-1)?.date.slice(0,7) ?? activeMonth;
      const componentPreviousMonth = componentMonth ? new Date(Date.UTC(Number(componentMonth.slice(0,4)),Number(componentMonth.slice(5,7))-2,1)).toISOString().slice(0,7) : '';
      const current = (isUk || isUs || isEa) && node.metricId ? retailDriverRate(metrics,node.metricId,measure,componentMonth) : null;
      const previous = (isUk || isUs || isEa) && node.metricId ? retailDriverRate(metrics,node.metricId,measure,componentPreviousMonth) : null;
      return { node, depth, current: isUk || isUs || isEa ? current == null ? null : {date:componentMonth+'-01',value:current} : history.at(-1) ?? null, previous: isUk || isUs || isEa ? previous == null ? null : {date:componentPreviousMonth+'-01',value:previous} : history.at(-2) ?? null };
    });
  }, [components, metrics, activeRootId, isUk, isUs, isEa, ukSeries, usSeries, eaSeries, measure, activeMonth]);

  const latestDate = isUk || isUs || isEa ? activeMonth ? activeMonth+'-01' : undefined : rows.map(row => row.current?.date).filter((date): date is string => Boolean(date)).sort().at(-1);
  const periodLabel = latestDate ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${latestDate.slice(0, 7)}-01T00:00:00Z`)) : "latest release";
  const regionSource = region === "US" ? "U.S. Census Bureau" : region === "UK" ? "ONS" : "Eurostat";
  const rowsById = new Map(rows.map(row => [row.node.id, row]));
  const toSunburst = (node: UiNode): SunburstDatum => {
    const row = rowsById.get(node.id);
    return { id: node.id, label: node.label, value: row?.current?.value ?? null, children: (node.children ?? []).filter(child => rowsById.has(child.id)).map(toSunburst) };
  };
  const sunburstData = components.filter(node => rowsById.has(node.id)).map(toSunburst);
  const selectedRate = isUk || isUs || isEa ? retailDriverRate(metrics,activeRootId,measure,activeMonth) : null;
  const headlineReading = isUk || isUs || isEa ? selectedRate == null ? null : {date:activeMonth+'-01',value:selectedRate} : [...(metrics[rootMetricId]?.history ?? [])].filter(point => Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const headlineDate = headlineReading?.date ?? latestDate ?? "";
  const headlinePeriod = headlineDate ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${headlineDate.slice(0, 7)}-01T00:00:00Z`)) : periodLabel;
  const monthLabel = (period: string | null) => period ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`)) : "—";
  const formatRate = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
  const formatChange = (current: number | null, previous: number | null) => current == null || previous == null ? "—" : `${current - previous > 0 ? "+" : ""}${(current - previous).toFixed(2)} pp`;

  return <section className="inflation-drivers ppi-drivers retail-drivers" aria-label={`${region} retail sales components`}>
    {(isUk || isUs || isEa) && <>
      <div className="retail-driver-controls">
        <div className="retail-driver-control-group" role="group" aria-label="Retail sales series">{(isUk ? [['uk-retail-sales-total-ex-fuel','Headline Retail Sales'],['uk-retail-sales-ex-fuel','Retail Sales ex Fuel']] : isUs ? [['us-retail-sales-total','Headline Retail Sales'],['us-retail-sales-control-group','Retail Sales Control Group']] : [['ea-retail-sales-total-ex-motor-vehicles','Headline Retail Sales'],['ea-retail-sales-ex-fuel','Retail Sales ex Fuel']]).map(([id,label]) => <button key={id} type="button" aria-pressed={seriesId===id} onClick={() => isUk ? setUkSeries(id) : isUs ? setUsSeries(id) : setEaSeries(id)}>{label}</button>)}</div>
        <div className="retail-driver-control-group" role="group" aria-label="Retail component measure">{(['mom','yoy'] as const).map(value => <button key={value} type="button" aria-pressed={measure===value} onClick={() => setMeasure(value)}>{value==='mom'?'MoM':'YoY'}</button>)}</div>
        <label className="retail-driver-month">Month <select aria-label="Retail sales month" value={activeMonth} onChange={event => setSelectedMonth(event.target.value)}>{months.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
      </div>
      <div className="retail-driver-rates">{(['yoy','mom'] as const).map(value => <div key={value} className="retail-driver-rate"><span>{value==='mom'?'MoM':'YoY'}</span><strong>{formatRate(retailDriverRate(metrics,activeRootId,value,activeMonth))}</strong></div>)}</div>
    </>}
    <header className="drivers-heading"><div><p>Published retail sales component changes · {regionSource}</p></div></header>
    {rows.length === 0 ? <div className="drivers-empty">No published retail sales component readings are available yet.</div> :
      <div className="drivers-chart-panel drivers-contribution-panel">
        <div className="drivers-chart-heading"><h4>Retail sales change by group and component</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />{isUk || isUs || isEa ? measure === 'yoy' ? 'YoY' : 'MoM' : 'Latest published reading'} · {periodLabel}</span><span>Hover a segment for its value</span></div></div>
        <div className="drivers-chart-table-layout"><SunburstChart data={sunburstData} centerLabel={`${isUk ? ukSeries === 'uk-retail-sales-ex-fuel' ? 'Retail sales ex-fuel' : 'Headline retail sales' : isUs ? usSeries === 'us-retail-sales-control-group' ? 'Retail sales control group' : 'Headline retail sales' : isEa ? eaSeries === 'ea-retail-sales-ex-fuel' ? 'Retail sales ex-fuel' : 'Headline retail sales' : 'Retail sales'} · ${measure.toUpperCase()}`} centerValue={headlineReading?.value ?? null} period={headlinePeriod} unit="%" showLegend={false} highlightedId={hoveredComponent} onSelect={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }} note="Slice size compares the magnitude of published component changes within each group. These rates do not add up to the headline; published retail basket weights are not mapped consistently across countries." />
          <DriversBreakdownTable
            title="Published retail component changes"
            unit={`${(isUk || isUs || isEa) && measure === 'yoy' ? 'Annual' : 'Monthly'} rates · not weighted contributions`}
            columns={[{ label: "Latest published", detail: "Each component’s latest available month" }, { label: "Prior month", detail: "Previous observation for that component" }, { label: "Change" }]}
            rows={rows.map(row => ({ id: row.node.id, label: row.node.label, depth: row.depth, polarity: row.current?.value ?? null, cells: [formatRate(row.current?.value ?? null), formatRate(row.previous?.value ?? null), formatChange(row.current?.value ?? null, row.previous?.value ?? null)] }))}
            onRowHover={setHoveredComponent}
            onRowOpen={id => { const node = rowsById.get(id)?.node; if (node?.metricId) onComponentOpen(node.metricId, node.children ?? []); }}
          />
        </div>
      </div>}
  </section>;
}
