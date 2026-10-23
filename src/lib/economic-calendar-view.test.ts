import assert from "node:assert/strict";
import test from "node:test";
import type { MetricDef } from "@/catalog/metrics";
import { buildEconomicCalendar, inheritSharedReleaseSchedules, filterReleaseDiaryEvents, filterScheduledCalendarEvents, isWithinLastSevenCalendarDays, isWithinPastAndNextSevenCalendarDays } from "./economic-calendar-view";
import { getDashboardCalendarMetrics } from './dashboard-calendar-metrics';

test('retail diary inherits one release time and displays independent previous and actual MoM values', () => {
  const catalog = getDashboardCalendarMetrics().filter(metric => ['uk-retail-sales-total-ex-fuel','uk-retail-sales-ex-fuel'].includes(metric.id));
  const schedule = inheritSharedReleaseSchedules([{ metricId: 'uk-retail-sales-total-ex-fuel', nextReleaseDate: '2026-10-23', nextReleaseAt: '2026-10-23T06:00:00Z' }],catalog);
  const result = buildEconomicCalendar(schedule as never[],[
    {metricId:'uk-retail-sales-total-ex-fuel',periodDate:'2026-09-01',releasedAt:'2026-10-23T06:01:00Z',value:-0.4,expectedValue:null,priorPeriodValue:0.7},
    {metricId:'uk-retail-sales-ex-fuel',periodDate:'2026-09-01',releasedAt:'2026-10-23T06:02:00Z',value:-0.7,expectedValue:null,priorPeriodValue:0.9},
  ],catalog,new Date('2026-10-23T07:00:00Z'));
  assert.deepEqual(result.todayEvents.map(event => [event.metricName,event.previous,event.actual,event.status]),[
    ['Retail Sales Headline MoM',0.7,-0.4,'released'],['Retail Sales ex Fuel MoM',0.9,-0.7,'released'],
  ]);
});

test("a placeholder without a date inherits the official calendar from its release family", () => {
  const catalog = [
    { id: "us-cpi-mom", name: "Headline CPI", region: "US", source: "bls", releaseName: "Consumer Price Index", frequency: "monthly" },
    { id: "us-core-cpi-mom", name: "Core CPI", region: "US", source: "bls", releaseName: "Consumer Price Index", frequency: "monthly" },
    { id: "uk-cpi", name: "UK CPI", region: "UK", source: "ons", releaseName: "Consumer Price Index", frequency: "monthly" },
  ] as MetricDef[];
  const result = inheritSharedReleaseSchedules([
    { metricId: "us-cpi-mom", nextReleaseDate: "2026-11-10", nextReleaseAt: "2026-11-10T13:30:00Z" },
    { metricId: "us-core-cpi-mom", nextReleaseDate: null, nextReleaseAt: null },
  ], catalog);
  const core = result.filter(row => row.metricId === "us-core-cpi-mom");
  assert.equal(core.length, 1);
  assert.equal(core[0].nextReleaseDate, "2026-11-10");
  assert.equal(result.some(row => row.metricId === "uk-cpi"), false);
});

const diaryEvents = [
  { metricId: "old", region: "US", scheduleType: "scheduled", scheduledDate: "2026-10-12", status: "released" },
  { metricId: "history-start", region: "US", scheduleType: "scheduled", scheduledDate: "2026-10-13", status: "released" },
  { metricId: "past-pending", region: "US", scheduleType: "scheduled", scheduledDate: "2026-10-18", status: "pending" },
  { metricId: "today-released", region: "US", scheduleType: "scheduled", scheduledDate: "2026-10-19", status: "released" },
  { metricId: "today-pending", region: "UK", scheduleType: "scheduled", scheduledDate: "2026-10-19", status: "pending" },
  { metricId: "tomorrow", region: "UK", scheduleType: "scheduled", scheduledDate: "2026-10-20", status: "upcoming" },
  { metricId: "next-seven", region: "EA", scheduleType: "scheduled", scheduledDate: "2026-10-26", status: "upcoming" },
  { metricId: "next-eight", region: "US", scheduleType: "scheduled", scheduledDate: "2026-10-27", status: "upcoming" },
  { metricId: "daily", region: "US", scheduleType: "daily", scheduledDate: "2026-10-19", status: "released" },
  { metricId: "no-date", region: "US", scheduleType: "unannounced", scheduledDate: null, status: "unscheduled" },
];

