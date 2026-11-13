import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("release data is delivered immediately and sustained updates cannot postpone opening", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { ReleaseAutoOpen } from "./src/components/ReleaseAutoOpen";
        window.EventSource = class {
          constructor() { window.releaseStream = this; }
          close() {}
        };
        window.openings = [];
        window.updates = [];
        window.addEventListener("macrohub:auto-release-open", e => window.openings.push(e.detail));
        window.addEventListener("macrohub:release-updates", e => window.updates.push(...e.detail));
        createRoot(document.getElementById("root")).render(<ReleaseAutoOpen />);
      `,
    },
    plugins: [{ name: "navigation", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        const router = { push: path => { throw new Error("unexpected navigation: " + path); } };
        export const useRouter = () => router;
        export const usePathname = () => "/country/us";
      ` }));
    } }],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://macro.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://macro.test/country/us");
    await page.clock.install({ time: new Date("2026-11-12T13:30:01Z") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => Boolean((window as unknown as { releaseStream: unknown }).releaseStream));
    const send = async (id: number, metricId: string) => page.evaluate(({ id, metricId }) => {
      const state = window as unknown as { releaseStream: { onmessage: (event: { data: string }) => void } };
      state.releaseStream.onmessage({ data: JSON.stringify({ cursor: id, updates: [{ id, metricId, value: 3.2,
        periodDate: "2026-10-01", releasedAt: "2026-11-12T13:30:00Z", stage: null }] }) });
    }, { id, metricId });
    await send(1, "us-cpi-yoy");
    assert.equal(await page.evaluate(() => (window as unknown as { updates: unknown[] }).updates.length), 1);
    await page.clock.runFor(200);
    await send(2, "us-core-cpi-yoy");
    await page.clock.runFor(100);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { openings: { metricId: string }[] }).openings.map(item => item.metricId)), ["us-cpi"]);
    await send(3, "us-cpi-shelter");
    await page.clock.runFor(300);
    assert.equal(await page.evaluate(() => (window as unknown as { openings: unknown[] }).openings.length), 1, "later components must not reopen the card");
  } finally { await browser.close(); }
});
