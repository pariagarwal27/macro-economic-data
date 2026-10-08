import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalog = readFileSync(resolve(root, "src/catalog/metrics.ts"), "utf8");
const liveMap = readFileSync(resolve(root, "src/catalog/live-map.ts"), "utf8");
const eurostat = readFileSync(resolve(root, "src/ingest/eurostat.ts"), "utf8");
const dashboard = readFileSync(resolve(root, "src/components/CountryDashboard.tsx"), "utf8");
const ingestCli = readFileSync(resolve(root, "scripts/ingest.ts"), "utf8");

function metric(id) {
  const start = catalog.indexOf(`id: "${id}"`);
  if (start < 0) throw new Error(`catalog metric missing: ${id}`);
  const next = catalog.indexOf("\n  },", start);
  return catalog.slice(start, next < 0 ? start + 1200 : next);
}

const assertions = [
  ["US long-term unemployment is the BLS share series and is labeled/formatted as a percent", () => {
    const m = metric("us-long-term-unemployed");
    if (!m.includes('unit: "percent"') || !/LNS13025703/.test(m) || !/share|percent/i.test(m)) throw new Error("BLS LNS13025703 needs percent unit and share description");
    const modes = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    if (modes.indexOf('"us-long-term-unemployed"') < 0 || modes.indexOf('"us-long-term-unemployed"') > modes.indexOf('return "level"')) throw new Error("long-term unemployed still formats as a count");
  }],
  ["JOLTS level cards use BLS level codes rather than rate codes in live refresh mappings", () => {
    for (const [id, code] of [["us-jolts-hires-level", "HIL"], ["us-jolts-quits-level", "QUL"], ["us-jolts-layoffs-level", "LDL"], ["us-jolts-total-separations", "TSL"]]) {
      const block = liveMap.slice(liveMap.indexOf(`"${id}"`), liveMap.indexOf("\n  },", liveMap.indexOf(`"${id}"`)));
      if (!block.includes(`JTS000000000000000${code}`)) throw new Error(`${id} is not mapped to its level series`);
    }
    if (!metric("us-jolts-total-separations").includes("JTS000000000000000TSL")) throw new Error("total separations catalog still points to the rate series");
    for (const [id, code] of [["us-jolts-hires", "HIR"], ["us-jolts-quits", "QUR"], ["us-jolts-layoffs", "LDR"]]) {
      if (!metric(id).includes(`JTS000000000000000${code}`)) throw new Error(`${id} must use the BLS rate series`);
    }
  }],
  ["Euro Area long-term unemployment rate is fetched as its official labour-force share", () => {
    const m = metric("ea-long-term-unemployment");
    if (!m.includes('unit: "percent"') || !/PC_ACT/.test(m) || !m.includes("Rate")) throw new Error("EA long-term unemployment unit/label does not match PC_ACT");
    const adapter = eurostat.slice(eurostat.indexOf('case "ea_long_term_unemployment"'), eurostat.indexOf("\n    case ", eurostat.indexOf('case "ea_long_term_unemployment"') + 12));
    if (!adapter.includes('age: "Y15-74"') || !adapter.includes('unit: "PC_ACT"')) throw new Error("EA long-term unemployment request is not restricted to total 15-74 active-population rate");
    const modes = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    if (modes.indexOf('"ea-long-term-unemployment"') < 0 || modes.indexOf('"ea-long-term-unemployment"') > modes.indexOf('return "level"')) throw new Error("EA long-term unemployment still formats as a count");
  }],
  ["Eurostat vacant posts request JOBVAC while vacancy rate requests JVR", () => {
    const posts = eurostat.slice(eurostat.indexOf('case "ea_vacant_posts"'), eurostat.indexOf("\n    case ", eurostat.indexOf('case "ea_vacant_posts"') + 12));
    if (!posts.includes('indic_em: "JOBVAC"')) throw new Error("vacant posts still fetch the vacancy-rate series");
    if (!metric("ea-vacant-posts").includes('unit: "posts"') || !metric("ea-vacancy-change").includes('unit: "posts"')) throw new Error("vacancy count units must be absolute posts");
    if (!dashboard.includes("Not published for Euro Area aggregate")) throw new Error("unpublished EA post counts lack an explicit display state");
    if (!readFileSync(resolve(root, "src/ingest/pipeline.ts"), "utf8").includes('"ea-vacant-posts"')) throw new Error("unpublished Eurostat count metrics are not excluded from repeated ingestion");
  }],
  ["labor metric formats cover payroll counts, employment growth, currency and hours", () => {
    const modes = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const id of ["us-private-payrolls", "us-government-payrolls", "ea-employment-yoy", "ea-employment-qoq"]) {
      if (!modes.includes(`"${id}"`)) throw new Error(`${id} is missing its display mode`);
    }
    if (!dashboard.includes('unit.includes("dollar")') || !dashboard.includes('unit.includes("hour")')) throw new Error("dollar/hour units lack explicit formatting");
  }],
  ["ingest CLI safely recognizes both filtered-metric argument forms", () => {
    if (!ingestCli.includes('arg.startsWith("--metrics=")') || !ingestCli.includes('slice("--metrics=".length)')) throw new Error("--metrics=... would be ignored and run an unfiltered ingest");
  }],
];

let failed = 0;
for (const [name, run] of assertions) {
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed += 1; process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
if (failed) process.exitCode = 1;
