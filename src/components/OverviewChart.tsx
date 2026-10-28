"use client";

import { Area, Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { ChartTrace } from "@/components/ChartTrace";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { OVERVIEW_REGIONS, overviewAxisDigits, overviewAxisDomain, overviewAxisTicks, overviewRegionAxisTicks, type OverviewChartPoint, type OverviewIndicator } from "@/lib/overview-data";

const CONFIG = {
  inflation: { title: "Inflation", description: "CPI (US, UK) · HICP (Euro Area)", unit: "Year-on-year change (%)" },
  gdp: { title: "GDP growth", description: "Quarter-on-quarter growth · seasonally adjusted", unit: "Growth (%)" },
  unemployment: { title: "Unemployment rate", description: "Share of the labour force", unit: "Published rate and three-month average (%)" },
  wage: { title: "Wage growth", description: "Annual pay growth · source definitions vary", unit: "Year-on-year change and three-month trend (%)" },
  retail: { title: "Retail sales", description: "Country dashboard retail series", unit: "Year-on-year change and three-month trend (%)" },
};
const color = (region: string) => `var(--country-${region.toLowerCase()})`;
const primaryLabel = (indicator: OverviewIndicator) => indicator === "unemployment" ? "Published rate" : indicator === "gdp" ? "QoQ" : "YoY";
const trendLabel = (indicator: OverviewIndicator, region: string) => indicator === "unemployment"
  ? "3-month average"
  : indicator === "retail" && region === "UK"
    ? "3m/3m"
    : "3m/3m SAAR";

const trendRegions = (indicator: OverviewIndicator) => indicator === "wage" ? ["US", "UK"] as const : OVERVIEW_REGIONS;

export function OverviewChart({ indicator, data, loading }: { indicator: OverviewIndicator; data: OverviewChartPoint[]; loading: boolean }) {
  const config = CONFIG[indicator];
  return <figure className={`overview-chart overview-chart-${indicator}`} aria-labelledby={`overview-chart-${indicator}`}>
    <figcaption className="overview-chart-heading">
      <div><h2 id={`overview-chart-${indicator}`}>{config.title}</h2><p>{config.description}</p></div>
      <div className="overview-chart-legend" aria-label="Country legend">
        {OVERVIEW_REGIONS.map(region => <span key={`${region}-primary`}><i style={{ background: color(region) }} aria-hidden="true" />{COUNTRY_META[region].name}{indicator === "unemployment" ? region === "EA" ? " · Rate (right)" : " · Rate (left)" : indicator === "inflation" ? region === "EA" ? " (HICP · YoY)" : " (CPI · YoY)" : indicator === "wage" ? `${region === "US" ? " (AHE" : region === "UK" ? " (Regular pay" : " (Labour cost index"} · YoY)` : indicator === "retail" ? " · YoY" : ""}</span>)}
        {indicator !== "gdp" && indicator !== "inflation" && trendRegions(indicator).filter(region => data.some(point => typeof point[`${region}Trend`] === "number")).map(region => <span key={`${region}-trend`}><i className="is-three-month" style={{ borderColor: color(region) }} aria-hidden="true" />{COUNTRY_META[region].name} · {trendLabel(indicator, region)}</span>)}
      </div>
    </figcaption>
    <div className="overview-chart-unit">{config.unit}</div>
    <ChartTrace enabled kind={indicator === "gdp" ? "bars" : "line"}><HistoryChartViewport dates={data.map(point => point.date)} label={`${config.title} history`} height={352}>
      {(_, fromYear, toYear, isDefaultWindow) => {
        const visibleData = isDefaultWindow ? filterHistoryToTrailing12Months(data) : filterHistoryByYearRange(data, fromYear, toYear);
        const hasData = visibleData.some(point => OVERVIEW_REGIONS.some(region => point[region] !== null));
        const yTicks = overviewAxisTicks(visibleData, indicator);
        const unemploymentLeftTicks = indicator === "unemployment" ? overviewRegionAxisTicks(visibleData, ["US", "UK"]) : yTicks;
        const unemploymentRightTicks = indicator === "unemployment" ? overviewRegionAxisTicks(visibleData, ["EA"]) : [];
        const axes = <>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
          <YAxis yAxisId="left" domain={overviewAxisDomain(unemploymentLeftTicks)} ticks={unemploymentLeftTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={42} tickFormatter={value => `${Number(value).toFixed(Math.max(1, overviewAxisDigits(unemploymentLeftTicks)))}%`} />
          {indicator === "unemployment" && <YAxis yAxisId="right" orientation="right" domain={overviewAxisDomain(unemploymentRightTicks)} ticks={unemploymentRightTicks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={42} tickFormatter={value => `${Number(value).toFixed(Math.max(1, overviewAxisDigits(unemploymentRightTicks)))}%`} />}
          {indicator !== "gdp" && OVERVIEW_REGIONS.map(region => <Area key={`area-${region}`} yAxisId={indicator === "unemployment" && region === "EA" ? "right" : "left"} baseValue={(indicator === "unemployment" && region === "EA" ? unemploymentRightTicks[0] : unemploymentLeftTicks[0]) ?? "dataMin"} dataKey={region} fill={color(region)} fillOpacity={0.12} stroke="none" tooltipType="none" isAnimationActive={false} />)}
          <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1, strokeDasharray: "4 3" }} contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12, borderRadius: 6 }} labelStyle={{ color: "var(--ink)", fontWeight: 600 }} content={indicator === "gdp" ? undefined : ({ active, payload: tooltipPayload, label }) => {
            if (!active || !tooltipPayload?.length) return null;
            const valueFor = (key: string, region: string) => {
              const value = tooltipPayload.find(entry => entry.dataKey === key)?.value;
              if (typeof value !== "number" || !Number.isFinite(value)) return "—";
              const digits = indicator === "unemployment" && region === "EA" ? overviewAxisDigits(unemploymentRightTicks) : overviewAxisDigits(unemploymentLeftTicks);
              return `${value.toFixed(Math.max(1, digits))}%`;
            };
            return <div className="inflation-paired-tooltip">
              <strong className="inflation-paired-tooltip-period">{label}</strong>
              <div className="inflation-paired-tooltip-head"><span>Region</span><span>{primaryLabel(indicator)}</span><span>{indicator === "unemployment" ? "3-month avg" : "3m/3m SAAR"}</span></div>
              {OVERVIEW_REGIONS.map(region => <div className="inflation-paired-tooltip-row" key={region}>
                <span><i style={{ background: color(region) }} />{COUNTRY_META[region].name}</span>
                <b>{valueFor(region, region)}</b>
                <b>{indicator === "wage" && region === "EA" ? "—" : valueFor(`${region}Trend`, region)}</b>
              </div>)}
            </div>;
          }} formatter={(value, name) => [`${Number(value).toFixed(Math.max(1, indicator === "unemployment" && name === "Euro Area" ? overviewAxisDigits(unemploymentRightTicks) : overviewAxisDigits(unemploymentLeftTicks)))}%`, name]} filterNull />
        </>;
        return <div className="overview-chart-plot">
          {loading ? <div className="overview-chart-empty">Loading published observations…</div> : !hasData ? <div className="overview-chart-empty">No published observations available for this period.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {indicator === "gdp" ? <BarChart data={visibleData} margin={{ top: 12, right: 12, bottom: 6, left: 0 }} accessibilityLayer>
              {axes}<ReferenceLine yAxisId="left" y={0} stroke="var(--line-strong)" />
              {OVERVIEW_REGIONS.map(region => <Bar key={region} yAxisId="left" dataKey={region} name={COUNTRY_META[region].name} fill={color(region)} maxBarSize={26} minPointSize={value => value === 0 ? 3 : 0} isAnimationActive={false}><LabelList dataKey={region} position="top" formatter={value => value === 0 ? "0.0%" : ""} style={{ fill: color(region), fontSize: 9 }} /></Bar>)}
            </BarChart> : <LineChart data={visibleData} margin={{ top: 12, right: 16, bottom: 6, left: 0 }} accessibilityLayer>
              {axes}
              {OVERVIEW_REGIONS.map(region => <Line key={region} yAxisId={indicator === "unemployment" && region === "EA" ? "right" : "left"} dataKey={region} name={`${COUNTRY_META[region].name} · ${primaryLabel(indicator)}`} type="linear" stroke={color(region)} strokeWidth={2.2} dot={{ r: 3, strokeWidth: 0, fill: color(region) }} activeDot={{ r: 5, stroke: "var(--panel)", strokeWidth: 2 }} connectNulls={indicator === "wage" && region === "EA"} isAnimationActive={false} />)}
              {trendRegions(indicator).filter(region => visibleData.some(point => typeof point[`${region}Trend`] === "number")).map(region => <Line key={`${region}-trend`} yAxisId={indicator === "unemployment" && region === "EA" ? "right" : "left"} dataKey={`${region}Trend`} name={`${COUNTRY_META[region].name} · ${trendLabel(indicator, region)}`} type="linear" stroke={color(region)} strokeWidth={2} strokeDasharray="2 4" dot={{ r: 1.5, strokeWidth: 0, fill: color(region) }} activeDot={{ r: 5, stroke: "var(--panel)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>}
          </ResponsiveContainer>}
        </div>;
      }}
    </HistoryChartViewport></ChartTrace>
    <p className="overview-chart-note">{indicator === "gdp" ? "US annualized GDP is converted to QoQ for comparison. Only completed quarters are shown." : indicator === "unemployment" ? "UK observations are published three-month estimates. Euro Area dotted values average three published monthly rates. Missing observations remain gaps." : indicator === "wage" ? "US average hourly earnings, UK regular weekly pay and Euro Area labour cost index wages. Dotted lines show the US and UK three-month trends; definitions and frequency differ." : indicator === "retail" ? "Uses the mapped country-dashboard series: U.S. retail and food services total, UK headline retail sales including automotive fuel, and Euro Area retail trade excluding motor vehicles. Euro Area 3m/3m SAAR uses the official seasonally and calendar-adjusted volume index." : "Published annual rates. CPI and HICP use different basket methodologies. Euro Area dotted values average three published YoY observations. Missing observations remain gaps."}</p>
  </figure>;
}
