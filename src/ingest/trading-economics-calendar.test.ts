import assert from "node:assert/strict";
import { normalizeTradingEconomicsEvent, fetchTradingEconomicsCalendar } from "./trading-economics-calendar";

async function main() {
  const row = { CalendarId: "1", Country: "United States", Event: "Initial Jobless Claims", Date: "2026-11-12T13:30:00", Forecast: "189K", TEForecast: "999K", Unit: "K" };
  assert.deepEqual(normalizeTradingEconomicsEvent(row), { id: "1", country: "US", metricId: "us-initial-claims", eventName: "Initial Jobless Claims", releasedAt: "2026-11-12T13:30:00.000Z", forecast: 189000, rawForecast: "189K" });
  assert.equal(normalizeTradingEconomicsEvent({ ...row, Forecast: "", TEForecast: "199K" })?.forecast, null);
  assert.equal(normalizeTradingEconomicsEvent({ ...row, Country: "Germany" }), null);
  assert.equal(normalizeTradingEconomicsEvent({ ...row, Event: "Unknown Indicator" }), null);
  const urls: string[] = [];
  const items = await fetchTradingEconomicsCalendar("secret", new Date("2026-11-11T12:00:00Z"), async (url, init) => {
    urls.push(String(url));
    assert.equal(new Headers(init?.headers).get("authorization"), "secret");
    const country = String(url).includes("United%20Kingdom") ? "United Kingdom" : String(url).includes("Euro%20Area") ? "Euro Area" : "United States";
    const event = country === "United States" ? row : { ...row, Country: country, Event: "Unemployment Rate", Forecast: "4.2%" };
    return new Response(JSON.stringify([event]), { status: 200 });
  });
  assert.equal(urls.length, 3);
  assert.equal(urls.some(url => url.includes("secret")), false);
  assert.equal(items.events.length, 3);
  await assert.rejects(() => fetchTradingEconomicsCalendar("secret", new Date("2026-11-11T12:00:00Z"), async () => new Response("denied", { status: 403 })));
  console.log("Trading Economics calendar checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
