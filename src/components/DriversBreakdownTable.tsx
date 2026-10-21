"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export type DriversBreakdownColumn = { label: string; detail?: string };
export type DriversBreakdownRow = {
  id: string;
  label: string;
  depth?: number;
  polarity?: number | null;
  cells: ReactNode[];
};

export function DriversBreakdownTable({
  title = "Component contributions",
  unit,
  columns,
  rows,
  onRowOpen,
  onRowHover,
}: {
  title?: string;
  unit?: string;
  columns: DriversBreakdownColumn[];
  rows: DriversBreakdownRow[];
  onRowOpen?: (id: string) => void;
  onRowHover?: (id: string | null) => void;
}) {
  return <div className="drivers-table-panel drivers-table-panel--side">
    <div className="drivers-chart-heading"><h4>{title}</h4>{unit && <span>{unit}</span>}</div>
    <div className="drivers-table-scroll"><table className="drivers-breakdown-table"><thead><tr>
      <th>Component</th>
      {columns.map((column, index) => <th key={`${column.label}-${index}`}>{column.label}{column.detail && <small>{column.detail}</small>}</th>)}
      {onRowOpen && <th aria-label="Open component card" />}
    </tr></thead><tbody>{rows.map(row => <tr key={row.id} className={row.depth ? "is-subcomponent" : "is-main-component"} onMouseEnter={() => onRowHover?.(row.id)} onMouseLeave={() => onRowHover?.(null)} onFocus={() => onRowHover?.(row.id)} onBlur={() => onRowHover?.(null)}>
      <th scope="row" style={row.depth ? { paddingLeft: `${22 + (row.depth - 1) * 14}px` } : undefined}>
        {onRowOpen ? <button type="button" className="drivers-component-button" onClick={() => onRowOpen(row.id)}><span className="drivers-component-label"><i className={`drivers-component-dot${row.polarity == null ? " is-neutral" : row.polarity < 0 ? " is-negative" : " is-positive"}`} /><span>{row.label}</span></span></button> : <span className="drivers-component-label"><i className={`drivers-component-dot${row.polarity == null ? " is-neutral" : row.polarity < 0 ? " is-negative" : " is-positive"}`} /><span>{row.label}</span></span>}
      </th>
      {row.cells.map((cell, index) => <td key={`${row.id}-${index}`}>{cell}</td>)}
      {onRowOpen && <td className="drivers-open-cell"><button type="button" className="drivers-open-component" aria-label={`Open ${row.label} component card`} title={`Open ${row.label} component card`} onClick={() => onRowOpen(row.id)}><ChevronRight size={17} /></button></td>}
    </tr>)}</tbody></table></div>
  </div>;
}
