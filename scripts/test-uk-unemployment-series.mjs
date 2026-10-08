import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalog = readFileSync(resolve(root, "src/catalog/metrics.ts"), "utf8");
const hierarchy = readFileSync(resolve(root, "src/components/macro-ui-hierarchy.ts"), "utf8");
const ons = readFileSync(resolve(root, "src/ingest/ons.ts"), "utf8");
const dashboard = readFileSync(resolve(root, "src/components/CountryDashboard.tsx"), "utf8");
const cron = readFileSync(resolve(root, "src/app/api/cron/releases/route.ts"), "utf8");

const tests = [
  ["UK unemployment card maps its count and long-term rows to real metrics", () => {
    const card = hierarchy.match(/id: "uk-unemployment-card"[\s\S]*?\n\s*},/)?.[0] ?? "";
    for (const id of ["uk-unemployed-persons", "uk-long-term-unemployed"]) {
      if (!card.includes(`"${id}"`)) throw new Error(`UK unemployment card does not map ${id}`);
    }
  }],
  ["UK unemployed persons and long-term unemployment use official ONS series in thousands", () => {
    for (const [id, series] of [["uk-unemployed-persons", "MGSC"], ["uk-long-term-unemployed", "YBWH"]]) {
      const start = catalog.indexOf(`id: "${id}"`);
      const metric = start >= 0 ? catalog.slice(start, start + 900) : "";
      if (!metric.includes(`seriesId: "${series}"`)) throw new Error(`${id} is not mapped to ONS ${series}`);
      if (!metric.includes('unit: "thousands"')) throw new Error(`${id} must retain ONS thousands units`);
    }
  }],
  ["both ONS series have live and backfill URI mappings", () => {
    for (const [series, dataset] of [["MGSC", "unem"], ["YBWH", "lms"]]) {
      if (!ons.includes(`${series}:`) || !ons.includes(`/timeseries/${series.toLowerCase()}/${dataset}`)) {
        throw new Error(`${series} has no ONS ${dataset} CSV mapping`);
      }
    }
  }],
  ["scheduled release worker seeds only these new catalog rows without pruning other metrics", () => {
    const seedCall = cron.match(/seedCatalog\(\{[\s\S]*?\}\)/)?.[0] ?? "";
    if (!seedCall.includes('"uk-unemployed-persons"') || !seedCall.includes('"uk-long-term-unemployed"') || !seedCall.includes("cleanupOrphans: false")) {
      throw new Error("release cron does not ensure the two new metrics exist in the hosted catalog");
    }
    if (!ons.includes("MGSC:") || !ons.includes("YBWH:")) throw new Error("scheduled ONS fetch paths are missing");
  }],
  ["UK count rows use level formatting", () => {
    const displayMode = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const id of ["uk-unemployed-persons", "uk-long-term-unemployed"]) {
      if (!displayMode.includes(`"${id}"`)) throw new Error(`${id} is not formatted as a count`);
    }
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed += 1; process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
if (failed) process.exitCode = 1;
