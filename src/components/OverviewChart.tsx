"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { OVERVIEW_REGIONS, type OverviewChartPoint, type OverviewIndicator } from "@/lib/overview-data";

const CONFIG = {
  inflation: { title: "Inflation", description: "CPI (US, UK) · HICP (Euro Area)", unit: "Year-on-year change (%)" },
  gdp: { title: "GDP growth", description: "Quarter-on-quarter growth · seasonally adjusted", unit: "Growth (%)" },
  unemployment: { title: "Unemployment rate", description: "Share of the labour force", unit: "Rate (%)" },
};
const color = (region: string) => `var(--country-${region.toLowerCase()})`;

export function OverviewChart({ indicator, data, loading }: { indicator: OverviewIndicator; data: OverviewChartPoint[]; loading: boolean }) {
  const config = CONFIG[indicator];
  const hasData = data.some(point => OVERVIEW_REGIONS.some(region => point[region] !== null));
  const axes = <>
    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
    <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
    <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={42} tickFormatter={value => `${Number(value).toFixed(1)}%`} />
    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12, borderRadius: 2 }} labelStyle={{ color: "var(--ink)", fontWeight: 600 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]} filterNull />
  </>;
  return <figure className={`overview-chart overview-chart-${indicator}`} aria-labelledby={`overview-chart-${indicator}`}>
    <figcaption className="overview-chart-heading">
      <div><h2 id={`overview-chart-${indicator}`}>{config.title}</h2><p>{config.description}</p></div>
      <div className="overview-chart-legend" aria-label="Country legend">
        {OVERVIEW_REGIONS.map(region => <span key={region}><i style={{ background: color(region) }} aria-hidden="true" />{COUNTRY_META[region].name}{indicator === "inflation" ? region === "EA" ? " (HICP)" : " (CPI)" : ""}</span>)}
      </div>
    </figcaption>
    <div className="overview-chart-unit">{config.unit}</div>
    <div className="overview-chart-plot">
      {loading ? <div className="overview-chart-empty">Loading published observations…</div> : !hasData ? <div className="overview-chart-empty">No published 2026 observations available.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {indicator === "gdp" ? <BarChart data={data} margin={{ top: 12, right: 12, bottom: 6, left: 0 }} accessibilityLayer>
          {axes}<ReferenceLine y={0} stroke="var(--line-strong)" />
          {OVERVIEW_REGIONS.map(region => <Bar key={region} dataKey={region} name={COUNTRY_META[region].name} fill={color(region)} maxBarSize={26} isAnimationActive={false} />)}
        </BarChart> : <LineChart data={data} margin={{ top: 12, right: 16, bottom: 6, left: 0 }} accessibilityLayer>
          {axes}
          {OVERVIEW_REGIONS.map(region => <Line key={region} dataKey={region} name={COUNTRY_META[region].name} type="linear" stroke={color(region)} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: color(region) }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>}
      </ResponsiveContainer>}
    </div>
    <p className="overview-chart-note">{indicator === "gdp" ? "US annualized GDP is converted to QoQ for comparison. Only completed quarters are shown." : indicator === "unemployment" ? "UK observations are published three-month estimates. Missing observations remain gaps." : "Published annual rates. CPI and HICP use different basket methodologies. Missing observations remain gaps."}</p>
  </figure>;
}
