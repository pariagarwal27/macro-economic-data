import assert from 'node:assert/strict';
import test from 'node:test';
import { retailDriverRate } from './retail-driver-readings';

test('headline and ex-fuel use the exact selected month and published YoY series', () => {
  const metrics = {
    'uk-retail-sales-ex-fuel': {history:[{date:'2026-08-01',value:0.9},{date:'2026-09-01',value:-0.7}]},
    'uk-retail-sales-ex-fuel-yoy': {history:[{date:'2026-08-01',value:2.9},{date:'2026-09-01',value:0.8}]},
  };
  assert.equal(retailDriverRate(metrics,'uk-retail-sales-ex-fuel','mom','2026-08'),0.9);
  assert.equal(retailDriverRate(metrics,'uk-retail-sales-ex-fuel','yoy','2026-09'),0.8);
  assert.equal(retailDriverRate(metrics,'uk-retail-sales-ex-fuel','mom','2026-10'),null);
});
test('component YoY uses underlying index levels, not a change in monthly rates', () => {
  const metrics = {'uk-retail-food-stores':{history:[
    {date:'2025-09-01',value:0.2,rawValue:100},{date:'2026-09-01',value:0.3,rawValue:104},
  ]}};
  assert.equal(retailDriverRate(metrics,'uk-retail-food-stores','mom','2026-09'),0.3);
  assert.ok(Math.abs(retailDriverRate(metrics,'uk-retail-food-stores','yoy','2026-09')! - 4)<1e-10);
  assert.equal(retailDriverRate({'x':{history:[{date:'2026-09-01',value:0.3}]}},'x','yoy','2026-09'),null);
});
