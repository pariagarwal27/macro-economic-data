"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

/** Year picker for full-size charts. The plot remains full-width so both axes stay visible. */
export function HistoryChartViewport({
  dates,
  children,
  label = "Chart history",
  compact = false,
  onYearChange,
}: {
  dates: string[];
  frequency?: string;
  height: number;
  children: ReactNode | ((plotWidth: number, year: number) => ReactNode);
  label?: string;
  compact?: boolean;
  onYearChange?: (year: number) => void;
}) {
  const [plotWidth, setPlotWidth] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);
  const years = useMemo(() => {
    const availableYears = Array.from(new Set(
      dates.map(date => Number(String(date).slice(0, 4))).filter(year => Number.isFinite(year) && year <= 2026),
    )).sort((a, b) => a - b);
    const latestAvailableYear = availableYears.at(-1);
    if (latestAvailableYear == null) return [];
    const firstYear = latestAvailableYear - 9;
    return availableYears.filter(year => year >= firstYear);
  }, [dates]);
  const latestYear = years.includes(2026) ? 2026 : years.at(-1) ?? 2026;
  const [selectedYear, setSelectedYear] = useState(latestYear);

  useEffect(() => {
    setSelectedYear(current => years.includes(current) ? current : latestYear);
  }, [years, latestYear]);

  useEffect(() => {
    onYearChange?.(selectedYear);
  }, [onYearChange, selectedYear]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () => setPlotWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = Math.max(0, years.indexOf(selectedYear));
  const showNavigation = !compact && years.length > 1;
  const pickYear = (index: number) => {
    const year = years[Math.max(0, Math.min(years.length - 1, index))];
    if (year != null) setSelectedYear(year);
  };
  const labelYears = years;

  if (compact) return <>{typeof children === "function" ? children(plotWidth, selectedYear) : children}</>;

  return (
    <div className={`history-chart-viewport${showNavigation ? " has-history-navigation" : ""}`} role="group" aria-label={label}>
      <div ref={plotRef} className="history-chart-scrollport">
        {typeof children === "function" ? children(plotWidth || 100, selectedYear) : children}
      </div>
      {showNavigation && <div className="history-chart-navigation">
        <button type="button" aria-label="Show previous year" disabled={selectedIndex === 0} onClick={() => pickYear(selectedIndex - 1)}>‹</button>
        <div className="history-chart-timeline">
          <input
            type="range"
            min={0}
            max={years.length - 1}
            step={1}
            value={selectedIndex}
            aria-label={`Select year for ${label}`}
            onChange={event => pickYear(Number(event.currentTarget.value))}
          />
          <div className="history-chart-years">
            {labelYears.map(year => {
              const index = years.indexOf(year);
              return <button key={year} type="button" className={`${year === selectedYear ? "is-selected" : ""}${index === 0 ? " is-first" : ""}${index === years.length - 1 ? " is-last" : ""}`} style={{ left: `${years.length > 1 ? index / (years.length - 1) * 100 : 0}%` }} aria-pressed={year === selectedYear} onClick={() => pickYear(index)}>{year}</button>;
            })}
          </div>
          <span className="history-chart-hint">Select a year to view its readings</span>
        </div>
        <button type="button" aria-label="Show next year" disabled={selectedIndex >= years.length - 1} onClick={() => pickYear(selectedIndex + 1)}>›</button>
      </div>}
    </div>
  );
}