test("upcoming diary includes today and seven days ahead, excluding past and continuous series", () => {
  assert.deepEqual(filterReleaseDiaryEvents(diaryEvents, "upcoming", "2026-10-19").map(event => event.metricId),
    ["today-released", "today-pending", "tomorrow", "next-seven"]);
});

test("history diary includes only confirmed releases in the last seven calendar days including today", () => {
  assert.deepEqual(filterReleaseDiaryEvents(diaryEvents, "history", "2026-10-19").map(event => event.metricId),
    ["history-start", "today-released"]);
});

test("both release diary tabs respect the selected country", () => {
  assert.deepEqual(filterReleaseDiaryEvents(diaryEvents, "upcoming", "2026-10-19", "UK").map(event => event.metricId),
    ["today-pending", "tomorrow"]);
  assert.deepEqual(filterReleaseDiaryEvents(diaryEvents, "history", "2026-10-19", "UK"), []);
});

test("calendar diary filters out daily/hourly series and optionally limits releases to one country", () => {
  const events = [
    { region: "US", scheduleType: "scheduled", metricId: "us-cpi" },
    { region: "UK", scheduleType: "scheduled", metricId: "uk-gdp" },
    { region: "EA", scheduleType: "daily", metricId: "ea-breakeven" },
    { region: "US", scheduleType: "hourly", metricId: "us-claims" },
    { region: "UK", scheduleType: "unannounced", metricId: "uk-other" },
  ];

  assert.deepEqual(filterScheduledCalendarEvents(events, "US").map(event => event.metricId), ["us-cpi"]);
  assert.deepEqual(filterScheduledCalendarEvents(events, "ALL").map(event => event.metricId), ["us-cpi", "uk-gdp"]);
});

test("last seven days includes today and excludes earlier, future, and continuous series", () => {
  assert.equal(isWithinLastSevenCalendarDays("2026-10-06", "scheduled", "2026-10-12"), true);
  assert.equal(isWithinLastSevenCalendarDays("2026-10-05", "scheduled", "2026-10-12"), false);
  assert.equal(isWithinLastSevenCalendarDays("2026-10-13", "scheduled", "2026-10-12"), false);
  assert.equal(isWithinLastSevenCalendarDays(null, "daily", "2026-10-12"), false);
});

test("two-sided week includes the past seven days and next seven days around today", () => {
  assert.equal(isWithinPastAndNextSevenCalendarDays("2026-10-09", "scheduled", "2026-10-15"), true);
  assert.equal(isWithinPastAndNextSevenCalendarDays("2026-10-08", "scheduled", "2026-10-15"), false);
  assert.equal(isWithinPastAndNextSevenCalendarDays("2026-10-22", "scheduled", "2026-10-15"), true);
  assert.equal(isWithinPastAndNextSevenCalendarDays("2026-10-23", "scheduled", "2026-10-15"), false);
  assert.equal(isWithinPastAndNextSevenCalendarDays("2026-10-16", "daily", "2026-10-15"), false);
});

test("released event uses the previous observation when the release omits priorPeriodValue", () => {
  const metric = {
    id: "us-cleveland-exp-inf-1y", region: "US", category: "inflation", subcategory: "expectations",
    name: "Cleveland 1Y", shortName: "Cleveland 1Y", description: "", source: "fred", seriesId: "SERIES",
    transform: "published_rate", frequency: "monthly", unit: "percent", importance: "high",
    officialUrl: "", docsUrl: "", releaseName: "Cleveland Expectations",
  } as MetricDef;
  const schedule = [{
    metricId: metric.id, metricName: metric.name, source: "FRED", family: "CLEVELAND",
    nextReleaseDate: "2026-10-07", nextReleaseAt: "2026-10-07T16:00:00Z", status: "success",
    officialSource: "", updatedAt: "2026-10-07T16:00:00Z",
  }];
  const result = buildEconomicCalendar(schedule, [{
    id: 4, metricId: metric.id, periodDate: "2026-09-01", releasedAt: "2026-10-07T16:00:00Z",
    value: 2.64, expectedValue: null, priorPeriodValue: null,
  }], [metric], new Date("2026-10-12T12:00:00Z"), {
    releaseHistory: new Map([[metric.id, [
      { periodDate: "2026-09-01", value: 2.64 },
      { periodDate: "2026-08-01", value: 2.39 },
    ]]]),
  });

  assert.equal(result.allEvents[0].previous, 2.39);
  assert.equal(result.allEvents[0].actual, 2.64);
  assert.equal(result.allEvents[0].status, "released");
  assert.equal(result.recentEvents.length, 1);
});

