"use client";

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getHistoryHandleForYearClick, getHistoryYears, getInitialHistoryHandleRange, getInitialHistoryPlotRange, normalizeHistoryYearRange, type HistoryYearRange } from "@/lib/history-range";

/** Year picker for full-size charts. The plot remains full-width so both axes stay visible. */
export function HistoryChartViewport({
  dates,
  height,
  children,
  label = "Chart history",
  compact = false,
  fullHistoryByDefault = false,
  shortYearLabels = false,
  onRangeChange,
}: {
  dates: string[];
  frequency?: string;
  height: number;
  children: ReactNode | ((plotWidth: number, fromYear: number, toYear: number, isDefaultWindow: boolean) => ReactNode);
  label?: string;
  compact?: boolean;
  fullHistoryByDefault?: boolean;
  shortYearLabels?: boolean;
  onRangeChange?: (range: HistoryYearRange, isDefaultWindow: boolean) => void;
}) {
  const [plotWidth, setPlotWidth] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const rangeTrackRef = useRef<HTMLDivElement>(null);
  const years = useMemo(() => getHistoryYears(dates), [dates]);
  const latestYear = years.at(-1) ?? 2026;
  const [selectedRange, setSelectedRange] = useState<HistoryYearRange | null>(null);
  const initialHandleRange = fullHistoryByDefault && years.length
    ? { from: years[0]!, to: latestYear }
    : getInitialHistoryHandleRange(years);
  const initialPlotRange = fullHistoryByDefault && years.length
    ? { from: years[0]!, to: latestYear }
    : getInitialHistoryPlotRange(years);
  const handleRange = normalizeHistoryYearRange(selectedRange ?? initialHandleRange, years);
  const fromIndex = Math.max(0, years.indexOf(handleRange.from));
  const toIndex = Math.max(0, years.indexOf(handleRange.to));
  const isRangeActive = selectedRange != null;
  const plotRange = isRangeActive ? handleRange : initialPlotRange;
  const { from: fromYear, to: toYear } = plotRange;
  const isDefaultWindow = selectedRange == null;
  const plotFromYear = plotRange.from;
  const plotToYear = plotRange.to;
  const [draggingHandle, setDraggingHandle] = useState<"from" | "to" | null>(null);

  useEffect(() => {
    setSelectedRange(current => {
      if (!current) return current;
      const next = normalizeHistoryYearRange(current, years);
      return current.from === next.from && current.to === next.to ? current : next;
    });
  }, [years, latestYear]);

  useEffect(() => {
    onRangeChange?.({ from: plotFromYear, to: plotToYear }, isDefaultWindow);
  }, [isDefaultWindow, onRangeChange, plotFromYear, plotToYear]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () => setPlotWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const showNavigation = !compact && years.length > 1;
  const pickHandle = (handle: "from" | "to", index: number) => {
    const year = years[Math.max(0, Math.min(years.length - 1, index))];
    if (year == null) return;
    setSelectedRange(current => {
      const activeRange = normalizeHistoryYearRange(current ?? initialHandleRange, years);
      return handle === "from"
        ? { from: Math.min(year, activeRange.to), to: activeRange.to }
        : { from: activeRange.from, to: Math.max(year, activeRange.from) };
    });
  };
  const indexAtPointer = (clientX: number) => {
    const bounds = rangeTrackRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * (years.length - 1));
  };
  const moveHandleToPointer = (handle: "from" | "to", event: ReactPointerEvent<HTMLDivElement>) => {
    pickHandle(handle, indexAtPointer(event.clientX));
  };
  const pickYearLabel = (index: number) => {
    const handle = getHistoryHandleForYearClick(index, fromIndex, toIndex, isRangeActive);
    if (handle) pickHandle(handle, index);
    else if (index === fromIndex) setSelectedRange(handleRange);
  };
  const moveHandleByKey = (handle: "from" | "to", event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = handle === "from" ? fromIndex : toIndex;
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex = currentIndex - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex = currentIndex + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = years.length - 1;
    if (nextIndex != null) {
      event.preventDefault();
      pickHandle(handle, nextIndex);
    }
  };

  if (compact) return <>{typeof children === "function" ? children(plotWidth, fromYear, toYear, isDefaultWindow) : children}</>;

  return (
    <div className={`history-chart-viewport${showNavigation ? " has-history-navigation" : ""}`} style={{ height }} role="group" aria-label={label}>
      <div ref={plotRef} className="history-chart-scrollport">
        {typeof children === "function" ? children(plotWidth || 100, fromYear, toYear, isDefaultWindow) : children}
      </div>
      {showNavigation && <div className="history-chart-navigation">
        <div className="history-chart-range-layout">
          <span className="history-chart-range-label history-chart-range-from-label">From <strong>{handleRange.from}</strong></span>
          <div ref={rangeTrackRef} className="history-chart-range-slider">
            <span className="history-chart-range-track" />
            <span className="history-chart-range-selected" style={{ left: `${fromIndex / (years.length - 1) * 100}%`, right: `${100 - toIndex / (years.length - 1) * 100}%` }} />
            <div className={`history-chart-range-thumb history-chart-range-from${fromIndex === toIndex && toIndex === years.length - 1 ? " is-overlap-top" : ""}${draggingHandle === "from" ? " is-dragging" : ""}`} role="slider" tabIndex={0} aria-label={`From year for ${label}`} aria-valuemin={years[0]} aria-valuemax={handleRange.to} aria-valuenow={handleRange.from} aria-valuetext={`From ${handleRange.from}`} style={{ left: `${fromIndex / (years.length - 1) * 100}%` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDraggingHandle("from"); moveHandleToPointer("from", event); }} onPointerMove={event => { if (draggingHandle === "from") moveHandleToPointer("from", event); }} onPointerUp={() => setDraggingHandle(null)} onLostPointerCapture={() => setDraggingHandle(null)} onKeyDown={event => moveHandleByKey("from", event)} />
            <div className={`history-chart-range-thumb history-chart-range-to${fromIndex === toIndex && toIndex < years.length - 1 ? " is-overlap-top" : ""}${draggingHandle === "to" ? " is-dragging" : ""}`} role="slider" tabIndex={0} aria-label={`To year for ${label}`} aria-valuemin={handleRange.from} aria-valuemax={years.at(-1)} aria-valuenow={handleRange.to} aria-valuetext={`To ${handleRange.to}`} style={{ left: `${toIndex / (years.length - 1) * 100}%` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDraggingHandle("to"); moveHandleToPointer("to", event); }} onPointerMove={event => { if (draggingHandle === "to") moveHandleToPointer("to", event); }} onPointerUp={() => setDraggingHandle(null)} onLostPointerCapture={() => setDraggingHandle(null)} onKeyDown={event => moveHandleByKey("to", event)} />
          </div>
          <span className="history-chart-range-label history-chart-range-to-label">To <strong>{handleRange.to}</strong></span>
          <div className="history-chart-years" aria-label="Select a year; the nearest range handle moves to that year">
            {years.map((year, index) => <button type="button" key={year} className={`${index === 0 ? "is-first" : ""}${index === years.length - 1 ? " is-last" : ""}${year === handleRange.from ? " is-from" : ""}${year === handleRange.to ? " is-to" : ""}`} style={{ left: `${years.length > 1 ? index / (years.length - 1) * 100 : 0}%` }} aria-label={`Select ${year}; move the nearest range handle`} onClick={() => pickYearLabel(index)}>{shortYearLabels ? `'${String(year).slice(-2)}` : year}</button>)}
          </div>
        </div>
      </div>}
    </div>
  );
}
