import { sqliteTable, text, real, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const metrics = sqliteTable(
  "metrics",
  {
    id: text("id").primaryKey(),
    region: text("region").notNull(), // US | UK | EA
    category: text("category").notNull(), // inflation | growth | jobs
    subcategory: text("subcategory").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    description: text("description").notNull(),
    source: text("source").notNull(), // fred | eurostat | ons
    seriesId: text("series_id").notNull(),
    transform: text("transform").notNull(), // level | pct_change | pct_change_yoy | pct_change_mom | index
    frequency: text("frequency").notNull(),
    unit: text("unit").notNull(),
    importance: text("importance").notNull(), // critical | high | medium | supporting
    officialUrl: text("official_url").notNull(),
    docsUrl: text("docs_url").notNull(),
    releaseName: text("release_name").notNull(),
    earliestAvailable: text("earliest_available"),
    lastIngestedAt: text("last_ingested_at"),
    observationCount: integer("observation_count").default(0),
  },
  (t) => [
    index("metrics_region_idx").on(t.region),
    index("metrics_category_idx").on(t.category),
    index("metrics_importance_idx").on(t.importance),
  ]
);

export const observations = sqliteTable(
  "observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    metricId: text("metric_id")
      .notNull()
      .references(() => metrics.id),
    date: text("date").notNull(), // observation period YYYY-MM-DD
    value: real("value").notNull(),
    rawValue: real("raw_value"),
    releasedAt: text("released_at"),
    vintageDate: text("vintage_date"),
    isLatest: integer("is_latest", { mode: "boolean" }).default(true),
  },
  (t) => [
    uniqueIndex("obs_metric_date_vintage").on(t.metricId, t.date, t.vintageDate),
    index("obs_metric_date_idx").on(t.metricId, t.date),
    index("obs_latest_idx").on(t.metricId, t.isLatest),
  ]
);

export const releases = sqliteTable(
  "releases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    metricId: text("metric_id")
      .notNull()
      .references(() => metrics.id),
    periodDate: text("period_date").notNull(),
    releasedAt: text("released_at").notNull(),
    value: real("value").notNull(),
    expectedValue: real("expected_value"), // consensus / forecast at release
    priorPeriodValue: real("prior_period_value"),
    priorPeriodDate: text("prior_period_date"),
    priorReleaseValue: real("prior_release_value"), // same period revised
    changeVsPriorPeriod: real("change_vs_prior_period"),
    changeVsPriorRelease: real("change_vs_prior_release"),
    supportingDocUrl: text("supporting_doc_url"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("release_metric_period").on(t.metricId, t.periodDate, t.releasedAt),
    index("release_metric_idx").on(t.metricId),
  ]
);

/** Raw economic-calendar dumps (Investing.com etc.) before / after metric mapping. */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull().default("investing"),
    country: text("country").notNull(), // US | UK | EA | DE | FR | IT | ES | …
    currency: text("currency"), // USD | GBP | EUR | …
    eventName: text("event_name").notNull(),
    importance: integer("importance"), // 1–3 stars
    releasedAt: text("released_at").notNull(), // ISO UTC
    periodDate: text("period_date"), // YYYY-MM-DD when parsable
    periodLabel: text("period_label"), // e.g. Jun, Q2
    actual: real("actual"),
    forecast: real("forecast"),
    previous: real("previous"),
    rawActual: text("raw_actual"),
    rawForecast: text("raw_forecast"),
    rawPrevious: text("raw_previous"),
    metricId: text("metric_id"),
    dumpFile: text("dump_file"),
    importedAt: text("imported_at").notNull(),
  },
  (t) => [
    uniqueIndex("calendar_event_uniq").on(t.source, t.country, t.eventName, t.releasedAt),
    index("calendar_metric_idx").on(t.metricId),
    index("calendar_released_idx").on(t.releasedAt),
  ]
);

export const ingestRuns = sqliteTable("ingest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  mode: text("mode").notNull(), // backfill | refresh
  status: text("status").notNull(), // running | ok | error
  metricsProcessed: integer("metrics_processed").default(0),
  observationsUpserted: integer("observations_upserted").default(0),
  error: text("error"),
});

export const sourceHandles = sqliteTable("source_handles", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull().default("x"),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  region: text("region"),
  role: text("role").notNull(), // official | analyst | aggregator
  notes: text("notes"),
});
