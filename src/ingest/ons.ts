import type { RawPoint } from "./transforms";
import {
  fetchOnsPayeEmploymentChange,
  fetchOnsPayeEmploymentLevel,
  fetchOnsPayeMedianPayLevel,
} from "./ons-paye-rti";
import { fetchUkLabourMarketBulletinUe } from "./ons-labour-bulletin";
import { fetchOnsJobOpeningsRate } from "./ons-vacs02";

/**
 * ONS public CSV generator — more reliable than the legacy JSON API.
 * Example:
 * https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/d7g7/mm23
 */
const GENERATOR = "https://www.ons.gov.uk/generator";

const SERIES_URI: Record<string, string> = {
  D7G7: "/economy/inflationandpriceindices/timeseries/d7g7/mm23", // CPI annual rate
  D7OE: "/economy/inflationandpriceindices/timeseries/d7oe/mm23", // CPI monthly rate
  D7G8: "/economy/inflationandpriceindices/timeseries/d7g8/mm23", // food annual
  D7GT: "/economy/inflationandpriceindices/timeseries/d7gt/mm23", // electricity/gas/fuels annual
  D7GB: "/economy/inflationandpriceindices/timeseries/d7gb/mm23",
    // UK CPI division-level annual rates
  D7G9: "/economy/inflationandpriceindices/timeseries/d7g9/mm23", // alcohol & tobacco
  D7GA: "/economy/inflationandpriceindices/timeseries/d7ga/mm23", // clothing & footwear
  D7GC: "/economy/inflationandpriceindices/timeseries/d7gc/mm23", // furniture & household goods
  D7GD: "/economy/inflationandpriceindices/timeseries/d7gd/mm23", // health
  D7GE: "/economy/inflationandpriceindices/timeseries/d7ge/mm23", // transport
  D7GF: "/economy/inflationandpriceindices/timeseries/d7gf/mm23", // communication
  D7GG: "/economy/inflationandpriceindices/timeseries/d7gg/mm23", // recreation & culture
  D7GH: "/economy/inflationandpriceindices/timeseries/d7gh/mm23", // education
  D7GI: "/economy/inflationandpriceindices/timeseries/d7gi/mm23", // restaurants & hotels
  D7GJ: "/economy/inflationandpriceindices/timeseries/d7gj/mm23", // miscellaneous goods & services

  // UK CPIH division-level annual rates
  L55Q: "/economy/inflationandpriceindices/timeseries/l55q/mm23", // alcohol & tobacco
  L55R: "/economy/inflationandpriceindices/timeseries/l55r/mm23", // clothing & footwear
  L55T: "/economy/inflationandpriceindices/timeseries/l55t/mm23", // furniture & household goods
  L55U: "/economy/inflationandpriceindices/timeseries/l55u/mm23", // health
  L55V: "/economy/inflationandpriceindices/timeseries/l55v/mm23", // transport
  L55W: "/economy/inflationandpriceindices/timeseries/l55w/mm23", // communication
  L55X: "/economy/inflationandpriceindices/timeseries/l55x/mm23", // recreation & culture
  L55Y: "/economy/inflationandpriceindices/timeseries/l55y/mm23", // education
  L55Z: "/economy/inflationandpriceindices/timeseries/l55z/mm23", // restaurants & hotels
  L562: "/economy/inflationandpriceindices/timeseries/l562/mm23", // miscellaneous goods & services // housing/water/fuels annual
  L55O: "/economy/inflationandpriceindices/timeseries/l55o/mm23", // CPIH annual rate
  CZBH: "/economy/inflationandpriceindices/timeseries/czbh/mm23", // RPI annual rate
  DKC7: "/economy/inflationandpriceindices/timeseries/dkc7/mm23", // CPI ex energy & unprocessed food index
  DKO8: "/economy/inflationandpriceindices/timeseries/dko8/mm23", // CPI core 12m % (ex energy/food/alcohol/tobacco)
  DKC6: "/economy/inflationandpriceindices/timeseries/dkc6/mm23", // CPI core index (for MoM)
  D7NN: "/economy/inflationandpriceindices/timeseries/d7nn/mm23", // CPI services annual
  D7MV: "/economy/inflationandpriceindices/timeseries/d7mv/mm23", // CPI services monthly
  D7NM: "/economy/inflationandpriceindices/timeseries/d7nm/mm23", // CPI goods annual
  D7MU: "/economy/inflationandpriceindices/timeseries/d7mu/mm23",
  KG7P: "/economy/grossdomesticproductgdp/timeseries/kg7p/pn2",
 KG7S: "/economy/grossdomesticproductgdp/timeseries/kg7s/pn2", // CPI goods monthly
  GHIP: "/economy/inflationandpriceindices/timeseries/ghip/ppi", // input PPI index (live)
  GB7S: "/economy/inflationandpriceindices/timeseries/gb7s/ppi", // output PPI index (live; mm22 path is lagged)
  JVZ7: "/economy/inflationandpriceindices/timeseries/jvz7/ppi",
  ZZ65: "/economy/grossdomesticproductgdp/timeseries/zz65/pn2", // legacy output index
  AP2Y: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/ap2y/unem",
  AP2Z: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/ap2z/unem", // vacancies per 100 employee jobs (ONS legacy LMS rate series)
  BCAJ: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/bcaj/lms", // employee jobs, total, thousands, SA
  LF2M: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf2m/lms", // inactive persons, ages 16-64, thousands, SA
  LF2S: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf2s/lms", // inactivity rate, ages 16-64, percent, SA
  FV28: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/fv28/lms", // inactivity level annual change, ages 16-64, thousands, SA
  LF63: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf63/lms", // inactivity: students, thousands, SA
  LF65: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf65/lms", // inactivity: family/home, thousands, SA
  LF67: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf67/lms", // inactivity: temporary sickness, thousands, SA
  LF69: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf69/lms", // inactivity: long-term sickness, thousands, SA
  LFL8: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/lfl8/lms", // inactivity: discouraged workers, thousands, SA
  LF6B: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf6b/lms", // inactivity: retired, thousands, SA
  LF6D: "/employmentandlabourmarket/peoplenotinwork/economicinactivity/timeseries/lf6d/lms", // inactivity: other reasons, thousands, SA
  N4JE: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/n4je/lms", // job openings rate
  A3WW: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/a3ww/lms", // real total pay growth, CPIH-adjusted, 3m average YoY
  A2FA: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/a2fa/lms", // real regular pay growth, CPIH-adjusted, 3m average YoY
  KAC3: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kac3/lms", // total pay 3m YoY %
  KAB9: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kab9/lms",
  KAI7: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kai7/lms", // regular pay level £ SA
  KAI8: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kai8/lms", // regular pay 1m YoY %
  KAI9: "/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kai9/lms", // regular pay 3m YoY %
  MGSX: "/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms",
  MGSC: "/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsc/unem", // unemployed persons aged 16+, thousands, SA
  YBWH: "/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/ybwh/lms", // unemployed over 12 months aged 16+, thousands, SA
  MGRZ: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/mgrz/lms",
  NMRY: "/economy/grossdomesticproductgdp/timeseries/nmry/pn2",
  DIOP: "/economy/economicoutputandproductivity/output/timeseries/diop/diop",
  K222: "/economy/economicoutputandproductivity/output/timeseries/k222/diop", // IoP total B-E CVMSA
  EAPT: "/businessindustryandtrade/retailindustry/timeseries/eapt/drsi",
  EAPV: "/businessindustryandtrade/retailindustry/timeseries/eapv/drsi",
  J5DZ: "/businessindustryandtrade/retailindustry/timeseries/j5dz/drsi",
  JO5A: "/businessindustryandtrade/retailindustry/timeseries/jo5a/drsi",
  J5EK: "/businessindustryandtrade/retailindustry/timeseries/j5ek/drsi",
  J5EC: "/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi",
  ECY4: "/economy/grossdomesticproductgdp/timeseries/ecy4/mgdp",
  ED3C: "/economy/grossdomesticproductgdp/timeseries/ed3c/mgdp",
  ECYX: "/economy/grossdomesticproductgdp/timeseries/ecyx/mgdp", // monthly GDP MoM %
  ECY2: "/economy/grossdomesticproductgdp/timeseries/ecy2/mgdp", // monthly GDP index
  ED9T: "/economy/grossdomesticproductgdp/timeseries/ed9t/mgdp", // monthly GDP 3m/3m YoY %
  L2KQ: "/economy/grossdomesticproductgdp/timeseries/l2kq/pn2",
  ABMI: "/economy/grossdomesticproductgdp/timeseries/abmi/qna",
  // Official growth rates from GDP first quarterly estimate (PN2) — not levels
  IHYR: "/economy/grossdomesticproductgdp/timeseries/ihyr/pn2", // q-on-q4 YoY %
  IHYQ: "/economy/grossdomesticproductgdp/timeseries/ihyq/qna", // QoQ %, latest quarterly national accounts
  L59C: "/economy/inflationandpriceindices/timeseries/l59c/mm23", // CPIH monthly rate
  L5LQ: "/economy/inflationandpriceindices/timeseries/l5lq/mm23", // core CPIH annual rate
  L55P: "/economy/inflationandpriceindices/timeseries/l55p/mm23", // CPIH food annual rate
  L59D: "/economy/inflationandpriceindices/timeseries/l59d/mm23", // CPIH food monthly rate
  L55S: "/economy/inflationandpriceindices/timeseries/l55s/mm23", // CPIH housing annual rate
  L5PG: "/economy/inflationandpriceindices/timeseries/l5pg/mm23", // CPIH housing index
   A24M: "/economy/grossdomesticproductgdp/timeseries/a24m/qna", // household consumption QoQ growth
  NPQT: "/economy/grossdomesticproductgdp/timeseries/npqt/qna",
ABJR: "/economy/nationalaccounts/satelliteaccounts/timeseries/abjr/pn2",

 KG7T: "/economy/grossdomesticproductgdp/timeseries/kg7t/qna",
KG7Q: "/economy/grossdomesticproductgdp/timeseries/kg7q/qna",
  ZZ5U: "/economy/grossdomesticproductgdp/timeseries/zz5u/pn2",
  ZZ6D: "/economy/grossdomesticproductgdp/timeseries/zz6d/pn2", // real GFCF CVM SA
  NPEK: "/economy/grossdomesticproductgdp/timeseries/npek/qna", // business investment
  NMRP: "/economy/grossdomesticproductgdp/timeseries/nmrp/qna", // government final consumption
  MGSR: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/mgsr/lms", // employment rate SA
  I46G: "/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/i46g/lms", // inactivity rate
};

