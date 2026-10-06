import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { metrics, observations } from "@/db/schema";
import { round } from "./transforms";

type Point = { date: string; value: number };
type Metric = {
  id: string; name: string; shortName: string; source: string;
  officialUrl: string; docsUrl: string;
  date: string | null; index: number | null; yoy: number | null; mom: number | null;
  history: Point[];
};

export const CPI_COMPONENTS = [
  ["us-cpi-food", "Food", "Headline"],
  ["us-cpi-energy", "Energy", "Headline"],
  ["us-core-goods-cpi-yoy", "Core CPI Goods", "Core Goods"],
  ["us-core-goods-cpi-mom", "Core CPI Goods MoM", "Core Goods"],
  ["us-services-cpi-yoy", "Core CPI Services", "Core Services"],
  ["us-services-cpi-mom", "Core CPI Services MoM", "Core Services"],
  ["us-cpi-apparel", "Apparel", "Core Goods"],
  ["us-cpi-new-vehicles", "New vehicles", "Core Goods"],
  ["us-cpi-used-cars", "Used cars & trucks", "Core Goods"],
  ["us-cpi-medical-commodities", "Medical care commodities", "Core Goods"],
  ["us-cpi-recreation-commodities", "Recreation commodities", "Core Goods"],
  ["us-cpi-education-commodities", "Education & communication commodities", "Core Goods"],
  ["us-cpi-other-goods", "Other goods", "Core Goods"],
  ["us-cpi-shelter", "Shelter", "Core Services"],
  ["us-cpi-medical-services", "Medical care services", "Core Services"],
  ["us-cpi-recreation-services", "Recreation services", "Core Services"],
  ["us-cpi-transport-services", "Transportation services", "Core Services"],
  ["us-cpi-education-services", "Education & communication services", "Core Services"],
  ["us-cpi-other-services", "Other services", "Core Services"],
] as const;

export const PCE_COMPONENTS = [
  ["us-pce-goods", "Goods", "Goods"],
  ["us-pce-durable-goods", "Durable goods", "Goods"],
  ["us-pce-furnishings", "Furnishings & durable household equipment", "Goods"],
  ["us-pce-clothing", "Clothing & footwear", "Goods"],
  ["us-pce-food", "Food & beverages", "Goods"],
  ["us-pce-energy", "Gasoline & other energy goods", "Goods"],
  ["us-pce-services", "Services", "Services"],
  ["us-pce-household-services", "Household services", "Services"],
  ["us-pce-healthcare", "Health care", "Services"],
  ["us-pce-food-services", "Food services & accommodations", "Services"],
  ["us-pce-housing", "Housing", "Services"],
] as const;

async function getHistory(id: string): Promise<Point[]> {
  const db = getDb();
  const rows = await db.select({ date: observations.date, value: observations.value })
    .from(observations).where(eq(observations.metricId, id))
    .orderBy(desc(observations.date)).limit(240);
  return rows.reverse().map((r) => ({ date: String(r.date), value: Number(r.value) }));
}

function calc(points: Point[]) {
  const cur = points.at(-1);
  const prev = points.at(-2);
  if (!cur) return { date: null, index: null, yoy: null, mom: null, history: [] as Point[] };
  const priorYear = points.find((p) => p.date === `${Number(cur.date.slice(0, 4)) - 1}${cur.date.slice(4)}`);
  return {
    date: cur.date,
    index: cur.value,
    yoy: priorYear ? round((cur.value / priorYear.value - 1) * 100, 3) : null,
    mom: prev ? round((cur.value / prev.value - 1) * 100, 3) : null,
    history: points.slice(-36),
  };
}

export async function getUsInflationDashboard() {
  const ids = [
    "us-cpi", "us-cpi-core", "us-cpi-nsa", "us-cpi-core-nsa",
    "us-pce", "us-core-pce",
    ...CPI_COMPONENTS.map((x) => x[0]),
    ...PCE_COMPONENTS.map((x) => x[0]),
  ];

  const db = getDb();
  const metas = await db.select().from(metrics);
  const meta = new Map(metas.filter((m) => ids.includes(m.id)).map((m) => [m.id, m]));
  const values = new Map<string, ReturnType<typeof calc>>();
  for (const id of ids) values.set(id, calc(await getHistory(id)));

  const make = (id: string): Metric | null => {
    const m = meta.get(id), d = values.get(id);
    if (!m || !d) return null;
    return {
      id, name: m.name, shortName: m.shortName, source: m.source,
      officialUrl: m.officialUrl, docsUrl: m.docsUrl,
      date: d.date, index: d.index, yoy: d.yoy, mom: d.mom, history: d.history,
    };
  };

  const components = (rows: readonly (readonly [string, string, string])[]) =>
    rows.map(([id, name, branch]) => ({ id, name, branch, metric: make(id) }))
      .filter((x): x is { id: string; name: string; branch: string; metric: Metric } => Boolean(x.metric));

  const cpiHeadline = make("us-cpi");
  const cpiCore = make("us-cpi-core");
  const cpiHeadlineNsa = make("us-cpi-nsa");
  const cpiCoreNsa = make("us-cpi-core-nsa");

  if (cpiHeadline && cpiHeadlineNsa) cpiHeadline.yoy = cpiHeadlineNsa.yoy;
  if (cpiCore && cpiCoreNsa) cpiCore.yoy = cpiCoreNsa.yoy;

  return {
    asOf: values.get("us-cpi")?.date ?? values.get("us-pce")?.date ?? null,
    cpi: {
      headline: cpiHeadline,
      core: cpiCore,
      headlineNsa: cpiHeadlineNsa,
      coreNsa: cpiCoreNsa,
      components: components(CPI_COMPONENTS),
    },
    pce: {
      headline: make("us-pce"),
      core: make("us-core-pce"),
      components: components(PCE_COMPONENTS),
    },
  };
}
