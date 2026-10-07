import assert from 'node:assert/strict';
import { getDashboardCalendarMetrics } from '../src/lib/dashboard-calendar-metrics';
import { buildEconomicCalendar } from '../src/lib/economic-calendar-view';

const metrics = getDashboardCalendarMetrics();
assert.ok(metrics.some(metric => metric.id === 'ea-retail-sales-total-ex-motor-vehicles'));
assert.ok(!metrics.some(metric => ['ea-retail-sales', 'ea-retail-sales-mom', 'ea-retail-automotive-fuel'].includes(metric.id)), 'Hide unused standalone series and detail-only components');
assert.ok(metrics.some(metric => metric.id === 'us-cpi-mom'), 'Keep separately displayed card series');
assert.equal(new Set(metrics.map(metric => metric.id)).size, metrics.length);
const metricId = 'ea-retail-sales-total-ex-motor-vehicles';
const schedule = {metricId, metricName:'Retail', source:'Eurostat', family:'RETAIL_TRADE',nextReleaseDate:'2026-10-06',nextReleaseAt:'2026-10-06T11:00:00+02:00',status:'official_date',officialSource:null,officialEvidence:null,updatedAt:null};
const payload = buildEconomicCalendar([{...schedule,nextReleaseDate:'2026-11-06',nextReleaseAt:'2026-11-06T11:00:00+01:00'}], [{id:4465,metricId,releasedAt:'2026-10-06T10:08:54.160Z',value:0.0962,expectedValue:null,priorPeriodValue:null}], metrics, new Date('2026-10-07T12:00:00Z'), {history:[schedule]});
assert.equal(payload.week['2026-10-06'].find(event => event.metricId === metricId)?.status, 'released');
assert.equal(payload.allEvents.find(event => event.metricId === metricId)?.status, 'upcoming');
console.log('Dashboard-only calendar and committed retail release matching passed');
