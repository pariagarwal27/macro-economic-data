import { loadEnvConfig } from "@next/env";
import { inArray } from "drizzle-orm";
import { METRICS } from "../src/catalog/metrics";
import { getActiveLiveSource, getSourceConfig } from "../src/ingest/source-registry";
import { fetchMetricFromOfficialSource } from "../src/ingest/source-adapter";
import { getDb } from "../src/db";
import { observations } from "../src/db/schema";

loadEnvConfig(process.cwd());

type Outcome = {
  region: string;
  metricId: string;
  name: string;
  adapter: string;
  sourceId: string;
  auditStatus: string;
  result: string;
  sourcePeriod: string;
  sourceValue: string;
  databasePeriod: string;
  freshness: string;
  detail: string;
};

const regions = ["US", "UK", "EA"] as const;
const maxConcurrent = 4;
const outputPath = process.argv[2] ?? "data/live-refresh-audit-2026-10-15.csv";

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizePeriod(value: string | null | undefined) {
  if (!value) return "";
  const date = value.match(/^(\d{4})-(\d{2})/);
  if (date) return `${date[1]}-${date[2]}`;
  const quarter = value.match(/^(\d{4})-?Q([1-4])$/i);
  if (quarter) return `${quarter[1]}-Q${quarter[2]}`;
  return value;
}

async function runPool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }));
}

async function main() {
  const ids = METRICS.map(metric => metric.id);
  const storedRows = await getDb().select({
    metricId: observations.metricId,
    date: observations.date,
    value: observations.value,
  }).from(observations).where(inArray(observations.metricId, ids));
  const latestStored = new Map<string, { date: string; value: number }>();
  for (const row of storedRows) {
    const previous = latestStored.get(row.metricId);
    if (!previous || row.date > previous.date) latestStored.set(row.metricId, { date: row.date, value: row.value });
  }

  const outcomes: Outcome[] = [];
  for (const region of regions) {
    const metrics = METRICS.filter(metric => metric.region === region);
    const regionOutcomes: Outcome[] = new Array(metrics.length);
    await runPool(metrics, async (metric) => {
      const index = metrics.indexOf(metric);
      const config = getSourceConfig(metric.id);
      const stored = latestStored.get(metric.id);
      const base: Outcome = {
        region,
        metricId: metric.id,
        name: metric.name,
        adapter: config?.source ?? "",
        sourceId: config?.sourceId ?? "",
        auditStatus: "",
        result: "",
        sourcePeriod: "",
        sourceValue: "",
        databasePeriod: stored?.date ?? "",
        freshness: "",
        detail: "",
      };

      if (!config) {
        base.result = "NO_ROUTE";
        base.auditStatus = "NO_ROUTE";
        base.detail = "No source configuration in the active live refresh registry";
        regionOutcomes[index] = base;
        return;
      }
      base.adapter = getActiveLiveSource(metric.id, false) ?? config.source;
      try {
        const result = await fetchMetricFromOfficialSource(metric.id);
        if (!result || !Number.isFinite(result.value)) {
          base.result = "NO_VALUE";
          base.detail = "Source request completed without a numeric latest reading";
        } else {
          base.result = "FETCHED";
          base.sourcePeriod = result.periodDate;
          base.sourceValue = String(result.value);
          base.detail = result.note ?? "";
          if (!stored) base.freshness = "NO_DB_HISTORY";
          else {
            const sourceKey = normalizePeriod(result.periodDate);
            const dbKey = normalizePeriod(stored.date);
            base.freshness = sourceKey === dbKey ? "MATCHES_DB_LATEST" : sourceKey > dbKey ? "NEWER_THAN_DB" : "OLDER_THAN_DB";
          }
        }
      } catch (error) {
        base.result = "FAILED";
        base.detail = error instanceof Error ? error.message : String(error);
      }
      base.auditStatus = base.result === "FETCHED"
        ? base.freshness === "OLDER_THAN_DB" ? "STALE" : "PASS"
        : base.result;
      regionOutcomes[index] = base;
    });
    outcomes.push(...regionOutcomes);
    const counts = regionOutcomes.reduce<Record<string, number>>((acc, item) => {
      acc[item.result] = (acc[item.result] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`${region}: ${JSON.stringify(counts)}`);
  }

  const headers: (keyof Outcome)[] = ["region", "metricId", "name", "adapter", "sourceId", "auditStatus", "result", "sourcePeriod", "sourceValue", "databasePeriod", "freshness", "detail"];
  const csv = [headers.join(","), ...outcomes.map(row => headers.map(header => quote(row[header])).join(","))].join("\n");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${csv}\n`, "utf8");
  console.log(`TOTAL: ${outcomes.length} metrics. Report: ${outputPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
