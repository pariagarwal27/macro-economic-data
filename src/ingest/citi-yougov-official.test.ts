import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { fetchBoeMprInflationSeries } from './boe-dmp';

const root = 'https://www.bankofengland.co.uk';
const report = `${root}/monetary-policy-report/2099/november-2099`;
const zipUrl = `${root}/-/media/boe/files/monetary-policy-report/2099/november/chart-data.zip`;

function chartData() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Chart 1.9 - Market-based measures of inflation compensation and survey-based measures of business and household inflation expectations'],
    ['', 'Market-based measures', '', '', '', 'Businesses (DMP Survey)', '', '', '', 'Households (Citi/YouGov) (per cent)'],
    ['Date', 'Short-term expectations', 'Medium-term expectations', '', 'Date', 'Short-term expectations', 'Medium-term expectations', '', 'Date', 'Short-term expectations', 'Medium-term expectations'],
    ['2099-11-30', '', '', '', '2099-11-30', '', '', '', '2099-10-31', 4.2, 4.0],
    ['2099-12-31', '', '', '', '2099-12-31', '', '', '', '', 9.9, 8.8],
  ]), 'Charts');
  const zip = new AdmZip();
  zip.addFile('chart-data.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  return zip.toBuffer();
}

test('Citi/YouGov reads new official report data without a fixed month cutoff or fixed values', async () => {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requested.push(url);
    if (url === `${root}/sitemap/monetary-policy-report`) return new Response(`<a href="${report}">Monetary Policy Report - November 2099</a>`);
    if (url === report) return new Response(`<a href="${zipUrl}">Chart data</a>`);
    if (url === zipUrl) return new Response(new Uint8Array(chartData()));
    return new Response('', { status: 404 });
  };
  try {
    assert.deepEqual(await fetchBoeMprInflationSeries('CITI_YOUGOV_INFLATION_1Y'), [{ date: '2099-10-01', value: 4.2 }]);
    assert.deepEqual(await fetchBoeMprInflationSeries('CITI_YOUGOV_INFLATION_5_10Y'), [{ date: '2099-10-01', value: 4.0 }]);
    assert.ok(requested.includes(report));
  } finally { globalThis.fetch = original; }
});

test('unavailable official data cannot return a successful hard-coded September snapshot', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    await assert.rejects(fetchBoeMprInflationSeries('CITI_YOUGOV_INFLATION_1Y'), /no observations|request|official/i);
  } finally { globalThis.fetch = original; }
});
