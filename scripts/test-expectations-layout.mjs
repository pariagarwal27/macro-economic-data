import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dashboard = readFileSync(resolve(root, "src/components/CountryDashboard.tsx"), "utf8");
const hierarchy = readFileSync(resolve(root, "src/components/macro-ui-hierarchy.ts"), "utf8");

const checks = [
  ["expectation front cards show configured metric names and latest published values", () => {
    if (!dashboard.includes("spec.expectationGroup ? (") || !dashboard.includes("ExpectationMetricPreview")) throw new Error("front card does not render a dedicated expectation metric preview");
    if (!/ExpectationMetricPreview/.test(dashboard)) throw new Error("expectation metric preview component is missing");
    if (!dashboard.includes("const value = payload?.history?.at(-1)?.value") || !dashboard.includes("formatExpectationValue(payload, value)")) throw new Error("expectation previews do not use the latest observed value formatter");
  }],
  ["expectation mini charts plot published values rather than derived YoY/MoM rates", () => {
    if (!dashboard.includes("if (spec.expectationGroup) {") || !dashboard.includes('name="expectation-level"')) throw new Error("expectation mini charts do not use the actual level-series path");
  }],
  ["expectations have no second category tile panel", () => {
    if (/<InflationExpectationSection\b/.test(dashboard)) throw new Error("duplicate panel is still rendered");
  }],
  ["expectation detail views show the component metadata table", () => {
    if (!/isExpectation\s*&&\s*expectationMetricIds\.length\s*>\s*0[\s\S]*?<ExpectationComponentsTable/.test(dashboard)) throw new Error("component metadata table is not rendered in expectation details");
  }],
  ["all UK expectation cards use the shared chart and detail flow", () => {
    const ids = ["uk-inflation-expectations-consumer", "uk-inflation-expectations-business", "uk-inflation-expectations-wage", "uk-inflation-expectations-market", "uk-inflation-expectations-professional"];
    const missing = ids.filter((id) => {
      const start = hierarchy.indexOf(`id: "${id}"`);
      return start < 0 || !/expectationGroup:\s*"(?:consumer|business|wage|market|professional)"/.test(hierarchy.slice(start, start + 220));
    });
    if (missing.length) throw new Error(`missing chart/detail group on ${missing.join(", ")}`);
  }],
  ["US household expectations charts match actual dashboard card ids", () => {
    if (!/spec\.id\s*===\s*"us-inflation-expectations-wage"/.test(dashboard)) throw new Error("US wage chart group is not connected to its dashboard card");
    if (!/spec\.id\s*===\s*"us-inflation-expectations-business"/.test(dashboard)) throw new Error("US business chart group is not connected to its dashboard card");
  }],
  ["previously surfaced US long-run model series and BoE Agents wage series remain in the detail taxonomy", () => {
    for (const id of ["us-cleveland-exp-inf-3y", "us-cleveland-exp-inf-10y", "us-cleveland-exp-inf-30y", "uk-agents-pay-settlement-exp-1y"]) {
      if (!hierarchy.includes(`"${id}"`)) throw new Error(`series ${id} was dropped during consolidation`);
    }
  }],
  ["Euro Area wage expectations live under Expectations & Outlook", () => {
    const labour = hierarchy.match(/labour:\s*\[([^\]]*)\]/)?.[1] ?? "";
    const expectations = hierarchy.match(/expectations:\s*\[([^\]]*)\]/g) ?? [];
    if (/ea-inflation-expectations-wage/.test(labour)) throw new Error("wage expectation remains in Labour");
    if (!expectations.some((entry) => entry.includes("ea-inflation-expectations-wage"))) throw new Error("wage expectation is absent from Expectations & Outlook");
  }],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

if (failed) process.exitCode = 1;
