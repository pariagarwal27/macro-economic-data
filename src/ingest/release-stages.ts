export type ReleaseStage = "flash" | "estimate" | "final" | "revised";

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
