"use client";

import { useMemo, useState } from "react";

export type SunburstDatum = {
  id: string;
  label: string;
  value: number | null;
  children?: SunburstDatum[];
};

type Segment = {
  id: string;
  label: string;
  value: number;
  depth: number;
  start: number;
  end: number;
  parentId?: string;
};

const cx = 310;
const cy = 250;
const TAU = Math.PI * 2;
const polar = (radius: number, angle: number) => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

function ringPath(inner: number, outer: number, start: number, end: number) {
  // SVG's A command cannot draw a full circle with one arc. A one-item
  // sunburst (common when only one component has a reading for a month) must
  // use two half-circle arcs or the segment collapses into oversized blobs.
  if (end - start >= TAU - 0.001) {
    const middle = start + Math.PI;
    const outerStart = polar(outer, start), outerMiddle = polar(outer, middle), outerEnd = polar(outer, start + TAU);
    const innerEnd = polar(inner, start + TAU), innerMiddle = polar(inner, middle), innerStart = polar(inner, start);
    return `M ${outerStart.x} ${outerStart.y} A ${outer} ${outer} 0 1 1 ${outerMiddle.x} ${outerMiddle.y} A ${outer} ${outer} 0 1 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${inner} ${inner} 0 1 0 ${innerMiddle.x} ${innerMiddle.y} A ${inner} ${inner} 0 1 0 ${innerStart.x} ${innerStart.y} Z`;
  }
  const a0 = start - 0.008;
  const a1 = end + 0.008;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(outer, a0), o1 = polar(outer, a1);
  const i1 = polar(inner, a1), i0 = polar(inner, a0);
  return `M ${o0.x} ${o0.y} A ${outer} ${outer} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${inner} ${inner} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
}

function textArcPath(radius: number, angle: number, desiredLength: number) {
  const span = Math.min(1.05, Math.max(0.34, desiredLength / radius));
  let from = angle - span / 2;
  let to = angle + span / 2;
  const reverse = Math.cos(angle) < 0;
  if (reverse) [from, to] = [to, from];
  const p0 = polar(radius, from), p1 = polar(radius, to);
  return `M ${p0.x} ${p0.y} A ${radius} ${radius} 0 0 ${reverse ? 0 : 1} ${p1.x} ${p1.y}`;
}

function colorFor(value: number, depth: number) {
  const base = value < 0 ? [29, 137, 151] : [220, 103, 54];
  const mix = depth === 1 ? 0 : depth === 2 ? 0.28 : 0.46;
  const rgb = base.map(channel => Math.round(channel + (255 - channel) * mix));
  return `rgb(${rgb.join(",")})`;
}

function formatValue(value: number, unit: "pp" | "%") {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}${unit === "%" ? "%" : " pp"}`;
}

function magnitude(node: SunburstDatum): number {
  if (node.value != null && Number.isFinite(node.value)) return Math.abs(node.value);
  return (node.children ?? []).reduce((sum, child) => sum + magnitude(child), 0);
}

