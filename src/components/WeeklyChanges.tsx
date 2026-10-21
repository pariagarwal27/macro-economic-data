"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type Region = "US" | "UK" | "EA";
type Row = {
  id: string; region: Region; category: string; name: string; shortName: string;
  unit: string; frequency: string; importance: string; source: string; transform?: string;
  current: { date: string; value: number }; previous: { date: string; value: number };
  change: number; expectedValue: number | null; releasedAt: string | null;
};
type DisplayChange = {
  key: string; row: Row; period: "YoY" | "MoM"; previous: number; current: number; change: number;
};
type Range = "7" | "30" | "custom";
type Period = "YoY" | "MoM" | "QoQ";
type ComparisonMetric = {
  key: string;
  region: Region;
  label: string;
  primary: Row;
  readings: Partial<Record<Period, Row>>;
};
const periodOrder: Period[] = ["YoY", "MoM", "QoQ"];
const regionNames: Record<Region, string> = { US: "United States", UK: "United Kingdom", EA: "Euro Area" };
const categories = [
  ["inflation", "Prices & inflation"], ["jobs", "Labour market"], ["growth", "Activity & growth"],
] as const;
const fmt = (value: number, unit: string) => {
  const precision = Math.abs(value) < 10 ? 2 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: precision })}${unit === "percent" ? "%" : unit === "index" ? "" : unit ? ` ${unit}` : ""}`;
};
const fmtChange = (value: number, unit: string) => {
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 });
  const suffix = unit === "percent" ? "pp" : unit === "index" ? "" : unit ? ` ${unit}` : "";
  return `${value > 0 ? "+" : ""}${amount}${suffix}`;
};
const dateLabel = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const dateInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export function WeeklyChanges() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ratePairs, setRatePairs] = useState<{ region: Region; label: string; yoy: Row | null; mom: Row | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [range, setRange] = useState<Range>("30");
  const [fromDate, setFromDate] = useState(() => dateInputValue(new Date(Date.now() - 30 * 86400000)));
  const [toDate, setToDate] = useState(() => dateInputValue(new Date()));
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/weekly-changes", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Unable to load weekly changes"); return await response.json() as { rows: Row[]; ratePairs: { region: Region; label: string; yoy: Row | null; mom: Row | null }[] }; })
      .then(data => { setRows(data.rows); setRatePairs(data.ratePairs ?? []); })
      .catch(error => { if (!controller.signal.aborted) console.error(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const cutoff = range === "7" ? Date.now() - 7 * 86400000 : range === "30" ? Date.now() - 30 * 86400000 : new Date(`${fromDate}T00:00:00`).getTime();
    const end = range === "custom" ? new Date(`${toDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return rows.filter(row => {
      if (country !== "ALL" && row.region !== country) return false;
      if (category !== "ALL" && row.category !== category) return false;
      const released = row.releasedAt ? new Date(row.releasedAt).getTime() : new Date(row.current.date).getTime();
      if (released < cutoff || released > end) return false;
      return true;
    }).sort((a, b) => new Date(b.releasedAt ?? b.current.date).getTime() - new Date(a.releasedAt ?? a.current.date).getTime());
  }, [rows, country, category, range, fromDate, toDate]);
  const filteredPairs = useMemo(() => ratePairs.filter(pair => {
    if (country !== "ALL" && pair.region !== country) return false;
    if (category !== "ALL" && category !== "inflation") return false;
    return [pair.yoy, pair.mom].some(row => row && rowWithinDate(row, range, fromDate, toDate));
  }).map(pair => ({ ...pair, yoy: pair.yoy && rowWithinDate(pair.yoy, range, fromDate, toDate) ? pair.yoy : null, mom: pair.mom && rowWithinDate(pair.mom, range, fromDate, toDate) ? pair.mom : null })), [ratePairs, country, category, range, fromDate, toDate]);
  const displayChanges = useMemo(() => {
    const changes: DisplayChange[] = [];
    for (const pair of filteredPairs) {
      for (const period of ["yoy", "mom"] as const) {
        const row = pair[period];
        if (row) changes.push({ key: row.id, row, period: period.toUpperCase() as "YoY" | "MoM", previous: row.previous.value, current: row.current.value, change: row.change });
      }
    }
    for (const row of filtered) {
      if (row.category === "inflation" && (row.id.includes("cpi") || row.id.includes("hicp") || row.id.includes("pce"))) continue;
      changes.push({ key: row.id, row, period: /mom/i.test(row.shortName) ? "MoM" : "YoY", previous: row.previous.value, current: row.current.value, change: row.change });
    }
    return changes;
  }, [filtered, filteredPairs]);
  const movementGroups = useMemo(() => {
    const grouped = { better: [] as DisplayChange[], neutral: [] as DisplayChange[], worse: [] as DisplayChange[] };
    for (const change of displayChanges) grouped[weeklyAssessment(change.row, change.change)].push(change);
    return grouped;
  }, [displayChanges]);
  const biggest = [...displayChanges].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);
  const comparisonGroups = useMemo(() => categories.map(([key, label]) => {
    const byKey = new Map<string, ComparisonMetric>();
    for (const row of filtered.filter(item => item.category === key)) {
      const period = periodForRow(row);
      const metricLabel = baseMetricLabel(row);
      const baseKey = row.region + ":" + metricLabel.toLocaleLowerCase();
      let metricKey = baseKey;
      let metric = byKey.get(metricKey);
      if (period && metric?.readings[period]) {
        metricKey += ":" + row.id;
        metric = byKey.get(metricKey);
      }
      if (!metric) {
        metric = { key: metricKey, region: row.region, label: metricLabel, primary: row, readings: {} };
        byKey.set(metricKey, metric);
      }
      if (period) metric.readings[period] = row;
      if (new Date(row.releasedAt ?? row.current.date).getTime() > new Date(metric.primary.releasedAt ?? metric.primary.current.date).getTime()) metric.primary = row;
    }
    const rows = [...byKey.values()].sort((a, b) => new Date(b.primary.releasedAt ?? b.primary.current.date).getTime() - new Date(a.primary.releasedAt ?? a.primary.current.date).getTime());
    return { key, label, rows };
  }).filter(group => group.rows.length), [filtered]);
  const selectedFrom = range === "7" ? dateInputValue(new Date(Date.now() - 7 * 86400000)) : range === "30" ? dateInputValue(new Date(Date.now() - 30 * 86400000)) : fromDate;
  const selectedTo = range === "custom" ? toDate : dateInputValue(new Date());
  const totalChanges = displayChanges.length;

  return <section className="weekly-changes" aria-labelledby="weekly-title">
    <div className="weekly-toolbar">
      <div className="weekly-range" aria-label="Date range">{([["7", "Last 7 days"], ["30", "Last 30 days"], ["custom", "Custom"]] as [Range, string][]).map(([key, label]) => <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}</div>
      {range === "custom" && <div className="weekly-custom-dates"><label>From<input type="date" value={fromDate} max={toDate} onChange={event => setFromDate(event.target.value)} /></label><label>To<input type="date" value={toDate} min={fromDate} onChange={event => setToDate(event.target.value)} /></label></div>}
      <label>Country<select value={country} onChange={event => setCountry(event.target.value)}><option value="ALL">All countries</option>{(["US", "UK", "EA"] as Region[]).map(region => <option key={region} value={region}>{regionNames[region]}</option>)}</select></label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="ALL">All categories</option>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <div className="weekly-statusline"><span>{loading ? "Loading published observations…" : <>Showing <strong>{dateLabel(selectedFrom)}</strong> to <strong>{dateLabel(selectedTo)}</strong> · {totalChanges} changes</>}</span><span>Latest values · compared with the previous published reading</span></div>
    <section className="weekly-movement-summary" aria-label="Summary of improving, unchanged and worsening indicators">
      <h2>{movementHeadline(movementGroups)}</h2>
      <div className="weekly-movement-bar" aria-hidden="true"><i className="better" style={{ flex: movementGroups.better.length }} /><i className="worse" style={{ flex: movementGroups.worse.length }} /></div>
      <div className="weekly-movement-grid">
        <MovementCard title="Better" kind="better" rows={movementGroups.better} />
        <MovementCard title="Neutral or unchanged" kind="neutral" rows={movementGroups.neutral} />
        <MovementCard title="Worse" kind="worse" rows={movementGroups.worse} />
      </div>
    </section>
    <section className="weekly-movers"><div className="weekly-section-heading"><div><h2>Biggest movers</h2><p>Ranked by absolute change. Green means favorable for that metric; red means adverse.</p></div></div><div className="weekly-feature-grid"><section className="weekly-feature"><h2>Biggest increases</h2>{biggest.filter(change => change.change > 0).length ? biggest.filter(change => change.change > 0).map(change => <Feature key={change.key} change={change} scale={Math.max(...biggest.filter(item => item.change > 0).map(item => Math.abs(item.change)))} />) : <p>No increases in this period.</p>}</section><section className="weekly-feature"><h2>Biggest decreases</h2>{biggest.filter(change => change.change < 0).length ? biggest.filter(change => change.change < 0).map(change => <Feature key={change.key} change={change} scale={Math.max(...biggest.filter(item => item.change < 0).map(item => Math.abs(item.change)))} />) : <p>No decreases in this period.</p>}</section></div></section>
    <section className="weekly-table-section">
      {loading ? <div className="weekly-empty">Loading current data…</div> : comparisonGroups.length === 0 ? <div className="weekly-empty">No published metric changes match these filters. Try a wider date range.</div> : <div className="weekly-all-changes">
        <div className="weekly-all-heading"><h2>All changes</h2><span>Click a row to open its metric card</span></div>
        {comparisonGroups.map(group => {
          const tablePeriods: Period[] = group.key === "jobs"
            ? []
            : group.key === "inflation"
              ? ["YoY", "MoM"]
              : periodOrder.filter(period => group.rows.some(metric => metric.readings[period]));
          const hasGroupedPeriods = tablePeriods.length > 0;
          const hasInflationSeparator = group.key === "inflation";
          const metricColumnWidth = hasGroupedPeriods ? (hasInflationSeparator ? 18 : 14) : 24;
          const releaseColumnWidth = 10;
          const sourceColumnWidth = releaseColumnWidth;
          const groupedValueColumnWidth = hasGroupedPeriods
            ? (100 - metricColumnWidth - releaseColumnWidth - sourceColumnWidth) / (tablePeriods.length * 3)
            : 17;
          const changeColumnWidth = hasGroupedPeriods ? groupedValueColumnWidth : 22;
          const ordinaryValueColumnWidth = groupedValueColumnWidth;
          const betterCount = group.rows.reduce((count, metric) => count + Object.values(metric.readings).filter((row): row is Row => Boolean(row) && weeklyAssessment(row) === "better").length, 0);
          const worseCount = group.rows.reduce((count, metric) => count + Object.values(metric.readings).filter((row): row is Row => Boolean(row) && weeklyAssessment(row) === "worse").length, 0);
          return <div className="weekly-group" key={group.key}>
            <button className="weekly-group-heading" type="button" aria-expanded={!collapsed.includes(group.key)} onClick={() => setCollapsed(value => value.includes(group.key) ? value.filter(item => item !== group.key) : [...value, group.key])}>
              <span className="weekly-group-title"><b aria-hidden="true">⌄</b>{group.label}<small>{group.rows.length} indicators</small></span>
              <span className="weekly-group-score">{worseCount} worse · {betterCount} better</span>
            </button>
            {!collapsed.includes(group.key) && <div className="weekly-table-wrap"><table className={"weekly-comparison-table weekly-comparison-table--" + group.key}><colgroup>
              <col key="metric" style={{ width: `${metricColumnWidth}%` }} />
              {hasGroupedPeriods ? tablePeriods.flatMap(period => [
                <col key={period + "-new"} style={{ width: `${ordinaryValueColumnWidth}%` }} />,
                <col key={period + "-previous"} style={{ width: `${ordinaryValueColumnWidth}%` }} />,
                <col key={period + "-change"} style={{ width: `${changeColumnWidth}%` }} />,
              ]) : <><col key="new" style={{ width: `${ordinaryValueColumnWidth}%` }} /><col key="previous" style={{ width: `${ordinaryValueColumnWidth}%` }} /><col key="change" style={{ width: `${changeColumnWidth}%` }} /></>}
              <col key="release" style={{ width: `${releaseColumnWidth}%` }} /><col key="source" style={{ width: `${sourceColumnWidth}%` }} />
            </colgroup><thead>
              <tr><th rowSpan={hasGroupedPeriods ? 2 : 1}>Metric name</th>{hasGroupedPeriods ? tablePeriods.map(period => <th key={period} colSpan={3} className={"weekly-period-heading weekly-period-" + period.toLowerCase().replace(/\s+/g, "-")}>{period}</th>) : <><th className="weekly-flat-heading">New</th><th className="weekly-flat-heading">Previous</th><th className="weekly-flat-heading">Change</th></>}<th rowSpan={hasGroupedPeriods ? 2 : 1}>Release date</th><th rowSpan={hasGroupedPeriods ? 2 : 1}>Source</th></tr>
              {hasGroupedPeriods && <tr>{tablePeriods.flatMap(period => ["New", "Previous", "Change"].map((column, index) => <th key={period + column} className={`weekly-period-subheading${hasInflationSeparator && period === "MoM" && index === 0 ? " weekly-period-start" : ""}`}>{column}</th>))}</tr>}
            </thead>
              <tbody>{group.rows.map(metric => <tr key={metric.key} className="weekly-metric-row" tabIndex={0} role="link" aria-label={"Open " + metric.label + " for " + metric.region}
                onClick={() => window.location.assign("/country/" + metric.region.toLowerCase() + "?openMetric=" + encodeURIComponent(metric.primary.id))}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); window.location.assign("/country/" + metric.region.toLowerCase() + "?openMetric=" + encodeURIComponent(metric.primary.id)); } }}>
                <td className="weekly-metric-name"><div className="weekly-metric-label"><span className="weekly-country-tag" data-country={metric.region.toLowerCase()}>{metric.region}</span><span>{metric.label}</span></div></td>
                {hasGroupedPeriods ? tablePeriods.map(period => {
                  const row = metric.readings[period];
                  const startsMom = hasInflationSeparator && period === "MoM";
                  return <Fragment key={period}>{!row ? <td colSpan={3} className={`weekly-period-empty${startsMom ? " weekly-period-start" : ""}`} aria-label={period + " data unavailable"}>—</td> : <><td className={`weekly-period-value${startsMom ? " weekly-period-start" : ""}`}><strong>{fmt(row.current.value, row.unit)}</strong></td><td className="weekly-period-value">{fmt(row.previous.value, row.unit)}</td><td className="weekly-period-value"><span className={"weekly-change-badge " + weeklyAssessment(row)}>{row.change > 0 ? "▲" : row.change < 0 ? "▼" : "–"} {fmtChange(row.change, row.unit)}</span></td></>}</Fragment>;
                }) : <><td className="weekly-period-value"><strong>{fmt(metric.primary.current.value, metric.primary.unit)}</strong></td><td className="weekly-period-value">{fmt(metric.primary.previous.value, metric.primary.unit)}</td><td className="weekly-period-value"><span className={"weekly-change-badge " + weeklyAssessment(metric.primary)}>{metric.primary.change > 0 ? "▲" : metric.primary.change < 0 ? "▼" : "–"} {fmtChange(metric.primary.change, metric.primary.unit)}</span></td></>}
                <td>{new Date(metric.primary.releasedAt ?? metric.primary.current.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                <td>{formatSource(metric.primary.source)}</td>
              </tr>)}</tbody></table></div>}
          </div>;
        })}
      </div>}
    </section>
    <section className="weekly-heatmap"><div className="weekly-section-heading"><div><h2>Country comparison</h2><p>Latest change by country for each indicator available in more than one region.</p></div></div><div className="weekly-table-wrap"><table><thead><tr><th>Indicator</th>{(["US", "UK", "EA"] as Region[]).map(region => <th key={region}>{regionNames[region]}</th>)}</tr></thead><tbody>{[...new Set(filtered.map(row => row.shortName))].map(name => <tr key={name}><th>{name}</th>{(["US", "UK", "EA"] as Region[]).map(region => { const row = filtered.find(item => item.shortName === name && item.region === region); return <td key={region} data-move={row ? row.change > 0 ? "up" : row.change < 0 ? "down" : "flat" : "empty"}>{row ? fmtChange(row.change, row.unit) : "—"}</td>; })}</tr>)}</tbody></table></div></section>
  </section>;
}

