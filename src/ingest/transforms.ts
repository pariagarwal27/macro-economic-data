import type { Transform } from "@/catalog/metrics";

export interface RawPoint {
  date: string;
  value: number;
}

export interface TransformedPoint {
  date: string;
  value: number;
  rawValue: number;
}

/** Apply series transforms. YoY/MoM use prior observation spacing. */
export function applyTransform(
  points: RawPoint[],
  transform: Transform | "diff"
): TransformedPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (transform === "level" || transform === "index" || transform === "published_rate") {
    return sorted.map((p) => ({ date: p.date, value: p.value, rawValue: p.value }));
  }

  const out: TransformedPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (transform === "diff" || transform === "pct_change") {
      if (i === 0) continue;
      const prev = sorted[i - 1];
      const value =
        transform === "diff"
          ? cur.value - prev.value
          : prev.value === 0
            ? NaN
            : ((cur.value - prev.value) / Math.abs(prev.value)) * 100;
      if (!Number.isFinite(value)) continue;
      out.push({ date: cur.date, value, rawValue: cur.value });
      continue;
    }

    if (transform === "pct_change_mom") {
      if (i === 0) continue;
      const prev = sorted[i - 1];
      if (prev.value === 0) continue;
      out.push({
        date: cur.date,
        value: ((cur.value - prev.value) / Math.abs(prev.value)) * 100,
        rawValue: cur.value,
      });
      continue;
    }

    if (transform === "pct_change_yoy") {
      const target = shiftYear(cur.date);
      const prev = findClosest(sorted, target, i);
      if (!prev || prev.value === 0) continue;
      out.push({
        date: cur.date,
        value: ((cur.value - prev.value) / Math.abs(prev.value)) * 100,
        rawValue: cur.value,
      });
    }
  }
  return out;
}

function shiftYear(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${String(y - 1).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d ?? 1).padStart(2, "0")}`;
}

function findClosest(points: RawPoint[], target: string, beforeIdx: number): RawPoint | null {
  let best: RawPoint | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < beforeIdx; i++) {
    const dist = Math.abs(dateNum(points[i].date) - dateNum(target));
    if (dist < bestDist) {
      bestDist = dist;
      best = points[i];
    }
  }
  // Prefer within ~40 days for monthly, ~100 for quarterly-ish
  if (best && bestDist <= 40) return best;
  if (best && bestDist <= 100) return best;
  return null;
}

function dateNum(d: string): number {
  return Date.parse(d);
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
