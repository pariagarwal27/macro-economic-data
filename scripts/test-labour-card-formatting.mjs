import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dashboard = readFileSync(resolve(root, "src/components/CountryDashboard.tsx"), "utf8");

const checks = [
  ["Euro Area unemployment and vacancy rates use published rate levels", () => {
    const rateMode = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const id of ["ea-unemployment", "ea-job-vacancies", "us-u6", "us-employment-population"]) {
      if (!rateMode.includes(`"${id}"`)) throw new Error(`${id} is not configured as a published rate`);
    }
  }],
  ["unemployment and participation counts use count formatting, not percentage changes", () => {
    const displayMode = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const id of ["us-unemployed-persons", "us-civilian-labor-force", "us-not-in-labor-force", "ea-unemployed-persons"]) {
      if (!displayMode.includes(`"${id}"`)) throw new Error(`${id} is missing a count display mode`);
    }
  }],
  ["vacancy totals and changes retain their native number units", () => {
    const displayMode = dashboard.match(/function getDisplayMode\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const id of ["ea-vacant-posts", "ea-vacancy-change", "us-jolts-hires-level", "us-jolts-quits-level", "us-jolts-layoffs-level", "us-jolts-total-separations"]) {
      if (!displayMode.includes(`"${id}"`)) throw new Error(`${id} is missing its level/change display mode`);
    }
  }],
  ["US and UK/EU rate and vacancy cards use consistent latest/prior readings", () => {
    const cardKpis = dashboard.match(/function getCardKpis\([\s\S]*?\n\}/)?.[0] ?? "";
    if (cardKpis.includes('if (id === "us-unemployment")')) throw new Error("US unemployment still has an inconsistent latest-only override");
    if (cardKpis.includes('if (id === "us-jolts-openings")')) throw new Error("US job openings still have an inconsistent latest-only override");
    if (!dashboard.includes('if (getDisplayMode(id) !== "normal")')) throw new Error("front and detail cards do not share unit-aware latest/prior formatting");
  }],
  ["component rows format every metric using its own display mode", () => {
    if (!/const renderValue = \(value: number \| null \| undefined\) => \{[\s\S]{0,400}formatMetricValue\(value, d\)/.test(dashboard)) throw new Error("component value formatter does not honor each metric's unit and display mode");
  }],
];

let failed = 0;
for (const [name, run] of checks) {
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed += 1; process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
}
if (failed) process.exitCode = 1;