test("PCE diary uses four rate readings with rate-based previous and released values", () => {
  const releaseName = "Personal Income and Outlays";
  const ids = ["us-pce", "us-core-pce", "us-pce-mom", "us-pce-yoy", "us-core-pce-mom", "us-core-pce-yoy"];
  const catalog = ids.map(id => ({
    id, name: id, region: "US", source: "bea", releaseName, frequency: "monthly", unit: "percent",
  })) as MetricDef[];
  const rates = ["us-pce-mom", "us-pce-yoy", "us-core-pce-mom", "us-core-pce-yoy"];
  const scheduled = inheritSharedReleaseSchedules([
    { metricId: "us-pce", nextReleaseDate: "2026-10-29", nextReleaseAt: "2026-10-29T12:30:00Z" },
  ], catalog);
  const actuals = rates.map((metricId, index) => ({
    metricId, periodDate: "2026-09-01", releasedAt: "2026-10-29T12:30:00Z",
    value: 1 + index, expectedValue: null, priorPeriodValue: 0.5 + index,
  }));
  const result = buildEconomicCalendar(scheduled as never[], actuals, catalog, new Date("2026-10-29T14:00:00Z"), {
    latestValues: new Map(rates.map((id, index) => [id, 0.5 + index])),
  });

  assert.deepEqual(result.allEvents.map(event => event.metricId).sort(), rates.slice().sort());
  for (const [index, id] of rates.entries()) {
    const event = result.allEvents.find(item => item.metricId === id)!;
    assert.equal(event.previous, 0.5 + index);
    assert.equal(event.actual, 1 + index);
    assert.equal(event.status, "released");
  }
});

test("all-metrics next release advances to the earliest confirmed future schedule while retaining history", () => {
  const metric = { id: "us-cpi", name: "CPI", region: "US", frequency: "monthly", unit: "percent" } as MetricDef;
  const published = { metricId: metric.id, metricName: "CPI", source: "BLS", family: "CPI", nextReleaseDate: "2026-10-14", nextReleaseAt: "2026-10-14T12:30:00Z", status: "success", officialSource: null, updatedAt: null };
  const result = buildEconomicCalendar([published], [{ metricId: metric.id, releasedAt: "2026-10-14T12:30:00Z", value: 3.2, expectedValue: null, priorPeriodValue: 3 }], [metric], new Date("2026-10-19T12:00:00Z"), {
    history: [
      { ...published, nextReleaseDate: "2026-12-10", nextReleaseAt: "2026-12-10T13:30:00Z" },
      { ...published, nextReleaseDate: "2026-11-10", nextReleaseAt: "2026-11-10T13:30:00Z" },
    ],
  });
  assert.equal(result.nextReleaseEvents[0].scheduledDate, "2026-11-10");
  assert.equal(result.nextReleaseEvents[0].scheduledTime, "13:30");
  assert.equal(result.nextReleaseEvents[0].status, "upcoming");
  assert.equal(result.nextReleaseEvents[0].actual, null);
  assert.equal(result.recentEvents[0].scheduledDate, "2026-10-14");
  assert.equal(result.recentEvents[0].status, "released");
});

test("all-metrics does not reuse a published date or invent a next date when no future schedule is available", () => {
  const metric = { id: "us-cpi", name: "CPI", region: "US", frequency: "monthly", unit: "percent" } as MetricDef;
  const published = { metricId: metric.id, metricName: "CPI", source: "BLS", family: "CPI", nextReleaseDate: "2026-10-14", nextReleaseAt: "2026-10-14T12:30:00Z", status: "success", officialSource: null, updatedAt: null };
  const result = buildEconomicCalendar([published], [{ metricId: metric.id, releasedAt: "2026-10-14T12:30:00Z", value: 3.2, expectedValue: null, priorPeriodValue: 3 }], [metric], new Date("2026-10-19T12:00:00Z"));
  assert.equal(result.nextReleaseEvents[0].scheduledDate, null);
  assert.equal(result.nextReleaseEvents[0].scheduledAt, null);
  assert.equal(result.nextReleaseEvents[0].status, "unscheduled");
  assert.equal(result.nextReleaseEvents[0].scheduleType, "source-error", "A stale calendar is not evidence that the next publication is unannounced");
  assert.equal(result.allEvents[0].status, "released");
});
