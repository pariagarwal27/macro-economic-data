import { round } from "@/ingest/transforms";

/** Actual minus consensus when units look compatible. */
export function computeSurprise(
  actual: number | null | undefined,
  expected: number | null | undefined,
  unit: string
): number | null {
  if (
    actual == null ||
    expected == null ||
    !Number.isFinite(actual) ||
    !Number.isFinite(expected)
  ) {
    return null;
  }
  // Index level vs QoQ % (e.g. ECI total)
  if (unit === "index" && Math.abs(expected) < 25 && Math.abs(actual) > 40) return null;
  if (Math.abs(actual - expected) > 50_000) return null;
  return round(actual - expected);
}

export function surpriseTone(
  surprise: number | null,
  metricId: string,
  unit: string
): "good" | "bad" | "neutral" {
  if (surprise == null || surprise === 0) return "neutral";
  const invert =
    metricId.includes("unemployment") ||
    metricId.includes("claims") ||
    metricId.includes("u6");
  if (invert) return surprise > 0 ? "bad" : "good";
  if (unit === "percent") return surprise > 0 ? "good" : "bad";
  return surprise > 0 ? "good" : "bad";
}
