import assert from 'node:assert/strict';
import { parseStrikeReport } from './nfp-strike-report';

const html = `<h1>CES Strike Report</h1><p>Summary of strike activity during CES survey reference pay period, October 2026 (includes strikes of 1,000 workers or more)</p><table><tr><td>Total on strike</td><td>2,500</td></tr></table>`;
assert.deepEqual(parseStrikeReport(html), { referenceMonth: '2026-10', workers: 2500 });
assert.throws(() => parseStrikeReport('<p>No report</p>'));
assert.throws(() => parseStrikeReport(html.replace('2,500', '-')));
