import assert from 'node:assert/strict';
import { GET } from '../src/app/api/economic-calendar/route';
import { getClient } from '../src/db';
async function main() {
  const response = await GET();
  assert.equal(response.status,200);
  type Event = { metricId: string; metricName: string; previous: number | null; actual: number | null; scheduledDate: string | null };
  const payload = await response.json() as { allEvents: Event[]; recentEvents: Event[] };
  const events = payload.allEvents.filter(event => ['uk-retail-sales-total-ex-fuel','uk-retail-sales-ex-fuel'].includes(event.metricId));
  console.log(JSON.stringify(events,null,2));
  assert.equal(events.length,2);
  assert.ok(events.every(event => event.metricName.endsWith('MoM')));
  const released = payload.recentEvents.filter(event => ['uk-retail-sales-total-ex-fuel','uk-retail-sales-ex-fuel'].includes(event.metricId) && event.scheduledDate === '2026-10-23');
  console.log(JSON.stringify({released},null,2));
  assert.equal(released.length,2);
  assert.ok(released.every(event => event.previous != null && event.actual != null));
}
main().catch(error => {console.error(error);process.exitCode=1;}).finally(() => getClient().close());
