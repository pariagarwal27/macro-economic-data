import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://localhost:3003';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/api/dashboard/US', '/api/dashboard/US', '/api/dashboard/UK']) {
    const started = performance.now();
    const response = await page.request.get(`${base}${path}`);
    const body = await response.body();
    console.log(JSON.stringify({ path, status: response.status(), ms: Math.round(performance.now() - started), bytes: body.length }));
  }
  // Compile development routes before timing client navigation.
  for (const country of ['us', 'uk', 'ea']) await page.request.get(`${base}/country/${country}`);
  const warmed = ['US', 'UK', 'EA'].map(country => page.waitForResponse(response => response.url() === `${base}/api/dashboard/${country}` && response.status() === 200).then(response => response.finished()));
  await page.goto(base, { waitUntil: 'networkidle' });
  // Let any background warming complete before measuring navigation.
  await Promise.all(warmed);
  let documentLoads = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++; });
  // Cached country views must remain fully usable even while fresh API reads fail.
  await page.route('**/api/dashboard/*', route => route.abort());
  for (const country of ['us', 'uk', 'ea', 'us', 'uk', 'us']) {
    const started = performance.now();
    await page.locator(`a[data-country="${country}"]:visible`).first().evaluate(link => link.click());
    await page.waitForURL(`**/country/${country}`);
    const panel = page.locator(`.editorial-dashboard[data-region="${country}"]`);
    await panel.waitFor({ state: 'visible' });
    await panel.locator('.recharts-surface').first().waitFor();
    assert.equal(await panel.locator('.loading-strip').count(), 0);
    const anchorsWork = await panel.locator('a[href^="#"]').evaluateAll(links => links.every(link => {
      const target = document.getElementById(link.getAttribute('href').slice(1));
      return target && target.closest('.editorial-dashboard') === link.closest('.editorial-dashboard');
    }));
    assert.ok(anchorsWork, 'section jumps must target the active country');
    console.log(JSON.stringify({ country, navigationMs: Math.round(performance.now() - started), charts: await panel.locator('.recharts-surface').count() }));
  }
  assert.equal(documentLoads, 0, 'country tabs must not reload the document');
  assert.deepEqual(errors, [], 'navigation must not cause rendering errors');
  await page.goBack();
  await page.locator('.editorial-dashboard[data-region="uk"]').waitFor({ state: 'visible' });
  await page.goForward();
  await page.locator('.editorial-dashboard[data-region="us"]').waitFor({ state: 'visible' });
  const started = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.editorial-dashboard[data-region="us"] .recharts-surface').first().waitFor();
  assert.equal(await page.locator('.loading-strip').count(), 0);
  assert.deepEqual(errors, [], 'saved snapshots must hydrate without rendering errors');
  console.log(JSON.stringify({ reloadWithApiUnavailableMs: Math.round(performance.now() - started), documentLoads, errors }));
} finally {
  await browser.close();
}
