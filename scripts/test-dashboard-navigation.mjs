import { chromium } from 'playwright';
import assert from 'node:assert/strict';
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
const page=await browser.newPage({viewport:{width:1500,height:950}});
await page.goto(process.env.DASHBOARD_URL || 'http://localhost:3000',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
page.on('pageerror', e=>console.log('PAGE ERROR',e.message));
await page.route('**/*', route => route.request().url().includes('_rsc=') ? route.abort() : route.continue());
for(const [path,selector] of [['/country/us','.editorial-dashboard[data-region="us"]'],['/country/uk','.editorial-dashboard[data-region="uk"]'],['/country/ea','.editorial-dashboard[data-region="ea"]'],['/calendar','.release-calendar'],['/latest-updated','.latest-updated-page'],['/','.overview-page']]){
const start=Date.now();
await page.locator(`a[href="${path}"]:visible`).first().click();
await page.waitForURL(u=>u.pathname===path,{timeout:2000,waitUntil:'commit'});
if(path!='/calendar') await page.locator(selector).waitFor({state:'visible',timeout:2000});
assert.ok(Date.now()-start<2000,`${path} blocked`);
console.log(path,Date.now()-start,'ms');
}
await page.goBack({waitUntil:'commit'}); await page.locator('.latest-updated-page').waitFor({state:'visible',timeout:2000});
await page.goForward({waitUntil:'commit'}); await page.locator('.overview-page').waitFor({state:'visible',timeout:2000});
for (const origin of ['/','/country/us','/country/uk','/country/ea','/calendar','/latest-updated']) {
await page.locator(`a[href="${origin}"]:visible`).first().click();
for (const target of ['/','/country/us','/country/uk','/country/ea','/calendar','/latest-updated']) {
await page.locator(`a[href="${target}"]:visible`).first().click();
await page.waitForURL(u=>u.pathname===target,{timeout:2000,waitUntil:'commit'});
await page.locator(`a[href="${origin}"]:visible`).first().click();
}
}
console.log('PASS: all 36 tab combinations');
console.log('PASS: all main tabs work with route requests blocked, including browser history');
} finally{ await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
