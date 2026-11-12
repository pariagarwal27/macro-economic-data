import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { fetchBoeDmpSeries, fetchBoeDmpWages } from './boe-dmp';
import { withFreshReleaseFetch } from './release-fetch-context.js';

test('release retries bypass the warm DMP workbook', async () => {
  const original = globalThis.fetch;
  let downloads = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('.xlsx')) {
      downloads++;
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['Realised wage growth over the past year (%)', null, null, null, 'Expected wage growth over the next year (%)'],
        ['Survey date/reference period', 'Single month', '3 month average', null, 'Single month', '3 month average'],
        ['Oct-26', 3.8, 3.9, null, 3.4, downloads === 1 ? 3.4 : 3.5],
      ]), 'Wage growth');
      return new Response(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    }
    return new Response('<a href="https://www.bankofengland.co.uk/monthly-dmp-data-september-2026.xlsx">old</a><a href="https://www.bankofengland.co.uk/monthly-dmp-data-october-2026.xlsx">current</a>');
  };
  try {
    assert.equal((await fetchBoeDmpWages('DMP_WAGE_EXPECTED_3M')).at(-1)?.value, 3.4);
    assert.equal((await withFreshReleaseFetch(() => fetchBoeDmpWages('DMP_WAGE_EXPECTED_3M'))).at(-1)?.value, 3.5);
    assert.equal((await fetchBoeDmpWages('DMP_WAGE_REALISED_3M')).at(-1)?.value, 3.9);
    assert.equal((await fetchBoeDmpWages('DMP_WAGE_EXPECTED_1M')).at(-1)?.value, 3.4);
    assert.equal((await fetchBoeDmpWages('DMP_WAGE_REALISED_1M')).at(-1)?.value, 3.8);
  } finally { globalThis.fetch = original; }
});

test('business release polling reads the exact own-price three-month average from the workbook', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const workbook = XLSX.utils.book_new();
  const priceRows: unknown[][] = [['Price growth workbook'], ['Expected price growth'], [...Array(12).fill(null), 'Expected price growth'], []];
  priceRows[3] = ['Survey date/reference period', ...Array(11).fill(null), 'Single month', '3 month average'];
  priceRows.push(['Oct-26', ...Array(11).fill(null), 3.9, 3.812]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(priceRows), 'Price growth');
  const payload = XLSX.write(workbook, {type:'buffer',bookType:'xlsx'});
  globalThis.fetch = async input => {
    requests.push(String(input));
    if (String(input).endsWith('.xlsx')) return new Response(payload);
    return new Response('<a href="https://www.bankofengland.co.uk/monthly-dmp-data-october-2026.xlsx">October workbook</a>');
  };
  try {
    const points = await withFreshReleaseFetch(() => fetchBoeDmpSeries('DMP_OWN_PRICE_EXPECTED_1Y'));
    const month = new Date().toISOString().slice(0, 7);
    assert.deepEqual(points, [{date: `${month}-01`, value: 3.812}]);
    assert.ok(requests.some(url => url.endsWith('.xlsx')));
  } finally { globalThis.fetch = original; }
});

test('CPI expectations select the labeled single-month horizon columns', async () => {
  const original = globalThis.fetch;
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = [
    ['CPI expectations workbook'], ['Survey measures'],
    [null, 'Current CPI inflation', null, '1-year ahead expectations', null, '3-year ahead expectations'],
    ['Survey date', 'Single month', '3 month average', 'Single month', '3 month average', 'Single month', '3 month average'],
    ['Oct-26', 3.214, 3.066, 3.435, 3.276, 2.749, 2.803],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'CPI expectations');
  const payload = XLSX.write(workbook, {type:'buffer',bookType:'xlsx'});
  globalThis.fetch = async input => String(input).endsWith('.xlsx')
    ? new Response(payload)
    : new Response('<a href="https://www.bankofengland.co.uk/monthly-dmp-data-october-2026.xlsx">October workbook</a>');
  try {
    const one = await withFreshReleaseFetch(() => fetchBoeDmpSeries('DMP_CPI_EXPECTED_1Y'));
    const three = await withFreshReleaseFetch(() => fetchBoeDmpSeries('DMP_CPI_EXPECTED_3Y'));
    assert.deepEqual(one, [{date:'2026-10-01',value:3.435}]);
    assert.deepEqual(three, [{date:'2026-10-01',value:2.749}]);
  } finally { globalThis.fetch = original; }
});
