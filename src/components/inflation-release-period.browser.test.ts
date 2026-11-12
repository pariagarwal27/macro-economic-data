import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
let script: string;
before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { PceReleaseCard } from "./src/components/PceReleaseCard";
        import { InflationReleaseCard } from "./src/components/InflationReleaseCard";
        const root = createRoot(document.getElementById("root"));
        window.renderReleaseCard = ({ metricId, latest, initialPeriod }) => {
          const history = [{ date: "2026-07-01", value: 100 }, { date: "2026-08-01", value: 101 }];
          if (latest === "2026-09") history.push({ date: "2026-09-01", value: 102.5 });
          const metrics = Object.fromEntries(["us-pce", "us-core-pce", "us-cpi", "us-cpi-core"].map(id => [id, { meta: { unit: "index" }, history }]));
          const props = { metrics, initialPeriod, onComponentOpen: () => {} };
          root.render(metricId.includes("pce")
            ? <PceReleaseCard {...props} rootMetricId={metricId} core={metricId === "us-core-pce"} components={[]} />
            : <InflationReleaseCard {...props} metricId={metricId} />);
        };
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => { await browser?.close(); });

type CardInput = { metricId: string; latest: string; initialPeriod?: string };
async function render(page: Page, input: CardInput) {
  await page.evaluate(input => {
    (window as unknown as { renderReleaseCard: (input: CardInput) => void }).renderReleaseCard(input);
  }, input);
}
async function selected(page: Page, value: string) {
  await page.waitForFunction(expected => document.querySelector("select")?.value === expected, value, { timeout: 3_000 });
  assert.equal(await page.locator("select").inputValue(), value);
}
async function createPage() {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  return page;
}

for (const metricId of ["us-pce", "us-core-pce", "us-cpi", "us-cpi-core"]) {
  test(`${metricId}: a late August notification opens on September when September data is already available`, async () => {
    const page = await createPage();
    try {
      await render(page, { metricId, latest: "2026-09", initialPeriod: "2026-08" });
      await selected(page, "2026-09");
      assert.equal(await page.locator(".release-kpis strong").first().textContent(), "+1.49%");
    } finally { await page.close(); }
  });

  test(`${metricId}: fresh September data advances an August card without a dropdown click`, async () => {
    const page = await createPage();
    try {
      await render(page, { metricId, latest: "2026-08", initialPeriod: "2026-08" });
      await selected(page, "2026-08");
      await render(page, { metricId, latest: "2026-09", initialPeriod: "2026-08" });
      await selected(page, "2026-09");
      assert.equal(await page.locator(".release-kpis strong").first().textContent(), "+1.49%");
    } finally { await page.close(); }
  });

  test(`${metricId}: an explicit September release selects September before its complete history arrives`, async () => {
    const page = await createPage();
    try {
      await render(page, { metricId, latest: "2026-08", initialPeriod: "2026-08" });
      await selected(page, "2026-08");
      await render(page, { metricId, latest: "2026-08", initialPeriod: "2026-09" });
      await selected(page, "2026-09");
      assert.equal(await page.locator(".release-kpis strong").first().textContent(), "—");
      await render(page, { metricId, latest: "2026-09", initialPeriod: "2026-09" });
      await selected(page, "2026-09");
      assert.equal(await page.locator(".release-kpis strong").first().textContent(), "+1.49%");
    } finally { await page.close(); }
  });

  test(`${metricId}: same-month refreshes preserve a manually chosen historical month`, async () => {
    const page = await createPage();
    try {
      await render(page, { metricId, latest: "2026-08", initialPeriod: "2026-08" });
      await selected(page, "2026-08");
      await page.locator("select").selectOption("2026-07");
      await selected(page, "2026-07");
      await render(page, { metricId, latest: "2026-08", initialPeriod: "2026-08" });
      await selected(page, "2026-07");
    } finally { await page.close(); }
  });
}