function Feature({ change, scale }: { change: DisplayChange; scale: number }) {
  const row = change.row;
  const assessment = weeklyAssessment(row, change.change);
  const arrow = change.change > 0 ? "▲" : "▼";
  return <article className="weekly-feature-item">
    <a className="weekly-feature-link" href={metricHref(row)}>
      <div className="weekly-feature-copy"><span>{row.region} · {categories.find(([key]) => key === row.category)?.[1]}</span><h3>{row.shortName} ({change.period})</h3><small>{fmt(change.previous, row.unit)} → {fmt(change.current, row.unit)}</small></div>
      <strong className={"weekly-feature-change " + assessment}>{arrow} {fmtChange(change.change, row.unit)}</strong>
      <div className="weekly-feature-track" aria-hidden="true"><i className={assessment} style={{ width: Math.max(5, Math.abs(change.change) / (scale || 1) * 100) + "%" }} /></div>
    </a>
  </article>;
}

function periodForRow(row: Row): Period {
  const text = `${row.shortName} ${row.name} ${row.id}`;
  if (/\b(?:qoq|q\/q|quarter[- ]on[- ]quarter)\s*(?:saar|annuali[sz]ed|annual rate)\b|qoq[-_]saar/i.test(text)) return "QoQ";
  if (/\b(?:yoy|year[- ]on[- ]year|12[- ]month(?:ly)?)\b|[-_]yoy(?:$|[-_])/i.test(text) || /pct_change_yoy/i.test(row.transform ?? "")) return "YoY";
  if (/\b(?:qoq|q\/q|quarter[- ]on[- ]quarter)\b|[-_]qoq(?:$|[-_])/i.test(text) || /pct_change_qoq/i.test(row.transform ?? "")) return "QoQ";
  if (/\b(?:mom|month[- ]on[- ]month)\b|[-_]mom(?:$|[-_])/i.test(text) || /pct_change_mom/i.test(row.transform ?? "")) return "MoM";
  if (/monthly/i.test(row.frequency)) return "MoM";
  if (/quarterly/i.test(row.frequency)) return "QoQ";
  if (/annual|yearly/i.test(row.frequency)) return "YoY";
  return "MoM";
}

