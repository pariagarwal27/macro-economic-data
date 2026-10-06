/**
 * Dry-run: simulate how each economy's metrics update when releases land.
 * Does NOT write to the database — only probes live APIs and prints the cascade.
 *
 * Usage: npx tsx scripts/simulate-release-updates.ts
 */
import { METRICS } from "../src/catalog/metrics";
import { LIVE_MAP } from "../src/catalog/live-map";
import { fetchBlsSeries } from "../src/ingest/bls";
import { fetchBlsCpiRelease, fetchBlsEmpsitRelease } from "../src/ingest/bls-releases";
import { fetchAdpNational } from "../src/ingest/adp";
import { fetchGdpNow } from "../src/ingest/fed-regional";
import { fetchOnsSeries } from "../src/ingest/ons";
import { fetchOnsPpiBulletin } from "../src/ingest/ons-ppi-bulletin";
import { fetchEurostatPreset } from "../src/ingest/eurostat";
import { fetchReleaseFeeds, mapFeedItemsToMetrics } from "../src/ingest/rss";
import { applyTransform, round } from "../src/ingest/transforms";
import { writeFileSync } from "fs";
import { join } from "path";

type Region = "US" | "UK" | "EA";

interface ReleaseEvent {
  region: Region;
  name: string;
  typicalDay: string;
  provider: string;
  metricIds: string[];
}

/** Headline release calendar → metrics that flip on that print. */
const RELEASE_EVENTS: ReleaseEvent[] = [
  // ─── US ─────────────────────────────────────────────────────
  {
    region: "US",
    name: "ADP National Employment Report",
    typicalDay: "Wed before NFP (~08:15 ET)",
    provider: "adp JSON",
    metricIds: ["us-adp-change", "us-adp-level"],
  },
  {
    region: "US",
    name: "Employment Situation (NFP / U-3)",
    typicalDay: "1st Fri (~08:30 ET)",
    provider: "BLS API (+ HTML fallback)",
    metricIds: [
      "us-nfp",
      "us-payrolls-level",
      "us-unemployment",
      "us-u6",
      "us-participation",
      "us-ahe",
      "us-avg-workweek",
      "us-mfg-employment",
      "us-temp-help",
    ],
  },
  {
    region: "US",
    name: "CPI",
    typicalDay: "~mid-month (~08:30 ET)",
    provider: "BLS API (+ HTML fallback)",
    metricIds: [
      "us-cpi",
      "us-cpi-yoy",
      "us-cpi-mom",
      "us-core-cpi",
      "us-core-cpi-yoy",
      "us-core-cpi-mom",
    ],
  },
  {
    region: "US",
    name: "PPI",
    typicalDay: "day after CPI (~08:30 ET)",
    provider: "BLS API",
    metricIds: ["us-ppi-final-demand", "us-ppi-core"],
  },
  {
    region: "US",
    name: "JOLTS",
    typicalDay: "~1st Tue following month",
    provider: "BLS API",
    metricIds: [
      "us-jolts-openings",
      "us-jolts-quits",
      "us-jolts-hires",
      "us-jolts-layoffs",
    ],
  },
  {
    region: "US",
    name: "Weekly Claims",
    typicalDay: "Thu (~08:30 ET)",
    provider: "DOL ETA",
    metricIds: ["us-initial-claims", "us-continuing-claims"],
  },
  {
    region: "US",
    name: "GDPNow update",
    typicalDay: "after data drops (~morning)",
    provider: "Atlanta Fed",
    metricIds: ["us-gdp-now"],
  },
  {
    region: "US",
    name: "Personal Income & Outlays / GDP",
    typicalDay: "BEA calendar",
    provider: "BEA API (needs BEA_API_KEY)",
    metricIds: [
      "us-pce",
      "us-core-pce",
      "us-core-pce-mom",
      "us-personal-spending",
      "us-gdp-real",
    ],
  },

  // ─── UK ─────────────────────────────────────────────────────
  {
    region: "UK",
    name: "Consumer Price Inflation",
    typicalDay: "~mid-month (ONS)",
    provider: "ONS CSV generator",
    metricIds: ["uk-cpi-yoy", "uk-cpih-yoy", "uk-core-cpi-yoy", "uk-rpi-yoy"],
  },
  {
    region: "UK",
    name: "Producer Price Inflation",
    typicalDay: "~3 weeks after month-end",
    provider: "ONS CSV + PPI bulletin",
    metricIds: ["uk-ppi-input-yoy", "uk-ppi-output-yoy"],
  },
  {
    region: "UK",
    name: "Labour Market / AWE",
    typicalDay: "~mid-month (LFS lag)",
    provider: "ONS CSV generator",
    metricIds: [
      "uk-unemployment",
      "uk-employment-level",
      "uk-vacancies",
      "uk-awe-regular-yoy",
      "uk-awe-total-yoy",
    ],
  },
  {
    region: "UK",
    name: "GDP / IoP / Retail",
    typicalDay: "ONS release calendar",
    provider: "ONS CSV generator",
    metricIds: [
      "uk-gdp-qoq",
      "uk-industrial-production",
      "uk-retail-sales",
    ],
  },

  // ─── Euro Area ──────────────────────────────────────────────
  {
    region: "EA",
    name: "HICP (EA + national)",
    typicalDay: "~end of month / flash schedule",
    provider: "Eurostat API prc_hicp_minr",
    metricIds: [
      "ea-hicp-yoy",
      "ea-core-hicp-yoy",
      "de-cpi-yoy",
      "fr-cpi-yoy",
      "it-cpi-yoy",
      "es-cpi-yoy",
    ],
  },
  {
    region: "EA",
    name: "Unemployment",
    typicalDay: "~end of following month",
    provider: "Eurostat API ei_lmhr / ei_lmhu",
    metricIds: [
      "ea-unemployment",
      "ea-youth-unemployment",
      "ea-unemployed-persons",
      "ea-employment-yoy",
    ],
  },
  {
    region: "EA",
    name: "IP / PPI / Retail",
    typicalDay: "STS / EI calendar",
    provider: "Eurostat API",
    metricIds: [
      "ea-industrial-production",
      "ea-ppi-yoy",
      "ea-retail-sales",
    ],
  },
  {
    region: "EA",
    name: "Business & Consumer Surveys",
    typicalDay: "~end of month",
    provider: "Eurostat API ei_bssi_m_r2",
    metricIds: ["ea-esi", "ea-business-confidence"],
  },
];

