import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  async function inspectCharts(container, label) {
    const charts = container.locator('svg.recharts-surface').filter({ has: page.locator('.recharts-line-curve') });
    const count = await charts.count();
    if (!count) { results.push({ label, empty: true }); return; }
    for (let index = 0; index < count; index++) {
      const chart = charts.nth(index);
      await chart.scrollIntoViewIfNeeded();
      await chart.locator('[data-chart-trace-pointer]').first().waitFor();
      const motion = await chart.evaluate(svg => {
        const curves = [...svg.querySelectorAll('.recharts-line-curve')].filter(path => path.getTotalLength() > 0);
        const layers = [...svg.querySelectorAll('[data-chart-trace-layer]')];
        svg.pauseAnimations();
        const now = svg.getCurrentTime();
        layers.forEach(layer => {
          layer.querySelector('animate').beginElement();
          layer.querySelector('animateMotion').beginElement();
        });
        svg.setCurrentTime(now + 0.01);
        const first = layers.map(layer => layer.querySelector('[data-chart-trace-pointer]').getCTM().e);
        svg.setCurrentTime(now + 0.75);
        const middle = layers.map(layer => layer.querySelector('[data-chart-trace-pointer]').getCTM().e);
        svg.setCurrentTime(now + 1.6);
        const final = layers.map((layer, i) => {
          const pointer = layer.querySelector('[data-chart-trace-pointer]').getCTM();
          const curve = curves[i];
          if (!curve) return { matched: false };
          const end = curve.getPointAtLength(curve.getTotalLength());
          const expected = new DOMPoint(end.x, end.y).matrixTransform(curve.getCTM());
          return { matched: Math.hypot(pointer.e - expected.x, pointer.f - expected.y) < 1, x: pointer.e };
        });
        svg.unpauseAnimations();
        return { curves: curves.length, pointers: layers.length, moving: final.every((point, i) => first[i] < middle[i] && middle[i] <= point.x), endpoints: final.every(point => point.matched) };
      });
      assert.equal(motion.pointers, motion.curves, `${label}: each series needs a pointer`);
      assert.ok(motion.moving, `${label}: pointers must travel from beginning to end`);
      assert.ok(motion.endpoints, `${label}: pointers must stop on the latest plotted values`);
      results.push({ label, chart: index, ...motion });
    }
  }

  for (const region of ['us', 'uk', 'ea']) {
    await page.goto(`${base}/country/${region}`, { waitUntil: 'networkidle' });
    const panel = page.locator(`.editorial-dashboard[data-region="${region}"]`);
    await panel.locator('.loading-strip').waitFor({ state: 'hidden' });
    const labour = panel.locator('.labour-studio[data-category="labour"]');
    const selectors = labour.locator('.labour-studio-selector');
    for (let index = 0; index < await selectors.count(); index++) {
      const button = selectors.nth(index);
      const name = await button.locator('.labour-studio-name').innerText();
      await button.click();
      await inspectCharts(labour.locator('.labour-studio-plot'), `${region}/labour/${name}`);
    }
    const activity = panel.locator('.labour-studio[data-category="activity"]');
    await activity.locator('.labour-studio-selector').filter({ hasText: /Retail Sales/i }).first().click();
    await inspectCharts(activity.locator('.labour-studio-plot'), `${region}/retail`);
    const mom = activity.getByRole('button', { name: 'MoM', exact: true });
    if (await mom.count()) { await mom.click(); await inspectCharts(activity.locator('.labour-studio-plot'), `${region}/retail/MoM`); }
    const expectations = panel.locator('.expectation-studio');
    const tabs = expectations.getByRole('tab');
    for (let index = 0; index < await tabs.count(); index++) {
      const tab = tabs.nth(index);
      const label = await tab.innerText();
      await tab.click();
      await inspectCharts(expectations.locator('.expectation-studio-chart'), `${region}/expectations/${label}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checked: results.filter(result => !result.empty).length, empty: results.filter(result => result.empty).map(result => result.label), errors }, null, 2));
} finally {
  await browser.close();
}
