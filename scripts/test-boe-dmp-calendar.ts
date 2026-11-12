import assert from 'node:assert/strict';
import { METRICS } from '../src/catalog/metrics';
import { buildEconomicCalendar } from '../src/lib/economic-calendar-view';

const ids = ['uk-dmp-own-price-exp-1y', 'uk-dmp-wage-exp-1y'];
const rows = ids.map(metricId => ({
  metricId, metricName: null, source: 'boe', family: 'DMP',
  nextReleaseDate: '2026-10-30', nextReleaseAt: '2026-10-30T09:30:00+00:00',
  status: 'scheduled', officialSource: 'https://www.bankofengland.co.uk/decision-maker-panel/2026/october-2026',
  officialEvidence: 'Expected release time based on official RSS publication history.',
  releaseTimeKind: 'expected', updatedAt: null,
}));
const calendar = buildEconomicCalendar(rows, [], METRICS, new Date('2026-10-30T07:00:00Z'));
for (const id of ids) {
  const event = calendar.allEvents.find(event => event.metricId === id);
  assert.ok(event, id);
  assert.equal(event.scheduledTimeLabel, 'Expected 09:30');
  assert.equal(event.scheduledAt, '2026-10-30T09:30:00.000Z');
  assert.equal(event.status, 'upcoming');
  assert.match(event.scheduleNote!, /official RSS/);
}
console.log('Both DMP calendar rows display expected 09:30 London time with provenance.');
