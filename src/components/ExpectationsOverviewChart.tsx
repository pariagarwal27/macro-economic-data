"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { ChartTrace } from "@/components/ChartTrace";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { buildExpectationsOverviewSeries, EXPECTATIONS_OVERVIEW_CATEGORIES, expectationsOverviewCategory, expectationsOverviewHorizons, type ExpectationsOverviewCategory, type ExpectationsOverviewHorizon } from "@/lib/expectations-overview";
import { OVERVIEW_REGIONS, overviewAxisDigits, overviewAxisDomain, overviewAxisTicks, type OverviewPayload } from "@/lib/overview-data";
import { getNiceTicks } from "@/lib/chart-axis";

const color = (region: string) => `var(--country-${region.toLowerCase()})`;
const coverageDate = (date: string) => new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export function ExpectationsOverviewChart({ payload, loading, onBack }: { payload: OverviewPayload; loading: boolean; onBack: () => void }) {
  const [categoryId, setCategoryId] = useState<ExpectationsOverviewCategory>("consumer");
  const [preferredHorizon, setPreferredHorizon] = useState<ExpectationsOverviewHorizon>("1y");
  const horizons = expectationsOverviewHorizons(categoryId);
  const horizon = horizons.includes(preferredHorizon) ? preferredHorizon : horizons[0] ?? "1y";
  const category = expectationsOverviewCategory(categoryId, horizon);
  const dualAxis = category.horizon === "5y" || category.horizon === "5y5y" || categoryId === "wage";
  const rightAxisRegion = categoryId === "wage" ? "EA" : "UK";
  const axisFor = (region: string) => dualAxis && region === rightAxisRegion ? "right" : "left";
  const data = useMemo(() => buildExpectationsOverviewSeries(payload, categoryId, new Date(), horizon), [payload, categoryId, horizon]);
  const coverageFor = (region: "US" | "UK" | "EA") => {
    const observed = data.filter(point => point[region] !== null);
    if (!observed.length) return "no published history";
    return `${coverageDate(observed[0]!.date)}–${coverageDate(observed.at(-1)!.date)}`;
  };

  return <section className="overview-chart overview-expectations" aria-labelledby="overview-expectations-title">
    <div className="overview-chart-heading">
      <div><h2 id="overview-expectations-title">Inflation expectations</h2><p>Comparable measures across the United States, United Kingdom and Euro Area</p></div>
      <button type="button" className="overview-inflation-expectations-link" onClick={onBack}>← Back to inflation</button>
    </div>
    <div className="overview-expectations-controls">
      <div className="overview-expectations-categories" role="group" aria-label="Comparable expectation category">
        {EXPECTATIONS_OVERVIEW_CATEGORIES.map(option => <button key={option.id} type="button" aria-pressed={categoryId === option.id} onClick={() => setCategoryId(option.id)}>{option.label}</button>)}
      </div>
      {horizons.length > 0 && <div className="overview-expectations-categories overview-expectations-horizons" role="group" aria-label="Inflation expectation horizon">
        {(["1y", "5y", "5y5y"] as const).map(option => <button key={option} type="button" aria-pressed={horizon === option} disabled={!horizons.includes(option)} title={!horizons.includes(option) ? `No comparable ${option.toUpperCase()} measures are mapped for this category` : undefined} onClick={() => setPreferredHorizon(option)}>{option.toUpperCase()}</button>)}
      </div>}
      <span className="overview-expectations-measure">{category.measure}{categoryId === "business" && <small>5Y is unavailable here because the US, UK and Euro Area business surveys do not share a 5-year measure. Choose Consumer to view comparable 5Y expectations.</small>}</span>
    </div>
    <div className="overview-chart-heading overview-expectations-legend" aria-label="Country series and mapped measures">
      {OVERVIEW_REGIONS.map(region => <span key={region}><i style={{ background: color(region) }} aria-hidden="true" />{COUNTRY_META[region].name}<small>{category.metricLabels[region]} · {coverageFor(region)}{dualAxis ? ` · ${axisFor(region)} axis` : ""}</small></span>)}
    </div>
    <ChartTrace key={`${categoryId}-${horizon}`} enabled><HistoryChartViewport dates={data.map(point => point.date)} label="Inflation expectations history" height={352}>
      {(_, fromYear, toYear, isDefaultWindow) => {
        const visibleData = isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear);
        const hasData = visibleData.some(point => OVERVIEW_REGIONS.some(region => point[region] !== null));
        const leftRegions = dualAxis && categoryId === "wage" ? ["US", "UK"] as const : ["US", "EA"] as const;
        const rightValues = dualAxis ? visibleData.flatMap(point => point[rightAxisRegion] === null ? [] : [point[rightAxisRegion]]) : [];
        const yTicks = dualAxis
          ? getNiceTicks(visibleData.flatMap(point => leftRegions.map(region => point[region])).filter((value): value is number => value !== null), 9, 0.01)
          : overviewAxisTicks(visibleData, "inflation");
        const rightTicks = dualAxis ? getNiceTicks(rightValues, 9, 0.01) : [];
        return <div className="overview-chart-plot overview-expectations-plot">
          {loading ? <div className="overview-chart-empty">Loading published expectations…</div> : !hasData ? <div className="overview-chart-empty">No published comparable expectation readings are available for this period.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={visibleData} margin={{ top: 12, right: 16, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
              <YAxis yAxisId="left" domain={overviewAxisDomain(yTicks)} ticks={yTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={52} tickFormatter={value => `${Number(value).toFixed(Math.max(1, overviewAxisDigits(yTicks)))}%`} />
              {dualAxis && <YAxis yAxisId="right" orientation="right" domain={overviewAxisDomain(rightTicks)} ticks={rightTicks} allowDataOverflow tick={{ fill: color(rightAxisRegion), fontSize: 10 }} tickLine={false} axisLine={false} width={52} tickFormatter={value => `${Number(value).toFixed(Math.max(1, overviewAxisDigits(rightTicks)))}%`} />}
              <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12, borderRadius: 6 }} labelStyle={{ color: "var(--ink)", fontWeight: 600 }} formatter={(value, name) => [`${Number(value).toFixed(Math.max(2, overviewAxisDigits(yTicks), overviewAxisDigits(rightTicks)))}%`, name]} filterNull />
              {OVERVIEW_REGIONS.map(region => <Area key={`area-${region}`} yAxisId={axisFor(region)} dataKey={region} baseValue={(axisFor(region) === "right" ? rightTicks[0] : yTicks[0]) ?? "dataMin"} fill={color(region)} fillOpacity={0.12} stroke="none" tooltipType="none" isAnimationActive={false} />)}
              {OVERVIEW_REGIONS.map(region => <Line key={region} yAxisId={axisFor(region)} dataKey={region} name={`${COUNTRY_META[region].name} · ${category.metricLabels[region]}${dualAxis ? ` · ${axisFor(region)} axis` : ""}`} type="linear" stroke={color(region)} strokeWidth={2.2} dot={{ r: 3, strokeWidth: 0, fill: color(region) }} activeDot={{ r: 5, stroke: "var(--panel)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>}
        </div>;
      }}
    </HistoryChartViewport></ChartTrace>
    <p className="overview-chart-note">{category.note}. {categoryId === "wage" ? "Release frequencies and wage definitions vary by source." : "Release frequencies and CPI/HICP definitions vary by source. Only categories with a mapped measure in all three regions are offered; country-only model-based series are excluded."}{categoryId === "consumer" && (horizon === "1y" ? " Euro Area ECB CES history uses the EA6 aggregate through March 2022 and the EA11 aggregate from April 2022." : " Euro Area ECB CES 5Y history begins in August 2022, when the ECB added this horizon to the survey.")}{categoryId === "business" && " Each line begins at its source's first published observation; gaps before that date reflect survey coverage, not zero values."}</p>
  </section>;
}