export async function fetchOnsSeries(seriesId: string): Promise<RawPoint[]> {
  if (seriesId === "N4JE") return fetchOnsJobOpeningsRate();

  if (seriesId === "PAYE_EMP_LEVEL") {
  return fetchOnsPayeEmploymentLevel();
}

if (seriesId === "PAYE_EMP_CHANGE") {
  return fetchOnsPayeEmploymentChange();
}
  if (seriesId === "PAYE_MEDIAN_PAY") {
    return fetchOnsPayeMedianPayLevel();
  }

  const uri = SERIES_URI[seriesId];
  if (!uri) throw new Error(`No ONS URI mapping for ${seriesId}`);

  const points = await fetchOnsCsvSeries(uri, seriesId);
  if (seriesId === "MGSX") {
    return mergeUkUnemploymentBulletin(points);
  }
  return points;
}

async function fetchOnsCsvSeries(uri: string, seriesId: string): Promise<RawPoint[]> {
  const url = `${GENERATOR}?format=csv&uri=${encodeURIComponent(uri)}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
    const res = await fetch(url, {
      headers: {
        Accept: "text/csv",
        "User-Agent": "macro-economy-tracker/1.0",
      },
    });
    if (res.status === 429) {
      lastErr = new Error(`ONS 429 for ${seriesId}`);
      continue;
    }
    if (!res.ok) throw new Error(`ONS ${res.status} for ${seriesId}`);
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      throw new Error(`ONS returned HTML for ${seriesId}`);
    }
    return parseOnsCsv(text);
  }
  throw lastErr ?? new Error(`ONS failed for ${seriesId}`);
}

async function mergeUkUnemploymentBulletin(points: RawPoint[]): Promise<RawPoint[]> {
  try {
    const headline = await fetchUkLabourMarketBulletinUe();
    if (!headline) return dedupeOnsPoints(points);
    const map = new Map(points.map((p) => [p.date, p]));
    const latest = [...map.keys()].sort().at(-1);
    if (!latest || headline.date >= latest) {
      map.set(headline.date, headline);
    }
    return dedupeOnsPoints([...map.values()]);
  } catch {
    return dedupeOnsPoints(points);
  }
}

function dedupeOnsPoints(points: RawPoint[]): RawPoint[] {
  const map = new Map<string, RawPoint>();
  for (const p of points) map.set(p.date, p);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function parseOnsCsv(text: string): RawPoint[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points: RawPoint[] = [];
  let inData = false;

  for (const line of lines) {
    // Skip metadata preamble until we hit a date-like row
    const m = line.match(/^"?(\d{4}(?:\s+[A-Z]{3}|\s+Q[1-4])?)"?\s*,\s*"?(-?[\d.]+)"?/i);
    if (!m) {
      if (/^"?Date"?/i.test(line) || /^"?CDID"?/i.test(line)) inData = true;
      continue;
    }
    inData = true;
    const date = onsDate(m[1]);
    const value = Number(m[2]);
    if (!date || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }

  if (!inData && points.length === 0) {
    // Alternate: simple two-column CSV with header
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 2) continue;
      const date = onsDate(parts[0].replace(/"/g, "").trim());
      const value = Number(parts[1].replace(/"/g, "").trim());
      if (!date || !Number.isFinite(value)) continue;
      points.push({ date, value });
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function onsDate(d: string): string | null {
  const cleaned = d.replace(/"/g, "").trim();
  const m = cleaned.match(/^(\d{4})\s+([A-Z]{3})$/i);
  if (m) {
    const month = monthNum(m[2]);
    if (!month) return null;
    return `${m[1]}-${month}-01`;
  }
  const q = cleaned.match(/^(\d{4})\s+Q([1-4])$/i);
  if (q) {
    const month = String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0");
    return `${q[1]}-${month}-01`;
  }
  if (/^\d{4}$/.test(cleaned)) return `${cleaned}-01-01`;
  if (/^\d{4}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10);
  return null;
}

function monthNum(mon: string): string | null {
  const map: Record<string, string> = {
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12",
  };
  return map[mon.toUpperCase()] ?? null;
}
