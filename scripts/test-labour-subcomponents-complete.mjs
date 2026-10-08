import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hierarchy = readFileSync(resolve(root, "src/components/macro-ui-hierarchy.ts"), "utf8");
const catalog = readFileSync(resolve(root, "src/catalog/metrics.ts"), "utf8");
const ons = readFileSync(resolve(root, "src/ingest/ons.ts"), "utf8");
const onsVacs02 = readFileSync(resolve(root, "src/ingest/ons-vacs02.ts"), "utf8");

function metric(id) {
  const start = catalog.indexOf(`id: "${id}"`);
  if (start < 0) throw new Error(`missing catalog entry ${id}`);
  const end = catalog.indexOf("\n  },", start);
  return catalog.slice(start, end < 0 ? start + 1400 : end);
}

const checks = [
  ["UK labour card leaves are bound to official metrics", () => {
    for (const [key, id] of [
      ["employee-jobs", "uk-employee-jobs"],
      ["inactive", "uk-inactive-persons"],
      ["change", "uk-inactivity-change"],
      ["vacancy-rate", "uk-vacancy-rate"],
      ["vacancy-change", "uk-vacancy-change"],
      ["real-total", "uk-awe-real-total-yoy"],
      ["real-regular", "uk-awe-real-regular-yoy"],
      ["annual", "uk-payrolled-employees-annual-change"],
    ]) {
      if (!hierarchy.includes(`n("${key}"`) || !hierarchy.includes(`"${id}"`)) throw new Error(`${key} is still blank or not mapped to ${id}`);
      metric(id);
    }
    for (const [id, seriesId, unit, transform] of [
      ["uk-employee-jobs", "BCAJ", "thousands", "level"],
      ["uk-inactive-persons", "LF2M", "thousands", "level"],
      ["uk-inactivity-change", "FV28", "thousands", "published_rate"],
      ["uk-vacancy-rate", "N4JE", "percent", "published_rate"],
      ["uk-vacancy-change", "AP2Y", "thousands", "diff_3m"],
      ["uk-awe-real-total-yoy", "A3WW", "percent", "published_rate"],
      ["uk-awe-real-regular-yoy", "A2FA", "percent", "published_rate"],
      ["uk-payrolled-employees-annual-change", "PAYE_EMP_LEVEL", "percent", "pct_change_yoy"],
    ]) {
      const entry = metric(id);
      if (!entry.includes(`seriesId: "${seriesId}"`) || !entry.includes(`unit: "${unit}"`) || !entry.includes(`transform: "${transform}"`)) throw new Error(`${id} series/unit/transform mismatch`);
      if (seriesId === "N4JE" ? !ons.includes("fetchOnsJobOpeningsRate") : seriesId !== "PAYE_EMP_LEVEL" && !ons.includes(`${seriesId}:`)) throw new Error(`${seriesId} has no ONS fetch adapter`);
    }
  }],
  ["UK inactivity reasons are surfaced from ONS INAC01 official series", () => {
    for (const [key, id, code] of [
      ["student", "uk-inactivity-student", "LF63"],
      ["family", "uk-inactivity-family", "LF65"],
      ["temporary-sick", "uk-inactivity-temporary-sick", "LF67"],
      ["long-term-sick", "uk-inactivity-long-term-sick", "LF69"],
      ["discouraged", "uk-inactivity-discouraged", "LFL8"],
      ["retired", "uk-inactivity-retired", "LF6B"],
      ["other", "uk-inactivity-other", "LF6D"],
    ]) {
      if (!hierarchy.includes(`n("${key}"`) || !hierarchy.includes(`"${id}"`)) throw new Error(`published inactivity reason ${key} is not mapped`);
      if (!catalog.includes(`["${key}", "${code}",`) || !catalog.includes('unit: "thousands" as const')) throw new Error(`${id} does not use the ONS count series ${code}`);
      if (!ons.includes(`${code}:`)) throw new Error(`${code} has no ONS fetch adapter`);
    }
  }],
  ["unpublished Euro Area vacancy counts are removed from visible labour cards", () => {
    const blockStart = hierarchy.indexOf('id: "ea-vacancies-card"');
    const blockEnd = hierarchy.indexOf("\n      },", blockStart);
    const block = hierarchy.slice(blockStart, blockEnd);
    if (block.includes('"ea-vacant-posts"') || block.includes('"ea-vacancy-change"')) throw new Error("unpublished EA vacancy counts still appear as blank components");
    if (!block.includes('"ea-job-vacancies"')) throw new Error("published EA vacancy rate was removed");
  }],
  ["ONS VACS02 parser reads N4JE from the actual workbook series-code row", () => {
    if (!onsVacs02.includes("rows[5]") || !onsVacs02.includes("rows.slice(8)")) throw new Error("VACS02 parser is not aligned with the official workbook header and observation rows");
  }],
];

let failed = 0;
for (const [name, run] of checks) {
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed += 1; process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
if (failed) process.exitCode = 1;
