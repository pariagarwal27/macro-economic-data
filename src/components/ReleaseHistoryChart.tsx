"use client";

import React, { useState, type CSSProperties } from "react";
import { buildReleaseHistoryChart, sortTooltipComponents } from "@/lib/release-history-chart";
import { driverDomain, type DriverHistoryPoint, type ReleaseDriverRow } from "@/lib/release-driver-model";

const PALETTE = ["#285b47", "#82a489", "#d7c49a", "#cf682f", "#498573", "#c59158", "#668793", "#927eaa", "#7d9862", "#bd8b85", "#5d7770", "#b99d72", "#9a775c", "#577f97", "#a9a15f"];
const formatValue = (value: number | null, unit = "") => value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}${unit}`;
const monthLabel = (month: string) => new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const longMonth = (month: string) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

export function ReleaseHistoryChart({ title, period, mode, rows, headlineHistory, rateLabel, classified = false, classificationBasis }: {
  title: string; period: string; mode: "mom" | "yoy"; rows: ReleaseDriverRow[];
  headlineHistory: DriverHistoryPoint[]; rateLabel: string; classified?: boolean; classificationBasis?: "pce-proxy";
}) {
  const [active, setActive] = useState<number | null>(null);
  const hasEffects = rows.some(row => row.effectHistory?.some(point => point.value != null && Number.isFinite(point.value)));
  // For retail, Eurostat publishes component growth rates but not weighted
  // contributions. Plot those rates as separate traces; never stack them.
  const componentChartRows = rows.map(row => ({ ...row, history: row.effectHistory ?? row.rateHistory ?? row.history }));
  const headlineByPeriod = new Map(headlineHistory.map(point => [point.period, point.value]));
  const reconciliation = classificationBasis === "pce-proxy" && hasEffects
    ? {
        id: "pce-chain-weighting-reconciliation",
        label: "Chain-weighting reconciliation",
        classification: "reconciliation",
        history: [...new Set(rows.flatMap(row => (row.effectHistory ?? []).map(point => point.period)))].flatMap(period => {
          const headline = headlineByPeriod.get(period);
          if (headline == null || !Number.isFinite(headline)) return [];
          if (rows.some(row => {
            const value = row.effectHistory?.find(point => point.period === period)?.value;
            return value == null || !Number.isFinite(value);
          })) return [];
          const displayed = rows.reduce((sum, row) => {
            const value = row.effectHistory?.find(point => point.period === period)?.value;
            return value != null && Number.isFinite(value) ? sum + value : sum;
          }, 0);
          return [{ period, value: headline - displayed }];
        }),
      }
    : null;
  const chartRows = reconciliation ? [...componentChartRows, reconciliation] : componentChartRows;
  const months = buildReleaseHistoryChart(chartRows, period, headlineHistory);
  const values = months.flatMap(month => [month.headline, ...(hasEffects ? [month.positiveTotal, month.negativeTotal] : month.segments.map(segment => segment.value))]);
  const [low, high] = driverDomain(values);
  const y = (value: number) => 172 - (value - low) / (high - low) * 138;
  const xs = months.map((_, i) => 105 + i * 140);
  const colors = new Map(chartRows.map((row, index) => [row.id, row.id === reconciliation?.id ? "#90958f" : PALETTE[index % PALETTE.length]]));
  const selected = active == null ? null : months[active];
  const selectedReconciled = Boolean(reconciliation && selected?.segments.some(segment => segment.id === reconciliation.id && segment.value != null));
  const selectedMissingCount = selected ? selected.missingCount - (reconciliation && !selectedReconciled ? 1 : 0) : 0;
  const tooltipRows = selected ? sortTooltipComponents(selected.segments.map(segment => {
    const row = rows.find(item => item.id === segment.id);
    const rate = row?.rateHistory?.find(point => point.period === selected.period)?.value ?? null;
    return { ...segment, value: hasEffects ? segment.value : rate };
  })) : [];
  const unit = mode === "mom" ? "MoM" : "YoY";
  const hasAnyData = months.some(month => month.headline != null || month.availableCount > 0) || (!hasEffects && rows.some(row => row.rateHistory?.some(point => months.some(month => month.period === point.period) && point.value != null && Number.isFinite(point.value))));
  return <div className="release-chart-panel">
    <header><h4>How {rateLabel === "Sales change" ? "retail sales are" : "inflation is"} evolving</h4></header>
    <p className="history-chart-description">{hasEffects ? `${classificationBasis === "pce-proxy" ? "Estimated component effects with a reconciliation to the published" : "Estimated component effects (stacked, pp) and published"} ${title} ${unit} (%)` : rateLabel === "Sales change" ? `Published ${title} ${unit} (%) and separate component rate traces. Component rates are not weighted contributions and are not stacked.` : `Published ${title} ${unit} (%). Weighted contributions are unavailable; component rates are not additive.`} Hover or focus a month for details.{classified && mode === "yoy" ? " US CPI component effects use seasonally adjusted indexes; headline YoY uses an unadjusted index." : ""}</p>
    {!hasAnyData ? <div className="history-chart-empty">No matching observations are available for these six months.</div> : <div className="history-chart-wrap" onMouseLeave={() => setActive(null)}>
      <svg className="history-chart-svg" viewBox="0 0 980 225" role="group" aria-label={`Six month ${title} ${unit} history. Focus a month to inspect its component details.`}>
        {[0, 1, 2, 3].map(index => { const tick = low + (high - low) * index / 3; return <g key={index}><line x1="62" x2="948" y1={y(tick)} y2={y(tick)} className="release-grid" /><text x="53" y={y(tick) + 4} textAnchor="end" className="release-axis-label">{tick.toFixed(2)}</text></g>; })}
        <line x1="62" x2="948" y1={y(0)} y2={y(0)} className="release-zero" />
        {months.map((month, index) => <g key={month.period}>
          {hasEffects && month.segments.map(segment => segment.value == null || segment.start == null || segment.end == null ? null : <rect key={segment.id} className="history-stack" x={xs[index] - 38} y={Math.min(y(segment.start), y(segment.end))} width="76" height={Math.max(segment.value === 0 ? 0 : 1, Math.abs(y(segment.start) - y(segment.end)))} fill={colors.get(segment.id)} />)}
          {!hasEffects && month.segments.map(segment => segment.value == null ? null : <circle key={`component-${segment.id}`} cx={xs[index]} cy={y(segment.value)} r="3.5" fill={colors.get(segment.id)} stroke="var(--panel)" strokeWidth="1" />)}
          {month.headline != null && <><circle cx={xs[index]} cy={y(month.headline)} r="4" fill="var(--ink)" /><text x={xs[index]} y={y(month.headline) - 9} textAnchor="middle" className="release-effect-label">{formatValue(month.headline)}</text></>}
          {index > 0 && month.headline != null && months[index - 1].headline != null && <line x1={xs[index - 1]} y1={y(months[index - 1].headline!)} x2={xs[index]} y2={y(month.headline)} stroke="var(--ink)" strokeWidth="2" />}
          <text x={xs[index]} y="204" textAnchor="middle" className="release-axis-label">{monthLabel(month.period)}</text>
          <rect x={xs[index] - 62} y="20" width="124" height="160" fill="transparent" tabIndex={0} role="button" aria-label={`${longMonth(month.period)}: show component details`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
        </g>)}
        {!hasEffects && chartRows.map(row => {
          const paths: Array<Array<{ x: number; y: number }>> = [];
          months.forEach((month, index) => {
            const value = month.segments.find(item => item.id === row.id)?.value;
            if (value == null) return;
            const point = { x: xs[index], y: y(value) };
            const lastPath = paths.at(-1);
            if (lastPath && index > 0 && month.segments.some(item => item.id === row.id && item.value != null) && months[index - 1].segments.some(item => item.id === row.id && item.value != null)) lastPath.push(point);
            else paths.push([point]);
          });
          return paths.map((path, index) => path.length > 1 ? <polyline key={`component-line-${row.id}-${index}`} points={path.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke={colors.get(row.id)} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /> : null);
        })}
      </svg>
      <div className="history-chart-tooltip-rail">{selected && <div className="history-chart-tooltip" role="tooltip">
        <div className="history-chart-tooltip-title">{longMonth(selected.period)} · {unit}</div>
        <table className="history-chart-tooltip-table"><tbody><tr><th>Published {title}</th><td>{formatValue(selected.headline, "%")}</td></tr>
          {tooltipRows.map(segment => <tr key={segment.id}><th>{segment.label}</th><td>{formatValue(segment.value, hasEffects ? " pp" : "%")}</td></tr>)}
          {hasEffects && <tr><th>{selectedReconciled ? "Shown net (reconciled)" : `Shown net${selectedMissingCount > 0 ? " (partial)" : " (estimated)"}`}</th><td>{formatValue(selected.shownNet, " pp")}</td></tr>}
        </tbody></table>
        {hasEffects && selectedMissingCount > 0 && <small>{selectedMissingCount} component{selectedMissingCount === 1 ? "" : "s"} unavailable. Shown net is partial and is not reconciled to the published headline.</small>}
        {!hasEffects && <small>Component rates are not weighted contributions.</small>}
      </div>}</div>
    </div>}
    <div className="history-chart-legend">{chartRows.map((row, index) => <span key={row.id}><i className="history-chart-key" style={{ "--history-key-color": colors.get(row.id) ?? PALETTE[index % PALETTE.length] } as CSSProperties} />{row.label}{hasEffects ? " · effect" : " · rate"}</span>)}<span><i className="history-chart-key" style={{ "--history-key-color": "var(--ink)" } as CSSProperties} />Published {title} {unit}</span></div>
  </div>;
}
