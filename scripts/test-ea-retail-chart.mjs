import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.DASHBOARD_TEST_URL ?? 'http://localhost:3000'}/country/ea`, { waitUntil: 'networkidle' });
  const activity = page.locator('.editorial-dashboard[data-region="ea"] .labour-studio[data-category="activity"]');
  await page.locator('.loading-strip').waitFor({ state: 'hidden' });
  await activity.locator('.labour-studio-selector').filter({ hasText: 'Retail Sales' }).first().click();
  const plot = activity.locator('.labour-studio-plot');

  async function tooltip() {
    const point = plot.locator('.recharts-line-dots .recharts-dot').last();
    await point.waitFor();
    await point.hover({ force: true });
    const table = plot.locator('.retail-sales-tooltip table');
    await table.waitFor();
    return { headers: await table.locator('thead th').allTextContents(), rows: await table.locator('tbody tr').allTextContents() };
  }

  await plot.getByRole('button', { name: 'MoM', exact: true }).click();
  assert.equal(await plot.locator('.recharts-line-curve').count(), 2);
  const mom = await tooltip();
  assert.deepEqual(mom.headers, ['Series', 'MoM']);
  assert.equal(mom.rows.length, 2);
  assert.match(mom.rows[0], /Headline Retail Sales/);
  assert.match(mom.rows[1], /Retail Sales ex Fuel/);
  assert.ok(mom.rows.every(row => row.includes('%')));
  const momLegend = await plot.getByLabel('Retail sales chart legend').innerText();
  assert.match(momLegend, /Headline Retail Sales · MoM/);
  assert.match(momLegend, /Retail Sales ex Fuel · MoM/);

  await plot.getByRole('button', { name: 'YoY + 3m/3m SAAR', exact: true }).click();
  assert.equal(await plot.locator('.recharts-line-curve').count(), 4);
  const paired = await tooltip();
  assert.deepEqual(paired.headers, ['Series', 'YoY', '3m/3m SAAR']);
  assert.equal(paired.rows.length, 2);
  assert.equal(await plot.locator('.retail-sales-tooltip tbody td').count(), 4);
  for (const value of await plot.locator('.retail-sales-tooltip tbody td').allTextContents()) assert.match(value, /\d.*%/, 'both series must have real YoY and SAAR readings');
  const legend = await plot.getByLabel('Chart series', { exact: true }).innerText();
  for (const name of ['Headline Retail Sales', 'Retail Sales ex Fuel']) {
    assert.ok(legend.includes(`${name} · YoY`));
    assert.ok(legend.includes(`${name} · 3m/3m SAAR`));
  }
  assert.equal(await plot.locator('.recharts-line-curve[stroke-dasharray]').count(), 2);
  assert.equal(await plot.locator('.recharts-legend-wrapper').count(), 0, 'no duplicate generated legends');
  await page.waitForFunction(() => [...document.querySelectorAll('.editorial-dashboard[data-region="ea"] .labour-studio[data-category="activity"] [data-chart-trace-layer]')].every(layer => layer.getAttribute('data-chart-trace-layer') === 'complete'));
  await activity.screenshot({ path: 'ea-retail-chart.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mom, momLegend, paired, legend, errors }, null, 2));
} finally {
  await browser.close();
}
