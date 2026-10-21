"use client";
import { useState } from "react";
import { buildInflationContributions, CONTRIBUTION_CONFIGS, type ContributionMetrics, type ContributionMode } from "@/lib/inflation-contributions";
import { SunburstChart, type SunburstDatum } from "@/components/SunburstChart";
import { DriversBreakdownTable } from "@/components/DriversBreakdownTable";

const pp = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${(Math.abs(value) < 0.005 ? 0 : value).toFixed(2)} pp`;
const ppNumber = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${(Math.abs(value) < 0.005 ? 0 : value).toFixed(2)}`;
const percent = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
const monthLabel = (period: string) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export function InflationContributions({ metricId, metrics, onComponentOpen }: { metricId: string; metrics: ContributionMetrics; onComponentOpen: (metricId: string) => void }) {
  const config = CONTRIBUTION_CONFIGS[metricId];
  const [core, setCore] = useState(metricId === config?.core);
  const [mode, setMode] = useState<ContributionMode>("yoy");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  if (!config) return null;
  const rootId = core ? config.core! : config.headline;
  // A published headline period anchors the decomposition; never mix component releases.
  const periods = [...new Set((metrics[rootId]?.history ?? []).map(point => point.date.slice(0, 7)).filter(period => /^2026-\d{2}$/.test(period)))].sort().reverse();
  const period = periods.includes(selectedPeriod) ? selectedPeriod : periods[0];
  if (!period) return <div className="drivers-empty">No published 2026 period is available for this basket. The mapped weights apply to 2026.</div>;
  const result = buildInflationContributions(config, metrics, period, core, mode);
  const sunburstData: SunburstDatum[] = result.rows.filter(row => row.countInTotal).map(row => ({
    id: row.id,
    label: row.label,
    value: row.current,
    children: result.rows.filter(child => child.parent === row.label).map(child => ({ id: child.id, label: child.label, value: child.current })),
  }));
  const values = result.rows.flatMap(row => [row.current, row.previous]).filter((value): value is number => value != null);
  const basket = `${core ? "Core " : ""}${config.title}`;
  return <section className="inflation-drivers" aria-label="Inflation component contributions">
    <header className="drivers-heading"><div><h3>What drove inflation?</h3><p>Component contributions to {basket} inflation · weighted estimates</p></div>
      <div className="drivers-controls">
        {config.core && <div className="drivers-toggle" role="group" aria-label="Inflation basket">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={core === value} onClick={() => setCore(value)}>{value ? "Core" : "Headline"}</button>)}</div>}
        <div className="drivers-toggle" role="group" aria-label="Contribution measure">{(["yoy", "mom"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "yoy" ? "YoY" : "MoM"}</button>)}</div>
        <select aria-label="Contribution reference month" value={period} onChange={event => setSelectedPeriod(event.target.value)}>{periods.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select>
        <span className="drivers-refresh"><i />Updates with published data</span>
      </div>
    </header>
    <div className="drivers-chart-panel drivers-contribution-panel"><div className="drivers-chart-heading"><h4>{basket} · {mode.toUpperCase()} contribution by group and subcomponent</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />{monthLabel(period)}</span><span>Hover a segment for its value</span></div></div>
      {!values.length ? <p className="drivers-empty">Matching {mode === "mom" ? "monthly" : "annual"} component rates are not available for this period. Annual rates cannot be used to infer monthly contributions.</p> : <div className="drivers-chart-table-layout">
        <SunburstChart data={sunburstData} centerLabel={`${basket} · ${mode.toUpperCase()}`} centerValue={result.published} centerUnit="%" period={monthLabel(period)} unit="pp" showLegend={false} highlightedId={hoveredComponent} note="Slice size shows the magnitude of estimated weighted contribution. Positive contributions are orange; negative contributions are teal." />
        <div>
          <DriversBreakdownTable
            unit={`Unit: pp · ${mode.toUpperCase()}`}
            columns={[
              { label: core ? "Core basket weight" : "Basket weight" },
              { label: "Inflation", detail: mode === "yoy" ? "YoY" : "MoM" },
              { label: "This month", detail: monthLabel(period) },
              { label: "Previous", detail: monthLabel(result.priorPeriod) },
              { label: "Change" },
            ]}
            rows={result.rows.map(row => ({
              id: row.id,
              label: row.label,
              depth: row.parent ? 1 : 0,
              polarity: row.current,
              cells: [
                row.weight ? <a key="weight" href={row.weight.source} target="_blank" rel="noreferrer" title={row.weight.basis}>{percent(row.share)}</a> : "—",
                percent(row.currentRate),
                <span key="current" className={row.current != null && row.current < 0 ? "drivers-cooling" : "drivers-upward"}>{ppNumber(row.current)}</span>,
                ppNumber(row.previous),
                <span key="change" className={row.change != null && row.change < 0 ? "drivers-cooling" : "drivers-upward"}>{ppNumber(row.change)}</span>,
              ],
            }))}
            onRowOpen={id => onComponentOpen(id)}
            onRowHover={setHoveredComponent}
          />
          <div className="drivers-reconciliation"><b>Estimate coverage: {result.coverage.toFixed(1)}% of basket</b><span>Estimated sum: {values.length ? pp(result.estimated) : "—"}</span><span>Published minus estimated: {pp(result.residual)}</span></div>
        </div>
      </div>}
    </div>
    <p className="drivers-method">Estimated contribution ≈ basket weight × component inflation rate. These are not official contribution figures and may differ from the published total. {core ? "Core weights are rebased to the included core basket. " : ""}Only non-overlapping categories are included. — indicates a missing matching rate or applicable weight. Weights cover 2026 (UK: February–December); comparisons outside their validity require additional weight sets. Contributions update when matching component data arrive.</p>
  </section>;
}
