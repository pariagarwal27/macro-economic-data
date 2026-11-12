"use client";
import { useMemo, useState } from "react";
import { buildInflationContributions, CONTRIBUTION_CONFIGS, type ContributionMetrics, type ContributionMode } from "@/lib/inflation-contributions";
import { includeReleasePeriod, inflationReleaseRows, releasePeriods } from "@/lib/release-driver-adapters";
import { ReleaseDriverReport, driverMonth } from "./ReleaseDriverReport";
import { calendarWindow } from "@/lib/release-driver-model";
import { useReleasePeriod } from "@/lib/use-release-period";

export function InflationReleaseCard({ metricId, metrics, onComponentOpen, onDisplayTitleChange, initialPeriod }: { metricId: string; metrics: ContributionMetrics; onComponentOpen: (metricId: string) => void; onDisplayTitleChange?: (title: string) => void; initialPeriod?: string | null }) {
  const config = CONTRIBUTION_CONFIGS[metricId];
  const [core, setCore] = useState(metricId === config?.core);
  const [mode, setMode] = useState<ContributionMode>("mom");
  const [hovered, setHovered] = useState<string | null>(null);
  const rootId = config ? core ? config.core! : config.headline : "";
  const companionIds = config ? core ? [config.coreYoy, config.coreMom] : [config.headlineYoy, config.headlineMom] : [];
  const periods = includeReleasePeriod(releasePeriods(metrics, rootId, ...companionIds.filter((id): id is string => Boolean(id))), initialPeriod);
  const [period, setSelectedPeriod] = useReleasePeriod(periods, initialPeriod, config?.headline === "us-cpi");
  const rows = useMemo(() => config && period ? inflationReleaseRows(config, metrics, period, core, mode) : [], [config, metrics, period, core, mode]);
  if (!config) return null;
  if (!period) return <div className="release-empty">No published period is available for this basket.</div>;
  const effects = rows.some(row => row.current != null);
  const kpis = (config.core ? [false, true] : [false]).flatMap(basket => (["mom", "yoy"] as const).map(measure => ({
    label: `${basket ? config.coreName ?? `Core ${config.title}` : config.headlineName ?? (config.core ? `Headline ${config.title}` : config.title)} ${measure === "yoy" ? "YoY" : "MoM"}`,
    value: buildInflationContributions(config, metrics, period, basket, measure).published,
  })));
  const selectedName = core ? config.coreName ?? `Core ${config.title}` : config.headlineName ?? (config.core ? `Headline ${config.title}` : config.title);
  return <ReleaseDriverReport title={selectedName} displayTitle={selectedName} onDisplayTitleChange={onDisplayTitleChange} period={period} mode={mode} rows={rows} effects={effects}
    headlineHistory={calendarWindow(period).map(month => ({ period: month, value: buildInflationContributions(config, metrics, month, core, mode).published }))}
    kpis={kpis} classified={config.headline === "us-cpi"} highlighted={hovered} onHighlight={setHovered} onOpen={row => row.metricId && onComponentOpen(row.metricId)}
    controls={<>
      {config.core && <div className="drivers-toggle" role="group" aria-label={config.headlineName ? "Core inflation index" : "Inflation basket"}>{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={core === value} onClick={() => setCore(value)}>{value ? config.coreName ?? "Core" : config.headlineName ?? "Headline"}</button>)}</div>}
      <div className="drivers-toggle" role="group" aria-label="Contribution measure">{(["mom", "yoy"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "yoy" ? "YoY" : "MoM"}</button>)}</div>
      <label className="release-period-control">Period<select aria-label="Contribution reference month" value={period} onChange={event => setSelectedPeriod(event.target.value)}>{periods.map(value => <option key={value} value={value}>{driverMonth(value)}</option>)}</select></label>
    </>}
    note={config.note ?? `Estimated effect ≈ beginning-of-comparison-period basket share × component inflation rate; these are not BLS-published category effects. US CPI uses BLS monthly relative importance from March 2012 where available; earlier periods remain component-rate views without weighted effects. Other mapped reference weights cover 2024–2026 (UK: February–December). Only disjoint component categories are totaled; the residual may reflect uncovered categories, rounding and aggregation differences. ${core ? "Weights are rebased to the core basket. " : ""}${effects ? "" : "Matching weights or monthly rates are unavailable; this view shows component rates, not a weighted decomposition."}`} noteSource={config.noteSource} />;
}