function formatSource(source: string) {
  const key = source.trim().toLowerCase();
  const known: Record<string, string> = { bls: "BLS", fred: "FRED", ons: "ONS", lseg: "LSEG", bea: "BEA", eurostat: "Eurostat", destatis: "Destatis", insee: "INSEE" };
  return known[key] ?? source.replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function baseMetricLabel(row: Row): string {
  const withoutPeriod = row.shortName
    .replace(/\s*\(?\b(?:YoY|year[- ]on[- ]year|12[- ]month(?:ly)?|QoQ\s*SAAR|QoQ|Q\/Q|quarter[- ]on[- ]quarter|MoM|month[- ]on[- ]month|WoW|week[- ]on[- ]week)\b\)?\s*$/i, "")
    .replace(/[\s,–—-]+$/, "");
  return withoutPeriod || row.shortName;
}

function weeklyAssessment(row: Row, change = row.change): "better" | "neutral" | "worse" {
  if (Math.abs(change) < 0.000001) return "neutral";
  const label = (row.id + " " + row.shortName + " " + row.name).toLowerCase();
  // Price pressure and labor slack improve when they fall. In the other
  // published dashboard series, increases are treated as stronger activity.
  const decreaseIsBetter = row.category === "inflation" ||
    (row.category === "jobs" && /(unemployment|jobless|claims|layoff|inactivity)/.test(label));
  return (change < 0) === decreaseIsBetter ? "better" : "worse";
}

function movementHeadline(groups: { better: DisplayChange[]; neutral: DisplayChange[]; worse: DisplayChange[] }) {
  const parts: string[] = [];
  if (groups.better.length) parts.push(groups.better.length + " indicators improved");
  if (groups.worse.length) parts.push(groups.worse.length + " worsened");
  if (groups.neutral.length) parts.push(groups.neutral.length + " were unchanged");
  return parts.length ? parts.join(", ") + "." : "No published changes in this date range.";
}

function rowWithinDate(row: Row, range: Range, fromDate: string, toDate: string) {
  const cutoff = range === "7" ? Date.now() - 7 * 86400000 : range === "30" ? Date.now() - 30 * 86400000 : new Date(fromDate + "T00:00:00").getTime();
  const end = range === "custom" ? new Date(toDate + "T23:59:59.999").getTime() : Number.POSITIVE_INFINITY;
  const released = row.releasedAt ? new Date(row.releasedAt).getTime() : new Date(row.current.date).getTime();
  return released >= cutoff && released <= end;
}

function MovementCard({ title, kind, rows }: { title: string; kind: "better" | "neutral" | "worse"; rows: DisplayChange[] }) {
  const grouped = new Map<string, { label: string; region: Region; yoy?: DisplayChange; mom?: DisplayChange }>();
  for (const change of rows) {
    const label = change.row.shortName.replace(/\s+(YoY|MoM)$/i, "").replace(/\s+(Headline|YoY|MoM)$/i, "");
    const key = change.row.region + ":" + label;
    const entry = grouped.get(key) ?? { label, region: change.row.region };
    entry[change.period.toLowerCase() as "yoy" | "mom"] = change;
    grouped.set(key, entry);
  }
  const visible = [...grouped.values()].slice(0, 5);
  const valueCell = (change?: DisplayChange) => change ? <a className="weekly-rate-cell" aria-label={change.period + " change: " + fmtChange(change.change, change.row.unit)} href={metricHref(change.row)}><strong>{change.change > 0 ? "▲" : change.change < 0 ? "▼" : "–"} {fmtChange(change.change, change.row.unit)}</strong></a> : <span className="weekly-rate-empty">—</span>;
  return <article className={"weekly-movement-card " + kind}><h3>{title}<span>{grouped.size}</span></h3><div className="weekly-rate-columns"><span>Metric</span><span>YoY</span><span>MoM</span></div>{visible.length ? <ul>{visible.map(entry => <li key={entry.region + ":" + entry.label}><span className="weekly-movement-region">{entry.region}</span><span className="weekly-movement-name">{entry.label}</span>{valueCell(entry.yoy)}{valueCell(entry.mom)}</li>)}</ul> : <p>None</p>}{grouped.size > visible.length && <small>+ {grouped.size - visible.length} more in the table below</small>}</article>;
}

function metricHref(row: Row) {
  return "/country/" + row.region.toLowerCase() + "?openMetric=" + encodeURIComponent(row.id);
}
