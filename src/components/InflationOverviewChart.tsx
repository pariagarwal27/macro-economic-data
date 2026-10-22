"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { buildOverviewInflationSeries, OVERVIEW_INFLATION_SERIES, overviewAxisDomain, type OverviewInflationMode, type OverviewPayload } from "@/lib/overview-data";
import { getNiceTicks, getTickPrecision } from "@/lib/chart-axis";
import { HistoryChartViewport } from "./HistoryChartViewport";

const color = (region: string) => `var(--country-${region.toLowerCase()})`;

export function InflationOverviewChart({ payload, loading, onShowExpectations }: { payload: OverviewPayload; loading: boolean; onShowExpectations: () => void }) {
  const [mode, setMode] = useState<OverviewInflationMode>("yoy");
  const [showHeadline, setShowHeadline] = useState(true);
  const [showCore, setShowCore] = useState(false);
  const allData = useMemo(() => buildOverviewInflationSeries(payload, mode), [payload, mode]);
  const series = OVERVIEW_INFLATION_SERIES.filter(item => item.kind === "headline" ? showHeadline : showCore);
  const plotSeries = mode === "yoy"
    ? series.flatMap(item => [
        { ...item, measure: "yoy" as const, label: "YoY" },
        ...(item.region === "US" || item.region === "UK" || item.region === "EA" ? [{ ...item, key: `${item.key}3m3m`, measure: "three-month" as const, label: item.region === "US" ? "3m/3m SAAR" : item.region === "UK" ? "3-month average" : "3-month avg YoY" }] : []),
      ])
    : series.map(item => ({ ...item, measure: "yoy" as const, label: "MoM" }));
  // The US short-term trend is annualized (SAAR), so a single axis stretches
  // the ordinary YoY series across an unnecessarily wide range. Keep YoY and
  // the UK/EA three-month averages on the left; give US 3m/3m SAAR its own axis.
  const rightAxisSeries = plotSeries.filter(item => item.measure === "three-month" && item.region === "US");
  const leftAxisSeries = plotSeries.filter(item => !rightAxisSeries.includes(item));
  const hasSelection = showHeadline || showCore;

  return <figure className="overview-chart overview-chart-inflation" aria-labelledby="overview-chart-inflation">
    <figcaption className="overview-chart-heading">
      <div><h2 id="overview-chart-inflation">Inflation</h2><p>CPI (US, UK) · HICP (Euro Area)</p></div>
      <div className="overview-chart-legend" aria-label="Selected inflation series">
        {plotSeries.map(item => <span key={item.key}><i className={`${item.kind === "core" ? "is-core" : ""}${item.measure === "three-month" ? " is-three-month" : ""}`} style={{ borderColor: color(item.region), background: item.measure === "three-month" || item.kind === "core" ? "transparent" : color(item.region) }} aria-hidden="true" />{COUNTRY_META[item.region].name} ({item.metricLabel} · {item.label}{rightAxisSeries.includes(item) ? " · right axis" : " · left axis"})</span>)}
      </div>
    </figcaption>
    <div className="overview-inflation-controls">
      <div className="overview-inflation-series" role="group" aria-label="Inflation measures">
        <label><input type="checkbox" checked={showHeadline} onChange={event => setShowHeadline(event.target.checked)} />Headline</label>
        <label><input type="checkbox" checked={showCore} onChange={event => setShowCore(event.target.checked)} />Core</label>
        <button type="button" className="overview-inflation-expectations-link" onClick={onShowExpectations}>Inflation expectations →</button>
      </div>
      <div className="overview-inflation-period" role="group" aria-label="Inflation change period">
        <button type="button" aria-pressed={mode === "yoy"} onClick={() => setMode("yoy")}>YoY</button>
        <button type="button" aria-pressed={mode === "mom"} onClick={() => setMode("mom")}>MoM</button>
      </div>
    </div>
    <div className="overview-chart-unit">{mode === "yoy" ? "Year-on-year and three-month trend (%)" : "Month-on-month change (%)"}</div>
    <HistoryChartViewport dates={allData.map(point => point.period)} label="Inflation comparison" height={352}>
      {(_plotWidth, fromYear, toYear, isDefaultWindow) => {
        const data = isDefaultWindow ? filterHistoryToTrailing12Months(allData) : filterHistoryByYearRange(allData, fromYear, toYear);
        const valuesFor = (items: typeof plotSeries) => data.flatMap(point => items.map(item => point[item.key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
        const leftValues = valuesFor(leftAxisSeries);
        const rightValues = valuesFor(rightAxisSeries);
        const leftTicks = getNiceTicks(leftValues.length ? [Math.min(...leftValues), Math.max(...leftValues)] : [0, 1], 9, 0.05);
        const rightTicks = getNiceTicks(rightValues.length ? [Math.min(...rightValues), Math.max(...rightValues)] : [0, 1], 9, 0.05);
        const ticksFor = (key: string) => rightAxisSeries.some(item => item.key === key) ? rightTicks : leftTicks;
        const formatValue = (key: string, value: number) => `${value.toFixed(Math.max(1, getTickPrecision(ticksFor(key))))}%`;
        const hasTrendAxis = rightAxisSeries.length > 0 && rightTicks.length > 0;
        return <div className="overview-chart-plot">
          {loading ? <div className="overview-chart-empty">Loading published observations…</div> : !hasSelection ? <div className="overview-chart-empty">Select Headline or Core to plot inflation.</div> : !leftValues.length && !rightValues.length ? <div className="overview-chart-empty">No published inflation observations available for this period.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={data} margin={{ top: 12, right: hasTrendAxis ? 8 : 16, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid yAxisId="left" vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
              <YAxis yAxisId="left" domain={overviewAxisDomain(leftTicks)} ticks={leftTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={46} tickFormatter={value => `${Number(value).toFixed(Math.max(1, getTickPrecision(leftTicks)))}%`} />
              {hasTrendAxis && <YAxis yAxisId="right" orientation="right" domain={overviewAxisDomain(rightTicks)} ticks={rightTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={46} tickFormatter={value => `${Number(value).toFixed(Math.max(1, getTickPrecision(rightTicks)))}%`} />}
              <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} content={({ active, payload: tooltipPayload, label }) => {
                if (!active || !tooltipPayload?.length) return null;
                const valueFor = (key: string) => {
                  const value = tooltipPayload.find(entry => entry.dataKey === key)?.value;
                  return typeof value === "number" && Number.isFinite(value) ? formatValue(key, value) : "—";
                };
                return <div className="inflation-paired-tooltip">
                  <strong className="inflation-paired-tooltip-period">{label}</strong>
                  <div className="inflation-paired-tooltip-head"><span>Indicator</span><span>YoY</span><span>3m3m / avg</span></div>
                  {series.map(item => {
                    const trendKey = `${item.key}3m3m`;
                    const hasTrend = item.region === "US" || item.region === "UK" || item.region === "EA";
                    return <div className="inflation-paired-tooltip-row" key={item.key}>
                      <span><i style={{ background: color(item.region) }} />{COUNTRY_META[item.region].name} · {item.metricLabel}</span>
                      <b>{valueFor(item.key)}</b>
                      <b>{hasTrend ? valueFor(trendKey) : "—"}</b>
                    </div>;
                  })}
                </div>;
              }} filterNull />
              {plotSeries.filter(item => item.measure !== "three-month").map(item => <Area key={`area-${item.key}`} yAxisId="left" dataKey={item.key} baseValue={leftTicks[0] ?? "dataMin"} fill={color(item.region)} fillOpacity={item.kind === "core" ? 0.07 : 0.12} stroke="none" tooltipType="none" isAnimationActive={false} />)}
              {plotSeries.map(item => <Line key={item.key} yAxisId={rightAxisSeries.includes(item) ? "right" : "left"} dataKey={item.key} name={`${COUNTRY_META[item.region].name} · ${item.metricLabel} · ${item.label}`} type="linear" stroke={color(item.region)} strokeWidth={item.kind === "core" ? 1.8 : 2.2} strokeDasharray={item.measure === "three-month" ? "2 4" : undefined} dot={item.measure === "three-month" ? { r: 1.5, strokeWidth: 0, fill: color(item.region) } : { r: 3, strokeWidth: 0, fill: color(item.region) }} activeDot={{ r: 5, stroke: "var(--panel)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>}
        </div>;
      }}
    </HistoryChartViewport>
    <p className="overview-chart-note">Published annual or monthly rates. CPI and HICP use different basket methodologies; missing observations remain gaps.</p>
  </figure>;
}