export function SunburstChart({
  data,
  centerLabel,
  centerValue,
  period,
  unit = "pp",
  centerUnit,
  note,
  onSelect,
  highlightedId,
  showLegend = true,
}: {
  data: SunburstDatum[];
  centerLabel: string;
  centerValue: number | null;
  period: string;
  unit?: "pp" | "%";
  centerUnit?: "pp" | "%";
  note?: string;
  onSelect?: (id: string) => void;
  highlightedId?: string | null;
  showLegend?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => {
    if (!activeId) return null;
    for (const parent of data) {
      if (parent.id === activeId) return parent;
      const child = parent.children?.find(item => item.id === activeId);
      if (child) return child;
    }
    return null;
  }, [activeId, data]);
  const layout = useMemo(() => {
    const valid = data.filter(item => magnitude(item) > 0);
    const total = valid.reduce((sum, item) => sum + magnitude(item), 0);
    let angle = -Math.PI / 2;
    const parents: Segment[] = [];
    const children: Segment[] = [];
    for (const parent of valid) {
      const span = magnitude(parent) / total * TAU;
      const end = angle + span;
      parents.push({ id: parent.id, label: parent.label, value: parent.value ?? 0, depth: 1, start: angle, end });
      const kids = (parent.children ?? []).filter(child => magnitude(child) > 0);
      if (kids.length) {
        const childMagnitude = kids.reduce((sum, child) => sum + magnitude(child), 0);
        let childAngle = angle;
        for (const child of kids) {
          const childEnd = childAngle + span * magnitude(child) / childMagnitude;
          children.push({ id: child.id, label: child.label, value: child.value ?? 0, depth: 2, start: childAngle, end: childEnd, parentId: parent.id });
          childAngle = childEnd;
        }
      } else {
        children.push({ id: `${parent.id}:outer`, label: parent.label, value: parent.value ?? 0, depth: 2, start: angle, end, parentId: parent.id });
      }
      angle = end;
    }
    return { parents, children };
  }, [data]);
  const callouts = useMemo(() => {
    const candidates = layout.children.flatMap(segment => {
      const leaf = segment.id.endsWith(":outer");
      const parent = leaf ? data.find(item => item.id === segment.parentId) : undefined;
      const span = segment.end - segment.start;
      const label = leaf ? parent?.label : segment.label;
      if (!label || span < 0.11) return [];
      return [{ id: segment.id, label, value: segment.value, start: segment.start, end: segment.end, angle: (segment.start + segment.end) / 2, magnitude: Math.abs(segment.value) }];
    }).sort((a, b) => b.magnitude - a.magnitude).slice(0, 14);
    const placed = candidates.map(item => ({ ...item, side: Math.cos(item.angle) < 0 ? "left" as const : "right" as const, desiredY: cy + 181 * Math.sin(item.angle), y: 0 }));
    for (const side of ["left", "right"] as const) {
      const sideItems = placed.filter(item => item.side === side).sort((a, b) => a.desiredY - b.desiredY);
      if (!sideItems.length) continue;
      const gap = Math.min(27, 440 / Math.max(1, sideItems.length - 1));
      sideItems.forEach((item, index) => { item.y = Math.max(28, item.desiredY, index ? sideItems[index - 1].y + gap : 28); });
      const overflow = sideItems[sideItems.length - 1].y - 472;
      if (overflow > 0) sideItems.forEach(item => { item.y -= overflow; });
      if (sideItems[0].y < 28) {
        const shift = 28 - sideItems[0].y;
        sideItems.forEach(item => { item.y += shift; });
      }
    }
    return placed;
  }, [layout.children, data]);
  const highlighted = highlightedId ? [...data, ...data.flatMap(item => item.children ?? [])].find(item => item.id === highlightedId) : null;
  const displayActive = highlighted ?? active;
  const value = displayActive ? displayActive.value : centerValue;
  const label = displayActive?.label ?? centerLabel;

  return <div className={`drivers-sunburst-content${showLegend ? "" : " drivers-sunburst-content--chart-only"}`}>
    <svg className="drivers-sunburst" viewBox="0 0 620 500" role="img" aria-label={`${centerLabel}: ${centerValue == null ? "unavailable" : formatValue(centerValue, centerUnit ?? unit)}. Hover or focus a segment to inspect its value.`} onMouseLeave={() => setActiveId(null)}>
      <circle cx={cx} cy={cy} r="176" fill="none" stroke="var(--line)" strokeWidth="1" />
      {layout.parents.map(segment => <path key={`parent-${segment.id}`} d={ringPath(66, 112, segment.start, segment.end)} fill={colorFor(segment.value, 1)} opacity={!highlightedId || highlightedId === segment.id || layout.children.some(child => child.id === highlightedId && child.parentId === segment.id) ? 1 : 0.38} stroke="var(--panel)" strokeWidth="1.5" tabIndex={0} role="button" aria-label={`${segment.label}: ${formatValue(segment.value, unit)}`} onMouseEnter={() => setActiveId(segment.id)} onFocus={() => setActiveId(segment.id)} onBlur={() => setActiveId(null)} onClick={() => onSelect?.(segment.id)}><title>{segment.label}: {formatValue(segment.value, unit)}</title></path>)}
      {layout.children.map(segment => { const selectedId = segment.id.endsWith(":outer") ? segment.parentId! : segment.id; return <path key={`child-${segment.id}`} d={ringPath(114, 176, segment.start, segment.end)} fill={colorFor(segment.value, 2)} opacity={!highlightedId || highlightedId === selectedId || segment.parentId === highlightedId ? 1 : 0.38} stroke="var(--panel)" strokeWidth="1.5" tabIndex={0} role="button" aria-label={`${segment.label}: ${formatValue(segment.value, unit)}`} onMouseEnter={() => setActiveId(selectedId)} onFocus={() => setActiveId(selectedId)} onBlur={() => setActiveId(null)} onClick={() => onSelect?.(selectedId)}><title>{segment.label}: {formatValue(segment.value, unit)}</title></path>; })}
      <circle cx={cx} cy={cy} r="63" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      {layout.parents.map(segment => {
        const span = segment.end - segment.start;
        const parent = data.find(item => item.id === segment.id);
        const isFoodOrEnergy = ["food", "energy"].includes(segment.label.toLowerCase());
        if ((parent && !(parent.children?.length) && !isFoodOrEnergy) || segment.label.toLowerCase().includes("core goods")) return null;
        if (span < 0.08) return null;
        const angle = (segment.start + segment.end) / 2;
        const safeId = segment.id.replace(/[^a-zA-Z0-9_-]/g, "-");
        const labelPathId = `sunburst-group-label-${safeId}`;
        const valuePathId = `${labelPathId}-value`;
        // Extend the text baseline a little for narrow groups so the important
        // group name remains readable while still following the inner-ring curve.
        const labelPathLength = Math.max(68, Math.min(104, span * 88));
        const valuePathLength = Math.max(36, Math.min(88, span * 98));
        return <g key={`parent-label-${segment.id}`} className="drivers-sunburst-group-label" pointerEvents="none">
          <path id={labelPathId} d={textArcPath(88, angle, labelPathLength)} />
          <text><textPath href={`#${labelPathId}`} startOffset="50%" textAnchor="middle">{segment.label}</textPath></text>
          <path id={valuePathId} d={textArcPath(101, angle, valuePathLength)} />
          <text className="is-value-label"><textPath href={`#${valuePathId}`} startOffset="50%" textAnchor="middle">{formatValue(segment.value, unit)}</textPath></text>
        </g>;
      })}
      {callouts.map(item => {
        const anchor = polar(179, item.angle);
        const elbowX = item.side === "left" ? 126 : 494;
        const textX = item.side === "left" ? 116 : 504;
        const textAnchor = item.side === "left" ? "end" : "start";
        const lineEndX = item.side === "left" ? 120 : 500;
        const safeLabel = item.label.length > 20 ? `${item.label.slice(0, 19)}…` : item.label;
        return <g key={`callout-${item.id}`} className="drivers-sunburst-callout" pointerEvents="none">
          <path d={`M ${anchor.x} ${anchor.y} L ${elbowX} ${anchor.y} L ${elbowX} ${item.y} L ${lineEndX} ${item.y}`} />
          <circle cx={anchor.x} cy={anchor.y} r="2" />
          <text x={textX} y={item.y - 4} textAnchor={textAnchor}>
            <tspan x={textX}>{safeLabel}</tspan>
            <tspan x={textX} dy="13" className={item.value < 0 ? "is-negative" : "is-positive"}>{formatValue(item.value, unit)}</tspan>
          </text>
        </g>;
      })}
      <text x={cx} y={cy - 16} textAnchor="middle" className="drivers-sunburst-center-label">{label.length > 22 ? `${label.slice(0, 20)}…` : label}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="drivers-sunburst-center-value">{value == null ? "—" : formatValue(value, displayActive ? unit : centerUnit ?? unit)}</text>
      <text x={cx} y={cy + 36} textAnchor="middle" className="drivers-sunburst-center-period">{period}</text>
    </svg>
    {showLegend ? <div className="drivers-sunburst-legend" aria-label="Sunburst component values">
      {data.map(parent => <div className="drivers-sunburst-group" key={parent.id}>
        <button type="button" className="drivers-sunburst-item is-parent" onMouseEnter={() => setActiveId(parent.id)} onMouseLeave={() => setActiveId(null)} onFocus={() => setActiveId(parent.id)} onBlur={() => setActiveId(null)} onClick={() => onSelect?.(parent.id)}>
          <i style={{ background: colorFor(parent.value ?? 0, 1) }} /><span>{parent.label}</span><b>{parent.value == null ? "—" : formatValue(parent.value, unit)}</b>
        </button>
        {parent.children?.map(child => <button type="button" className="drivers-sunburst-item is-child" key={child.id} onMouseEnter={() => setActiveId(child.id)} onMouseLeave={() => setActiveId(null)} onFocus={() => setActiveId(child.id)} onBlur={() => setActiveId(null)} onClick={() => onSelect?.(child.id)}>
          <i style={{ background: colorFor(child.value ?? 0, 2) }} /><span>{child.label}</span><b>{child.value == null ? "—" : formatValue(child.value, unit)}</b>
        </button>)}
      </div>)}
      {note && <p className="drivers-sunburst-note">{note}</p>}
    </div> : note && <p className="drivers-sunburst-note drivers-sunburst-note--chart-only">{note}</p>}
  </div>;
}
