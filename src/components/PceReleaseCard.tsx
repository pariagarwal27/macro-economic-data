"use client";
import { useMemo, useState } from "react";
import type { UiNode } from "./macro-ui-hierarchy";
import { pceRate } from "@/lib/pce-release";
import { contributionRate } from "@/lib/inflation-contributions";
import { includeReleasePeriod, pceReleaseRows, releasePeriods, type ReleaseMetrics } from "@/lib/release-driver-adapters";
import { ReleaseDriverReport, driverMonth } from "./ReleaseDriverReport";
import { calendarWindow } from "@/lib/release-driver-model";
import { useReleasePeriod } from "@/lib/use-release-period";

export function PceReleaseCard({ components, metrics, rootMetricId, core = false, onComponentOpen, onDisplayTitleChange, initialPeriod }: {
  components: UiNode[]; metrics: ReleaseMetrics; rootMetricId: string; core?: boolean;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
  onDisplayTitleChange?: (title: string) => void;
  initialPeriod?: string | null;
}) {
  const [measure, setMeasure] = useState<"yoy" | "mom">("mom");
  const [hovered, setHovered] = useState<string | null>(null);
  const periods = includeReleasePeriod(releasePeriods(metrics, rootMetricId, `${rootMetricId}-mom`, `${rootMetricId}-yoy`), initialPeriod);
  const [period, setSelectedPeriod] = useReleasePeriod(periods, initialPeriod);
  const rows = useMemo(() => period ? pceReleaseRows(components, metrics, period, measure, core) : [], [components, metrics, period, measure, core]);
  if (!period) return <div className="release-empty">No published PCE period is available.</div>;
  const rootRate = (basket: boolean, mode: "yoy" | "mom", month = period) => {
    return pceRate(metrics, basket, month, mode);
  };
  const effects = rows.some(row => row.current != null);
  const exHousingRate = (mode: "mom" | "yoy", month = period) => contributionRate(metrics["us-core-pce-ex-housing"], month, mode);
  return <ReleaseDriverReport title={core ? "Core PCE" : "PCE"} displayTitle={`PCE (${core ? "Core" : "Headline"})`} onDisplayTitleChange={onDisplayTitleChange} period={period} mode={measure} rows={rows} effects={effects} classificationBasis="pce-proxy" published={rootRate(core, measure)}
    headlineHistory={calendarWindow(period).map(month => ({ period: month, value: rootRate(core, measure, month) }))}
    kpis={[...([false, true].flatMap(basket => (["mom", "yoy"] as const).map(mode => ({ label: `${basket ? "Core " : "Headline "}PCE ${mode === "mom" ? "MoM" : "YoY"}`, value: rootRate(basket, mode) })))), ...(["mom", "yoy"] as const).map(mode => ({ label: `Core PCE Ex Housing ${mode === "mom" ? "MoM" : "YoY"}`, value: exHousingRate(mode) }))]}
    highlighted={hovered} onHighlight={setHovered} onOpen={row => row.metricId && onComponentOpen(row.metricId)}
    controls={<>
      <div className="drivers-toggle" role="group" aria-label="PCE basket">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={core === value} onClick={() => { if (core !== value) onComponentOpen(value ? "us-core-pce" : "us-pce"); }}>{value ? "Core" : "Headline"}</button>)}</div>
      <div className="drivers-toggle" role="group" aria-label="PCE component measure">{(["mom", "yoy"] as const).map(value => <button key={value} type="button" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{value === "yoy" ? "YoY" : "MoM"}</button>)}</div>
      <label className="release-period-control">Period<select aria-label="PCE reference month" value={period} onChange={event => setSelectedPeriod(event.target.value)}>{periods.map(month => <option key={month} value={month}>{driverMonth(month)}</option>)}</select></label>
    </>}
    note={`Component and aggregate rates use the same current BEA price-index vintage, including revisions. Each displayed weight averages the component's prior and current monthly Table 2.8.5 expenditure shares. The final momentum column compounds the latest three seasonally adjusted monthly index changes and annualizes them. Chart bars show separate estimated effects for each component. When all components are available, the labeled reconciliation segment shows the difference between the share-weighted estimate and BEA's published chain index. Missing observations remain unavailable. ${core ? "Core PCE excludes food and energy and uses the published housing series." : "Headline PCE uses the published housing-and-utilities category."}`} noteSource={{ label: "BEA NIPA Table 2.8.5", url: "https://apps.bea.gov/iTable/?categories=survey&isuri=1&nipa_table_list=70&reqid=19&step=3" }} />;
}
