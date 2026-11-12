export type ReleaseStage = "flash" | "estimate" | "final" | "revised";

/** Stage declared by Eurostat's official release-calendar entry. */
export function eurostatScheduledReleaseStage(metricId: string, evidence?: string | null): ReleaseStage | undefined {
  if (!metricId.startsWith("ea-")) return undefined;
  const title = evidence?.toLowerCase() ?? "";
  const isGdp = metricId === "ea-gdp-yoy" || metricId === "ea-gdp-qoq";
  const isHicp = metricId.includes("hicp-");
  if (!isGdp && !isHicp) return undefined;
  if (/flash estimate|preliminary flash/.test(title)) return "flash";
  if (isHicp && /inflation \(hicp\)|hicp.*final|final.*hicp/.test(title)) return "final";
  if (isGdp && /gdp.*update/.test(title)) return "revised";
  if (isGdp && /gdp main aggregates and employment/.test(title)) return "final";
  return undefined;
}

/** Period expected from Eurostat for scheduled GDP and HICP publications. */
export function eurostatExpectedPublicationPeriod(metricId: string, scheduledAt: string): string | undefined {
  if (!metricId.startsWith("ea-")) return undefined;
  const scheduleDate = scheduledAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!scheduleDate) return undefined;
  const [year, month] = scheduleDate.split("-").map(Number);
  if (!year || !month) return undefined;
  if (metricId === "ea-gdp-yoy" || metricId === "ea-gdp-qoq") {
    const currentQuarter = Math.floor((month - 1) / 3);
    const previousQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
    const expectedYear = currentQuarter === 0 ? year - 1 : year;
    return `${expectedYear}-${String(previousQuarter * 3 + 1).padStart(2, "0")}-01`;
  }
  if (metricId.includes("hicp-")) {
    const previousMonth = month === 1 ? 12 : month - 1;
    const expectedYear = month === 1 ? year - 1 : year;
    return `${expectedYear}-${String(previousMonth).padStart(2, "0")}-01`;
  }
  return undefined;
}

export const VINTAGE_TRACKED_METRICS = new Set([
  "ea-gdp-yoy",
  "ea-gdp-qoq",
  "ea-hicp-yoy",
  "ea-hicp-mom",
  "ea-core-hicp-yoy",
  "ea-core-hicp-mom",
  "ea-services-hicp-yoy",
  "ea-services-hicp-mom",
  "ea-goods-hicp-yoy",
  "ea-goods-hicp-mom",
  "ea-food-hicp-yoy",
  "ea-food-hicp-mom",
  "ea-energy-hicp-yoy",
  "ea-energy-hicp-mom",
  "ea-wage-growth",
  "ea-wage-growth-qoq",
  "us-umich-inflation-exp-1y",
  "us-umich-inflation-exp-5y",
]);

const STAGE_NOTE = /^\[release-stage:(flash|estimate|final|revised)\]/i;

export function releaseStageFromNote(notes?: string | null): ReleaseStage | null {
  const match = notes?.match(STAGE_NOTE);
  return (match?.[1]?.toLowerCase() as ReleaseStage | undefined) ?? null;
}

export function withReleaseStageNote(stage: ReleaseStage, note?: string | null) {
  const cleanNote = note?.replace(STAGE_NOTE, "").trim();
  return `[release-stage:${stage}]${cleanNote ? ` ${cleanNote}` : ""}`;
}

export function displayReleaseStage(stage?: ReleaseStage | null) {
  switch (stage) {
    case "flash": return "Flash estimate";
    case "estimate": return "Estimate";
    case "final": return "Final";
    case "revised": return "Revised";
    default: return null;
  }
}

export function isPreliminaryReleaseStage(stage?: ReleaseStage | null) {
  return stage === "flash" || stage === "estimate";
}
