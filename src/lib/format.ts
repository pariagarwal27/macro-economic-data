export function formatObsDate(date: string | null | undefined): string {
  if (!date) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 2;
  if (unit === "percent") return `${value.toFixed(digits)}%`;
  if (unit === "thousands" || unit === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  return value.toFixed(digits);
}

export function formatDelta(delta: number | null | undefined, unit: string): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : "";
  if (unit === "percent") return `${sign}${delta.toFixed(2)}pp`;
  if (unit === "thousands" || unit === "number") {
    return `${sign}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(delta)}`;
  }
  return `${sign}${delta.toFixed(2)}`;
}

/** Desk matrix cell: compact actual / consensus display. */
export function formatMatrixValue(
  value: number | null | undefined,
  unit: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (unit === "percent") {
    const digits = abs >= 10 ? 1 : 2;
    return `${value.toFixed(digits)}%`;
  }
  if (unit === "thousands" || unit === "number") {
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  if (unit === "index") return value.toFixed(1);
  return abs >= 100 ? value.toFixed(1) : value.toFixed(2);
}

export function formatMatrixColumnLabel(period: string): string {
  const month = Number(period.slice(5, 7));
  const year = period.slice(2, 4);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]}-${year}`;
}

export function regionLabel(region: string): string {
  if (region === "US") return "United States";
  if (region === "UK") return "United Kingdom";
  if (region === "EA") return "Euro Area";
  return region;
}

export function categoryLabel(category: string): string {
  if (category === "inflation") return "Inflation";
  if (category === "growth") return "Growth";
  if (category === "jobs") return "Jobs";
  return category;
}
