import assert from 'node:assert/strict';
import { DASHBOARD } from '../src/components/macro-ui-hierarchy.ts';
import { priceStudioSpecs, ppiComparisonSpecs } from '../src/components/inflation-view-specs.ts';

const studio = priceStudioSpecs('US', DASHBOARD.US.prices);
const ppi = studio.find(spec => spec.id === 'us-ppi-card');
assert.ok(ppi, 'US primary-price filtering must retain the PPI tab source');
const main = ppiComparisonSpecs(ppi);
assert.deepEqual(main.map(spec => spec.title), ['Final Demand', 'Intermediate Demand'], 'only the two demand families belong on the overview');
const finalDemand = main[0];
const intermediate = main[1];
const goods = finalDemand.components?.find(node => node.metricId === 'us-ppi-goods-yoy');
assert.ok(goods?.children?.some(node => node.metricId === 'us-ppi-foods-yoy'), 'opening goods must expose food subcomponents');
assert.ok(!main.some(spec => spec.metricId === 'us-ppi-foods-yoy'), 'food belongs inside goods, rather than the overview');
const services = finalDemand.components?.find(node => node.metricId === 'us-ppi-services-yoy');
assert.ok(services?.children?.some(node => node.metricId === 'us-ppi-final-demand-trade-yoy'), 'opening services must expose trade services');
assert.equal(intermediate.groupOnly, true, 'BLS has no intermediate-demand aggregate rate');
assert.equal(intermediate.chartMetricIds?.length, 3, 'the intermediate family charts the three official commodity-type indices');
console.log('US PPI survives page filtering and retains nested detail cards.');
