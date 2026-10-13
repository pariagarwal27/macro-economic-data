"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { buildExpectationsOverviewSeries, EXPECTATIONS_OVERVIEW_CATEGORIES, expectationsOverviewCategory, type ExpectationsOverviewCategory } from "@/lib/expectations-overview";
import { OVERVIEW_REGIONS, overviewAxisDomain, overviewAxisTicks, type OverviewPayload } from "@/lib/overview-data";

const color = (region: string) => `var(--country-${region.toLowerCase()})`;

export function ExpectationsOverviewChart({ payload, loading }: { payload: OverviewPayload; loading: boolean }) {
  const [categoryId, setCategoryId] = useState<ExpectationsOverviewCategory>("consumer");
  const category = expectationsOverviewCategory(categoryId);
  const data = useMemo(() => buildExpectationsOverviewSeries(payload, categoryId), [payload, categoryId]);

  return <section className="overview-chart overview-expectations" aria-labelledby="overview-expectations-title">
    <div className="overview-chart-heading">
      <div><h2 id="overview-expectations-title">Inflation expectations</h2><p>Comparable measures across the United States, United Kingdom and Euro Area</p></div>
    </div>
    <div className="overview-expectations-controls">
      <div className="overview-expectations-categories" role="group" aria-label="Comparable expectation category">
        {EXPECTATIONS_OVERVIEW_CATEGORIES.map(option => <button key={option.id} type="button" aria-pressed={categoryId === option.id} onClick={() => setCategoryId(option.id)}>{option.label}</button>)}
      </div>
      <span className="overview-expectations-measure">{category.measure}</span>
    </div>
    <div className="overview-chart-heading overview-expectations-legend" aria-label="Country series and mapped measures">
      {OVERVIEW_REGIONS.map(region => <span key={region}><i style={{ background: color(region) }} aria-hidden="true" />{COUNTRY_META[region].name}<small>{category.metricLabels[region]}</small></span>)}
    </div>
    <HistoryChartViewport dates={data.map(point => point.date)} label="Inflation expectations history" height={332}>
      {(_, fromYear, toYear, isDefaultWindow) => {
        const visibleData = isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear);
        const hasData = visibleData.some(point => OVERVIEW_REGIONS.some(region => point[region] !== null));
        const yTicks = overviewAxisTicks(visibleData, "inflation");
        return <div className="overview-chart-plot overview-expectations-plot">
          {loading ? <div className="overview-chart-empty">Loading published expectations…</div> : !hasData ? <div className="overview-chart-empty">No published comparable expectation readings are available for this period.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={visibleData} margin={{ top: 12, right: 16, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
              <YAxis domain={overviewAxisDomain(yTicks)} ticks={yTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={46} tickFormatter={value => `${Number(value).toFixed(1)}%`} />
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12, borderRadius: 2 }} labelStyle={{ color: "var(--ink)", fontWeight: 600 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]} filterNull />
              {OVERVIEW_REGIONS.map(region => <Line key={region} dataKey={region} name={`${COUNTRY_META[region].name} · ${category.metricLabels[region]}`} type="linear" stroke={color(region)} strokeWidth={2.2} dot={{ r: 2.5, strokeWidth: 0, fill: color(region) }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>}
        </div>;
      }}
    </HistoryChartViewport>
    <p className="overview-chart-note">{category.note}. Release frequencies and CPI/HICP definitions vary by source. Only categories with a mapped measure in all three regions are offered; country-only model-based series are excluded.</p>
  </section>;
}