interface MetricResult {
  id: string;
  name: string;
  liveProvider: string | null;
  status: "would_update_live" | "fred_fallback" | "missing_from_catalog" | "probe_failed";
  tipDate?: string;
  tipValue?: number;
  note?: string;
}

interface EventResult {
  region: Region;
  name: string;
  typicalDay: string;
  provider: string;
  metrics: MetricResult[];
  liveHits: number;
  fallbacks: number;
}

async function probeMetric(id: string): Promise<MetricResult> {
  const metric = METRICS.find((m) => m.id === id);
  if (!metric) {
    return {
      id,
      name: id,
      liveProvider: null,
      status: "missing_from_catalog",
    };
  }
  const live = LIVE_MAP[id];
  const liveProvider = live?.provider ?? null;

  try {
    if (live?.provider === "bls") {
      // Shared cache filled in main()
      const cached = (globalThis as unknown as { __blsCache?: Map<string, import("../src/ingest/transforms").RawPoint[]> }).__blsCache;
      const html = (globalThis as unknown as {
        __blsHtml?: {
          empsit: Awaited<ReturnType<typeof fetchBlsEmpsitRelease>>;
          cpi: Awaited<ReturnType<typeof fetchBlsCpiRelease>>;
        };
      }).__blsHtml;

      const pts = cached?.get(live.seriesId) ?? [];
      if (pts.length) {
        const transformed = applyTransform(pts, metric.transform);
        const tip = transformed.at(-1);
        return {
          id,
          name: metric.shortName,
          liveProvider: "bls",
          status: "would_update_live",
          tipDate: tip?.date,
          tipValue: tip ? round(tip.value) : undefined,
          note: `BLS API ${live.seriesId}`,
        };
      }

      if (html) {
        if (id === "us-nfp" && html.empsit.nfpChange) {
          return {
            id,
            name: metric.shortName,
            liveProvider: "bls",
            status: "would_update_live",
            tipDate: html.empsit.nfpChange.date,
            tipValue: html.empsit.nfpChange.value,
            note: "BLS empsit HTML (API down)",
          };
        }
        if (id === "us-unemployment" && html.empsit.unemployment) {
          return {
            id,
            name: metric.shortName,
            liveProvider: "bls",
            status: "would_update_live",
            tipDate: html.empsit.unemployment.date,
            tipValue: html.empsit.unemployment.value,
            note: "BLS empsit HTML (API down)",
          };
        }
        const cpiMap: Record<string, { date: string; value: number } | null> = {
          "us-cpi-mom": html.cpi.cpiMom,
          "us-cpi-yoy": html.cpi.cpiYoy,
          "us-core-cpi-mom": html.cpi.coreMom,
          "us-core-cpi-yoy": html.cpi.coreYoy,
        };
        const pt = cpiMap[id];
        if (pt) {
          return {
            id,
            name: metric.shortName,
            liveProvider: "bls",
            status: "would_update_live",
            tipDate: pt.date,
            tipValue: pt.value,
            note: "BLS CPI HTML (API down)",
          };
        }
      }

      return {
        id,
        name: metric.shortName,
        liveProvider: "bls",
        status: "fred_fallback",
        note: "BLS API empty & no HTML tip → FRED merge on refresh",
      };
    }

    if (live?.provider === "adp") {
      const adp = (globalThis as unknown as { __adp?: Awaited<ReturnType<typeof fetchAdpNational>> }).__adp
        ?? (await fetchAdpNational());
      (globalThis as unknown as { __adp?: typeof adp }).__adp = adp;
      const pts = live.seriesId === "change" ? adp.change : adp.level;
      const tip = pts.at(-1);
      if (tip) {
        return {
          id,
          name: metric.shortName,
          liveProvider: "adp",
          status: "would_update_live",
          tipDate: tip.date,
          tipValue: tip.value,
          note: "ADP ner_production.json",
        };
      }
      return {
        id,
        name: metric.shortName,
        liveProvider: "adp",
        status: "fred_fallback",
        note: "ADP JSON missing series → FRED",
      };
    }

    if (live?.provider === "atlanta_gdpnow") {
      const pts = await fetchGdpNow();
      const tip = pts.at(-1);
      if (tip) {
        return {
          id,
          name: metric.shortName,
          liveProvider: "atlanta_gdpnow",
          status: "would_update_live",
          tipDate: tip.date,
          tipValue: tip.value,
          note: "Atlanta Fed GDPNow",
        };
      }
    }

    if (live?.provider === "ons" || metric.source === "ons") {
      if (id === "uk-ppi-input-yoy" || id === "uk-ppi-output-yoy") {
        try {
          const b = await fetchOnsPpiBulletin();
          const pt =
            id === "uk-ppi-input-yoy" ? b.inputYoy : b.outputYoy;
          if (pt) {
            return {
              id,
              name: metric.shortName,
              liveProvider: "ons",
              status: "would_update_live",
              tipDate: pt.date,
              tipValue: pt.value,
              note: "ONS PPI bulletin overlay",
            };
          }
        } catch {
          /* fall through to series */
        }
      }
      await new Promise((r) => setTimeout(r, 700));
      const raw = await fetchOnsSeries(live?.seriesId ?? metric.seriesId);
      const transformed = applyTransform(raw, metric.transform);
      const tip = transformed.at(-1);
      if (tip) {
        return {
          id,
          name: metric.shortName,
          liveProvider: "ons",
          status: "would_update_live",
          tipDate: tip.date,
          tipValue: round(tip.value),
          note: `ONS ${live?.seriesId ?? metric.seriesId}`,
        };
      }
    }

    if (live?.provider === "eurostat" || metric.source === "eurostat") {
      const raw = await fetchEurostatPreset(live?.seriesId ?? metric.seriesId);
      const transformed = applyTransform(raw, metric.transform);
      const tip = transformed.at(-1);
      if (tip) {
        return {
          id,
          name: metric.shortName,
          liveProvider: "eurostat",
          status: "would_update_live",
          tipDate: tip.date,
          tipValue: round(tip.value),
          note: `Eurostat ${live?.seriesId ?? metric.seriesId}`,
        };
      }
    }

    if (live?.provider === "bea") {
      if (!process.env.BEA_API_KEY) {
        return {
          id,
          name: metric.shortName,
          liveProvider: "bea",
          status: "fred_fallback",
          note: "BEA_API_KEY missing → FRED tip on refresh",
        };
      }
    }

    if (live?.provider === "dol") {
      return {
        id,
        name: metric.shortName,
        liveProvider: "dol",
        status: "fred_fallback",
        note: "DOL scrape flaky → FRED weekly tip if live fails",
      };
    }

    return {
      id,
      name: metric.shortName,
      liveProvider,
      status: "fred_fallback",
      note: "No LIVE_MAP / official probe → FRED recent tip merge",
    };
  } catch (err) {
    return {
      id,
      name: metric.shortName,
      liveProvider,
      status: "probe_failed",
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log("=== Release-day update simulation (dry-run, no DB writes) ===\n");

  // Mirror warmLiveCaches: one BLS batch + HTML fallbacks
  const blsIds = [
    ...new Set(
      Object.values(LIVE_MAP)
        .filter((v) => v.provider === "bls")
        .map((v) => v.seriesId)
    ),
  ];
  try {
    const map = await fetchBlsSeries(blsIds, {
      startYear: new Date().getFullYear() - 1,
    });
    (globalThis as unknown as { __blsCache?: typeof map }).__blsCache = map;
    console.log(`BLS API warm: ${map.size} series`);
  } catch (e) {
    console.warn("BLS API warm failed:", e instanceof Error ? e.message : e);
    (globalThis as unknown as { __blsCache?: Map<string, unknown> }).__blsCache =
      new Map();
  }
  try {
    const empsit = await fetchBlsEmpsitRelease();
    const cpi = await fetchBlsCpiRelease();
    (globalThis as unknown as {
      __blsHtml?: { empsit: typeof empsit; cpi: typeof cpi };
    }).__blsHtml = { empsit, cpi };
    console.log(
      `BLS HTML warm: NFP=${empsit.nfpChange?.value} U3=${empsit.unemployment?.value} CPI MoM=${cpi.cpiMom?.value}`
    );
  } catch (e) {
    console.warn("BLS HTML warm failed:", e instanceof Error ? e.message : e);
  }

  let rssMapped = 0;
  try {
    const feeds = await fetchReleaseFeeds();
    rssMapped = mapFeedItemsToMetrics(feeds).size;
    console.log(`RSS: ${feeds.length} items → ${rssMapped} metric doc links\n`);
  } catch (e) {
    console.warn("RSS probe skipped:", e instanceof Error ? e.message : e);
  }

  const events: EventResult[] = [];

  for (const ev of RELEASE_EVENTS) {
    console.log(`── ${ev.region} · ${ev.name}`);
    console.log(`   when: ${ev.typicalDay}`);
    console.log(`   via:  ${ev.provider}`);
    const metrics: MetricResult[] = [];
    for (const id of ev.metricIds) {
      const r = await probeMetric(id);
      metrics.push(r);
      const flag =
        r.status === "would_update_live"
          ? "LIVE"
          : r.status === "fred_fallback"
            ? "FRED"
            : "FAIL";
      const tip =
        r.tipDate != null
          ? `${r.tipDate} = ${r.tipValue}`
          : r.note ?? "";
      console.log(`   [${flag}] ${r.name.padEnd(18)} ${tip}`);
    }
    const liveHits = metrics.filter((m) => m.status === "would_update_live").length;
    const fallbacks = metrics.filter((m) => m.status === "fred_fallback").length;
    events.push({ ...ev, metrics, liveHits, fallbacks });
    console.log(`   → ${liveHits} live / ${fallbacks} FRED fallback / ${metrics.length} total\n`);
  }

  // Summary by region
  const summary = (["US", "UK", "EA"] as Region[]).map((region) => {
    const subset = events.filter((e) => e.region === region);
    const liveHits = subset.reduce((s, e) => s + e.liveHits, 0);
    const fallbacks = subset.reduce((s, e) => s + e.fallbacks, 0);
    const total = subset.reduce((s, e) => s + e.metrics.length, 0);
    return { region, releases: subset.length, liveHits, fallbacks, total };
  });

  console.log("=== By economy ===");
  for (const s of summary) {
    console.log(
      `${s.region}: ${s.releases} release events · ${s.liveHits}/${s.total} metrics would update live (${s.fallbacks} FRED)`
    );
  }

  const outPath = join(process.cwd(), "data", "release-sim.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rssMapped,
        summary,
        events,
        refreshFlow: [
          "1. npm run refresh (or scheduled cron)",
          "2. warmLiveCaches: RSS + BLS API + ADP JSON + DOL + GDPNow + ONS PPI bulletin",
          "3. For each metric: LIVE_MAP / official source first",
          "4. Merge tip into observations + write releases row (prior Δ, supporting doc from RSS)",
          "5. If live empty/fails → FRED recent tip (~36 pts) only",
        ],
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
