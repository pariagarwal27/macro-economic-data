import assert from "node:assert/strict";
import { cpiReleaseCandidates } from "../src/ingest/cpi-release-schedule.ts";

const schedule = [
  {
    metricId: "us-cpi",
    nextReleaseDate: "2026-10-14",
    nextReleaseAt: "2026-10-14T08:30:00-04:00",
  },
];

const beforeBls = cpiReleaseCandidates(schedule, new Date("2026-10-14T12:29:59Z"));
assert.deepEqual(beforeBls, [], "CPI-dependent series must wait for the official BLS release time");

const atBls = cpiReleaseCandidates(schedule, new Date("2026-10-14T12:30:00Z"));
assert.deepEqual(atBls.map((candidate) => candidate.metricId), [
  "us-cpi-yoy",
  "us-core-cpi-mom",
  "us-core-cpi-yoy",
]);
assert.ok(atBls.every((candidate) => candidate.scheduledAt === "2026-10-14T12:30:00.000Z"));

const beforeCleveland = cpiReleaseCandidates(schedule, new Date("2026-10-14T14:59:59Z"));
assert.equal(beforeCleveland.some((candidate) => candidate.metricId === "us-cleveland-median-cpi"), false);

const atCleveland = cpiReleaseCandidates(schedule, new Date("2026-10-14T15:00:00Z"));
const underlyingIds = atCleveland.filter((candidate) => candidate.metricId.includes("sticky-cpi") || candidate.metricId.includes("flexible-cpi") || candidate.metricId.includes("cleveland-")).map((candidate) => candidate.metricId);
assert.deepEqual(underlyingIds.slice(-2), ["us-cleveland-median-cpi-mom", "us-cleveland-trimmed-cpi-mom"]);
assert.ok(underlyingIds.includes("us-cleveland-median-cpi") && underlyingIds.includes("us-cleveland-trimmed-cpi"));
assert.ok(atCleveland.slice(3).every((candidate) => candidate.scheduledAt === "2026-10-14T15:00:00.000Z"));
assert.deepEqual(cpiReleaseCandidates(schedule, new Date("2026-10-15T12:30:00Z")), [], "CPI-dependent metrics must stop retrying after the release day");

console.log("US CPI, core CPI and Cleveland Fed releases are scheduled at their official release times");
