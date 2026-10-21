"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Entry = { id: string; region: "US" | "UK" | "EA"; category: string; label: string; searchText: string };
const regionName = { US: "United States", UK: "United Kingdom", EA: "Euro Area" };

export function GlobalMetricSearch() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/metric-search", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Metric search unavailable");
        return await response.json() as Entry[];
      })
      .then(setEntries)
      .catch(error => { if (!controller.signal.aborted) console.error(error); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return entries.filter(entry => terms.every(term => entry.searchText.includes(term))).slice(0, 8);
  }, [entries, query]);

  const navigate = (entry: Entry) => {
    window.location.assign("/country/" + entry.region.toLowerCase() + "?openMetric=" + encodeURIComponent(entry.id));
  };

  return <div className="global-metric-search" ref={root}>
    <Search size={16} aria-hidden="true" />
    <input
      type="search"
      aria-label="Search all dashboard metrics"
      aria-expanded={open && matches.length > 0}
      aria-controls="global-metric-search-results"
      placeholder="Search metrics…"
      value={query}
      onFocus={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); setQuery(""); }
        if (event.key === "Enter" && matches[0]) navigate(matches[0]);
      }}
    />
    {open && query.trim() && <div id="global-metric-search-results" className="global-metric-search-results" role="listbox" aria-label="Matching metrics">
      {matches.length ? matches.map(entry => <button key={entry.region + ":" + entry.id} type="button" role="option" onClick={() => navigate(entry)}>
        <span>{entry.label}</span><small>{regionName[entry.region]} · {entry.category}</small>
      </button>) : <p>No matching metrics</p>}
    </div>}
  </div>;
}
