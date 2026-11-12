"use client";

import React, { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CLASSIFICATION_SOURCE, CLASSIFICATION_TABLE, rankedDrivers, type DriverClassification, type ReleaseDriverRow } from "@/lib/release-driver-model";
import { completeMomentumTotal, componentMomentumRows, momentumColor } from "@/lib/component-momentum";
import { ReleaseHistoryChart } from "./ReleaseHistoryChart";
import type { DriverHistoryPoint } from "@/lib/release-driver-model";

const GROUPS: Record<DriverClassification, { label: string; note: string; color: string }> = {
  sticky: { label: "Sticky-price components", note: "Less frequent price changes", color: "var(--release-sticky)" },
  flexible: { label: "Flexible-price components", note: "More frequent price changes", color: "var(--release-flexible)" },
  mixed: { label: "Mixed components", note: "Basket contains different price-setting behaviors", color: "var(--release-mixed)" },
  unclassified: { label: "Other components", note: "No source-matched sticky / flexible classification", color: "var(--release-unclassified)" },
};
export function driverNumber(value: number | null, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.00005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}${suffix}`;
}
export function driverMonth(period: string, short = false) {
  return new Intl.DateTimeFormat("en", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
}

function ComponentMomentum({ rows, period, mode, rateLabel, classified, classificationBasis, kind, onOpen, highlighted, onHighlight }: { rows: ReleaseDriverRow[]; period: string; mode: "mom" | "yoy"; rateLabel: string; classified: boolean; classificationBasis?: "pce-proxy"; kind: "rate" | "effect"; onOpen?: (row: ReleaseDriverRow) => void; highlighted: string | null; onHighlight: (id: string | null) => void }) {
  const isEffect = kind === "effect";
  const showWeight = !isEffect && rateLabel !== "Sales change";
  const { months, rows: components } = componentMomentumRows(rows.map(row => ({ ...row, rateHistory: isEffect ? row.effectHistory : row.rateHistory })), period);
  const values = components.flatMap(row => row.values.filter((value): value is number => value != null));
  const scale = Math.max(0, ...values.map(value => Math.abs(value)));
  const measure = `${mode === "mom" ? "MoM" : "YoY"} ${rateLabel === "Sales change" ? "sales change" : "inflation rate"}`;
  const groups = (["sticky", "flexible", "mixed", "unclassified"] as const).filter(group => components.some(row => row.classification === group));
  const suffix = isEffect ? " pp" : "%";
  const showThreeMonth = classified || classificationBasis === "pce-proxy";
  const threeMonthValue = (row: ReleaseDriverRow) => (isEffect ? row.threeMonthEffect : row.threeMonthSaar) ?? null;
  const threeMonthTitle = isEffect
    ? `Estimated annualized contribution: three-month component inflation × ${classificationBasis === "pce-proxy" ? "average expenditure share at the start and end of the three-month window" : "basket share at the start of the three-month window"}`
    : "Compounded change over the three months through the selected month, annualized";
  const totalRow = (items: typeof components, label: string) => <tr className="momentum-total"><th scope="row">{label}</th>{!isEffect && <td />}{months.map((month, index) => <td key={month}>{driverNumber(completeMomentumTotal(items.map(row => row.values[index])), suffix)}</td>)}{showThreeMonth && <td>{driverNumber(completeMomentumTotal(items.map(threeMonthValue)), suffix)}</td>}</tr>;
  if (isEffect && rateLabel === "Sales change" && values.length === 0) return <section className="momentum-panel" aria-label="Component effects over the last six months">
    <header className="momentum-panel-header"><h4>Component effects · last 6 months</h4><p>Weighted component effects (pp)</p></header>
    <p className="momentum-empty">Eurostat publishes each retail category’s rate of change, but this basket has no source-matched monthly contribution weights. Component effects and a stacked total cannot be calculated from the published rates.</p>
  </section>;
  return <section className="momentum-panel" aria-label={isEffect ? "Component effects over the last six months" : "Component momentum over the last six months"}>
    <header className="momentum-panel-header"><h4>{isEffect ? "Component effects · last 6 months" : "Component momentum · last 6 months"}</h4><p>{isEffect ? `${mode === "mom" ? "MoM" : "YoY"} estimated component effects (pp) · totals require all components and are not reconciled to the headline${values.length ? "" : " · Weighted component effects are unavailable for this basket"}` : `${measure} by component (%)${classified && mode === "yoy" ? " · US CPI component YoY rates use seasonally adjusted indexes; headline YoY uses an unadjusted index" : ""}`}{showThreeMonth && ` · final column: 3m/3m SAAR ${isEffect ? "estimated effect (pp)" : "rate (%)"} through ${driverMonth(period)}`} · same zero-centered color scale across monthly cells · — means unavailable</p></header>
    {components.length ? <div className="momentum-panel-content">
      <div className="momentum-table-wrap"><table className={`momentum-table ${isEffect ? "momentum-effects" : "momentum-rates"}`}><thead><tr><th scope="col">Component</th>{showWeight && <th scope="col">{classificationBasis === "pce-proxy" ? "Base-period expenditure share" : "Basket weight"}</th>}{months.map(month => <th scope="col" key={month}>{driverMonth(month)}</th>)}{showThreeMonth && <th scope="col" title={threeMonthTitle}>3m/3m SAAR{isEffect ? " (pp)" : ""}</th>}</tr></thead>
        {groups.map(group => { const items = components.filter(row => row.classification === group); const config = GROUPS[group]; const label = classificationBasis === "pce-proxy" ? group === "sticky" ? "Sticky-price proxy components" : group === "flexible" ? "Flexible-price proxy components" : "Unclassified components" : group === "unclassified" ? "Unclassified components" : config.label; const groupNote = classificationBasis === "pce-proxy" ? group === "sticky" ? "selected service categories · analytical proxy" : group === "flexible" ? "selected goods categories · analytical proxy" : "BEA does not publish a matched monthly index" : group === "unclassified" ? rateLabel === "Sales change" ? "Retail price-stickiness classification is not applicable" : "No source-matched classification" : config.note; return <tbody key={group}>
          <tr className={`momentum-group momentum-group--${group}`}><th scope="rowgroup" colSpan={months.length + (showWeight ? 2 : 1) + (showThreeMonth ? 1 : 0)}><i style={{ background: config.color }} />{label} <span>{groupNote}</span></th></tr>
          {items.map(row => <tr key={row.id} className={highlighted === row.id ? "is-highlighted" : undefined} onMouseEnter={() => onHighlight(row.id)} onMouseLeave={() => onHighlight(null)}><th scope="row" className="momentum-component">{onOpen && row.metricId ? <button type="button" onClick={() => onOpen(row)}>{row.label}</button> : row.label}</th>
            {showWeight && <td className="momentum-weight">{row.weight != null ? row.weightSource ? <a href={row.weightSource} target="_blank" rel="noreferrer" title={row.weightNote}>{row.weight.toFixed(2)}%</a> : <span title={row.weightNote}>{row.weight.toFixed(2)}%</span> : <span title={row.weightNote}>—</span>}</td>}
            {row.values.map((value, index) => <td key={months[index]} data-missing={value == null ? "true" : undefined} style={value == null ? undefined : { "--momentum-color": momentumColor(value, scale) } as CSSProperties} title={`${row.label} · ${driverMonth(months[index])}: ${driverNumber(value, suffix)}`}>{driverNumber(value, suffix)}</td>)}{showThreeMonth && <td data-missing={threeMonthValue(row) == null ? "true" : undefined} title={threeMonthTitle}>{driverNumber(threeMonthValue(row), suffix)}</td>}</tr>)}
          {isEffect && values.length > 0 && totalRow(items, "Group subtotal")}
        </tbody>; })}
        {isEffect && values.length > 0 && <tbody>{totalRow(components, "TOTAL — DISPLAYED COMPONENTS")}</tbody>}
      </table></div>
      <div className="momentum-legend" aria-label={`Color scale: lower ${isEffect ? "effects" : "rates"} are red, zero is neutral, higher ${isEffect ? "effects" : "rates"} are green`}><span>Lower / higher {isEffect ? "effect" : "rate"}</span><i className="momentum-legend-gradient" /><div className="momentum-legend-labels"><span>Lower</span><span>0</span><span>Higher</span></div><span>Same scale for all cells</span></div>
    </div> : <p className="momentum-empty">No component history is available for this period.</p>}
  </section>;
}

export function ReleaseDriverReport({ title, displayTitle, onDisplayTitleChange, period, mode, rows, effects, controls, kpis, note, noteSource, onOpen, highlighted = null, onHighlight = () => {}, rateLabel = "Inflation", classified = false, classificationBasis, headlineHistory = [] }: {
  title: string; period: string; mode: "mom" | "yoy"; rows: ReleaseDriverRow[]; effects: boolean;
  controls?: ReactNode; kpis?: Array<{ label: string; value: number | null }>;
  note: string; noteSource?: { label: string; url: string }; published?: number | null; onOpen?: (row: ReleaseDriverRow) => void;
  displayTitle?: string; onDisplayTitleChange?: (title: string) => void;
  highlighted?: string | null; onHighlight?: (id: string | null) => void;
  rateLabel?: string; classified?: boolean;
  classificationBasis?: "pce-proxy";
  headlineHistory?: DriverHistoryPoint[];
}) {
  const [summaryTarget, setSummaryTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSummaryTarget(document.querySelector<HTMLElement>(".release-driver-dialog .release-card-summary-slot"));
  }, []);
  useEffect(() => {
    if (displayTitle) onDisplayTitleChange?.(displayTitle);
  }, [displayTitle, onDisplayTitleChange]);
  const sorted = rankedDrivers(rows, effects);
  const leader = sorted.find(row => effects ? row.current != null : row.rate != null);
  const leaderCategory = leader?.classification === "sticky" ? classificationBasis === "pce-proxy" ? "Sticky-price proxy" : "Sticky-price" : leader?.classification === "flexible" ? classificationBasis === "pce-proxy" ? "Flexible-price proxy" : "Flexible-price" : leader?.classification === "mixed" ? "Mixed" : "Unclassified";
  const leaderPersistence = classificationBasis === "pce-proxy" ? "" : leader?.classification === "flexible" ? "likely temporary" : leader?.classification === "sticky" ? "potentially persistent" : "persistence unclear";
  const leaderContext = classificationBasis === "pce-proxy"
    ? "Analytical grouping by BEA product type; BEA does not publish a PCE sticky/flexible classification, so this does not establish persistence."
    : leader?.classification === "flexible"
    ? "Flexible prices reprice more often; the inflation impulse may fade, but can reverse or persist."
    : leader?.classification === "sticky"
      ? "Sticky prices reprice less often and can keep inflation pressure persistent; this is not a guarantee."
      : "This classification does not establish whether the inflation impulse is temporary or persistent.";
  const summary = <div className="release-card-summary">
    {kpis?.length ? <div className={`release-kpis ${kpis.length === 4 ? "is-four" : ""}`}>{kpis.map(kpi => <div key={kpi.label}><span>{kpi.label.replace(/ CPI /g, " ").replace(/ PCE /g, " ")}</span><strong>{driverNumber(kpi.value, "%")}</strong></div>)}</div> : null}
    <div className="drivers-controls">{controls}</div>
  </div>;
  return <section className="release-report" aria-label={`${title} release breakdown`}>
    {summaryTarget ? createPortal(summary, summaryTarget) : <div className="release-report-heading">{summary}</div>}
    {leader && <div className="release-takeaway"><b>{effects ? "Largest driver" : "Largest component rate"}: {leader.label} <span className={`release-driver-classification release-driver-classification--${leader.classification}`} style={{ "--release-driver-color": GROUPS[leader.classification].color } as CSSProperties}>{leaderCategory}{leaderPersistence ? ` (${leaderPersistence})` : ""}</span> {driverNumber(effects ? leader.current : leader.rate, effects ? " pp" : "%")}</b><span>{leaderContext} {!effects && "Component rates are not weighted contributions and cannot be summed."}</span></div>}
    <ReleaseHistoryChart title={title} period={period} mode={mode} rows={rows} headlineHistory={headlineHistory} rateLabel={rateLabel} classified={classified} classificationBasis={classificationBasis} />
    <ComponentMomentum rows={sorted} period={period} mode={mode} rateLabel={rateLabel} classified={classified} classificationBasis={classificationBasis} kind="rate" onOpen={onOpen} highlighted={highlighted} onHighlight={onHighlight} />
    <ComponentMomentum rows={sorted} period={period} mode={mode} rateLabel={rateLabel} classified={classified} classificationBasis={classificationBasis} kind="effect" onOpen={onOpen} highlighted={highlighted} onHighlight={onHighlight} />
    <footer className="release-method"><p>{note}{noteSource && <> <a href={noteSource.url} target="_blank" rel="noreferrer">{noteSource.label}</a>.</>}</p>{classified && <p>Classification: <a href={CLASSIFICATION_SOURCE} target="_blank" rel="noreferrer">Atlanta Fed methodology</a> · <a href={CLASSIFICATION_TABLE} target="_blank" rel="noreferrer">component reference</a>. Sticky / flexible describes price-adjustment frequency, not permanent / temporary inflation.</p>}</footer>
  </section>;
}
