"use client";
import { useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { includeReleasePeriod, retailReleaseRows, retailBasketComponents, releasePeriods, type ReleaseMetrics } from "@/lib/release-driver-adapters";
import { retailDriverRate } from "@/lib/retail-driver-readings";
import { ReleaseDriverReport, driverMonth } from "./ReleaseDriverReport";
import { calendarWindow } from "@/lib/release-driver-model";

const RETAIL_CHOICES = {
  US: [["us-retail-sales-total", "Headline"], ["us-retail-sales-control-group", "Control group"]],
  UK: [["uk-retail-sales-total-ex-fuel", "Headline"], ["uk-retail-sales-ex-fuel", "Ex fuel"]],
  EA: [["ea-retail-sales-total-ex-motor-vehicles", "Headline"], ["ea-retail-sales-ex-fuel", "Ex fuel"]],
};
export function RetailReleaseCard({ region, components, metrics, rootMetricId, onComponentOpen, onDisplayTitleChange, initialPeriod }: {
  region: "US" | "UK" | "EA"; components: UiNode[]; metrics: ReleaseMetrics; rootMetricId: string;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
  onDisplayTitleChange?: (title: string) => void;
  initialPeriod?: string | null;
}) {
  const choices = RETAIL_CHOICES[region];
  const [selectedSeries, setSelectedSeries] = useState(rootMetricId);
  const [measure, setMeasure] = useState<"mom" | "yoy">("mom");
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod ?? "");
  const [hovered, setHovered] = useState<string | null>(null);
  const seriesId = choices.some(([id]) => id === selectedSeries) ? selectedSeries : choices[0][0];
  const periods = includeReleasePeriod(releasePeriods(metrics, seriesId), initialPeriod);
  const period = periods.includes(selectedPeriod) ? selectedPeriod : periods[0];
  const componentNodes = useMemo(() => retailBasketComponents(components, region, seriesId), [components, region, seriesId]);
  const rows = useMemo(() => period ? retailReleaseRows(componentNodes, metrics, period, measure) : [], [componentNodes, metrics, period, measure]);
  if (!period) return <div className="release-empty">No published period is available for this retail basket.</div>;
  const choiceLabel = choices.find(([id]) => id === seriesId)?.[1];
  const title = `Retail sales${choiceLabel === "Headline" ? "" : ` · ${choiceLabel}`}`;
  return <ReleaseDriverReport title={title} displayTitle={title} onDisplayTitleChange={onDisplayTitleChange} period={period} mode={measure} rows={rows} effects={false} published={retailDriverRate(metrics, seriesId, measure, period)} rateLabel="Sales change"
    headlineHistory={calendarWindow(period).map(month => ({ period: month, value: retailDriverRate(metrics, seriesId, measure, month) }))}
    kpis={(["mom", "yoy"] as const).map(mode => ({ label: `${title} ${mode === "mom" ? "MoM" : "YoY"}`, value: retailDriverRate(metrics, seriesId, mode, period) }))}
    highlighted={hovered} onHighlight={setHovered} onOpen={row => row.metricId && onComponentOpen(row.metricId)}
    controls={<>
      <div className="drivers-toggle" role="group" aria-label="Retail sales basket">{choices.map(([id, label]) => <button key={id} type="button" aria-pressed={seriesId === id} onClick={() => setSelectedSeries(id)}>{label}</button>)}</div>
      <div className="drivers-toggle" role="group" aria-label="Retail component measure">{(["mom", "yoy"] as const).map(mode => <button key={mode} type="button" aria-pressed={measure === mode} onClick={() => setMeasure(mode)}>{mode === "mom" ? "MoM" : "YoY"}</button>)}</div>
      <label className="release-period-control">Period<select aria-label="Retail reference month" value={period} onChange={event => setSelectedPeriod(event.target.value)}>{periods.map(month => <option key={month} value={month}>{driverMonth(month)}</option>)}</select></label>
    </>}
    note={`${region === "US" ? "U.S. Census Bureau" : region === "UK" ? "ONS" : "Eurostat"} published component sales changes. These rates do not add up to the headline. A source-matched set of current contribution weights is not mapped; no weighted effects or summed rate totals are inferred. ${region === "UK" ? "Linked ONS 2025 category weights are shown for reference only, not applied to the selected release. " : ""}The CPI sticky/flexible classification does not classify retail-sales growth. History is matched to the exact selected month; missing observations are not replaced with stale releases.`} />;
}
