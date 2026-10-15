"use client";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
import { buildInflationContributions, CONTRIBUTION_CONFIGS, type ContributionMetrics, type ContributionMode } from "@/lib/inflation-contributions";

const pp = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${(Math.abs(value) < 0.005 ? 0 : value).toFixed(2)} pp`;
const percent = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;
const monthLabel = (period: string) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export function InflationContributions({ metricId, metrics }: { metricId: string; metrics: ContributionMetrics }) {
  const config = CONTRIBUTION_CONFIGS[metricId];
  const [core, setCore] = useState(metricId === config?.core);
  const [mode, setMode] = useState<ContributionMode>("yoy");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  if (!config) return null;
  const rootId = core ? config.core! : config.headline;
  // A published headline period anchors the decomposition; never mix component releases.
  const periods = [...new Set((metrics[rootId]?.history ?? []).map(point => point.date.slice(0, 7)).filter(period => /^2026-\d{2}$/.test(period)))].sort().reverse();
  const period = periods.includes(selectedPeriod) ? selectedPeriod : periods[0];
  if (!period) return <div className="drivers-empty">No published 2026 period is available for this basket. The mapped weights apply to 2026.</div>;
  const result = buildInflationContributions(config, metrics, period, core, mode);
  const upward = result.rows.find(row => row.current != null && row.current > 0);
  const downward = [...result.rows].reverse().find(row => row.current != null && row.current < 0);
  const values = result.rows.flatMap(row => [row.current, row.previous]).filter((value): value is number => value != null);
  const minimum = Math.min(0, ...values), maximum = Math.max(0.1, ...values);
  const padding = (maximum - minimum) * 0.12;
  const low = minimum - padding, high = maximum + padding;
  const position = (value: number) => (value - low) / (high - low) * 100;
  const zero = position(0);
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
    <div className="drivers-layout"><div className="drivers-main">
      <div className="drivers-chart-panel"><div className="drivers-chart-heading"><h4>Component contributions (percentage points)</h4><div className="drivers-chart-legend"><span><i className="drivers-current-key" />{monthLabel(period)}</span><span><i className="drivers-previous-key" />{monthLabel(result.priorPeriod)}</span></div></div>
        {values.length === 0 ? <p className="drivers-empty">Matching {mode === "mom" ? "monthly" : "annual"} component rates are not available for this period. Annual rates cannot be used to infer monthly contributions.</p> : <div className="drivers-bars" role="img" aria-label={`Estimated contributions for ${monthLabel(period)} compared with ${monthLabel(result.priorPeriod)}. Detailed values are in the table below.`}>
          {result.rows.map(row => <div key={row.id} className="drivers-bar-row"><span className="drivers-bar-name">{row.label}</span><div className="drivers-bar-track"><span className="drivers-zero" style={{ left: `${zero}%` }} />{row.previous != null && <span className="drivers-bar drivers-bar-previous" style={{ left: `${Math.min(zero, position(row.previous))}%`, width: `${Math.max(0.3, Math.abs(position(row.previous) - zero))}%` }} />}{row.current != null && <span className={`drivers-bar drivers-bar-current ${row.current < 0 ? "is-cooling" : "is-upward"}`} style={{ left: `${Math.min(zero, position(row.current))}%`, width: `${Math.max(0.3, Math.abs(position(row.current) - zero))}%` }} />}</div><b className={row.current != null && row.current < 0 ? "drivers-cooling" : "drivers-upward"}>{pp(row.current)}</b></div>)}
          <div className="drivers-axis"><span /><div>{Array.from({ length: 5 }, (_, index) => { const value = low + (high - low) * index / 4; return <span key={index} style={{ left: `${index * 25}%` }}>{value.toFixed(2)}</span>; })}</div><span /></div><p className="drivers-axis-title">Percentage points · solid bar: current month · light bar: previous month</p>
        </div>}
      </div>
      <div className="drivers-table-panel"><div className="drivers-chart-heading"><h4>Behind the contribution</h4><span>Published weights · estimated contributions</span></div><div className="drivers-table-scroll"><table><thead><tr><th>Component</th><th>{core ? "Core basket weight" : "Basket weight"}</th><th>Inflation ({mode === "yoy" ? "YoY" : "MoM"})</th><th>Previous month<br /><small>{monthLabel(result.priorPeriod)}</small></th><th>This month<br /><small>{monthLabel(period)}</small></th><th>Change (pp)</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{row.weight ? <a href={row.weight.source} target="_blank" rel="noreferrer" title={row.weight.basis}>{percent(row.share)}</a> : "—"}</td><td>{percent(row.currentRate)}</td><td>{pp(row.previous)}</td><td className={row.current != null && row.current < 0 ? "drivers-cooling" : "drivers-upward"}>{pp(row.current)}</td><td className={row.change != null && row.change < 0 ? "drivers-cooling" : "drivers-upward"}>{pp(row.change)}</td></tr>)}</tbody></table></div></div>
    </div><aside className="drivers-insights">
      <div className="drivers-insight"><ChartNoAxesCombined /><div><span>Published {basket}</span><strong>{result.published == null ? "—" : `${result.published.toFixed(1)}%`}</strong><p>{mode === "yoy" ? "Annual" : "Monthly"} inflation · {monthLabel(period)}</p></div></div>
      <div className="drivers-insight drivers-upward"><ArrowUpRight /><div><span>Largest upward contributor</span><h4>{upward?.label ?? "No upward contribution available"}</h4><strong>{pp(upward?.current ?? null)}</strong><p>Previous month: {pp(upward?.previous ?? null)}<br />Change: {pp(upward?.change ?? null)}</p></div></div>
      <div className="drivers-insight drivers-cooling"><ArrowDownRight /><div><span>Largest downward contributor</span><h4>{downward?.label ?? "No downward contribution"}</h4><strong>{pp(downward?.current ?? null)}</strong><p>{downward ? <>Previous month: {pp(downward.previous)}<br />Change: {pp(downward.change)}</> : "Available components are not reducing the rate."}</p></div></div>
      <div className="drivers-reconciliation"><b>Estimate coverage: {result.coverage.toFixed(1)}% of basket</b><span>Estimated sum: {values.length ? pp(result.estimated) : "—"}</span><span>Published minus estimated: {pp(result.residual)}</span></div>
    </aside></div>
    <p className="drivers-method">Estimated contribution ≈ basket weight × component inflation rate. These are not official contribution figures and may differ from the published total. {core ? "Core weights are rebased to the included core basket. " : ""}Only non-overlapping categories are included. — indicates a missing matching rate or applicable weight. Weights cover 2026 (UK: February–December); comparisons outside their validity require additional weight sets. Contributions update when matching component data arrive.</p>
  </section>;
}
