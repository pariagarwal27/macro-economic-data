import type { RawPoint } from "./transforms";
import AdmZip from "adm-zip";

/**
 * Live ADP National Employment Report via the site's production JSON feed
 * (same payload the SPA loads — available at release time, not via FRED).
 */
export async function fetchAdpNational(): Promise<{
  level: RawPoint[];
  change: RawPoint[];
  meta?: { month: string; year: string; title: string };
}> {
  const bases = [
    "https://adpemploymentreport.com",
    // CloudFront deploys sometimes serve from origin host
  ];

  let json: AdpReport | null = null;
  let lastErr = "";
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/ner_production.json`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) {
        lastErr = `ADP JSON ${res.status}`;
        continue;
      }
      json = (await res.json()) as AdpReport;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  if (!json) throw new Error(lastErr || "ADP ner_production.json failed");

  const change: RawPoint[] = [];
  const level: RawPoint[] = [];

  const month = json.reportMonth || pickMonth(json.reportOverview?.cards?.[0]?.title);
  const year = String(json.reportYear ?? "");
  const date = month && year ? monthYearToDate(month, year) : null;

  const card = json.reportOverview?.cards?.find((c) =>
    /employment change|change in/i.test(`${c.metricName} ${c.description}`)
  ) ?? json.reportOverview?.cards?.[0];

  if (card && date) {
    const raw = Number(String(card.metricValue).replace(/,/g, ""));
    if (Number.isFinite(raw)) {
      // metricValue is already in jobs (e.g. 44000) — store as thousands for catalog unit
      const thousands = Math.abs(raw) >= 1000 ? raw / 1000 : raw;
      const signed =
        card.metricDirection === "down" && thousands > 0 ? -thousands : thousands;
      change.push({ date, value: signed });
    }
  }

  // Chart subsections may include historical series JSON files
  const histUrls =
    json.chartSections?.[0]?.chartSubsections
      ?.map((s) => s.jsonFile)
      .filter(Boolean) ?? [];

  // ADP's official history archive contains the national monthly seasonally
  // adjusted employment level. Use it for a long backfill and derive monthly
  // changes from adjacent monthly observations.
  const historyZipUrl = json.chartSections?.[0]?.chartSubsections
    ?.find((section) => section.tab_title === "National")?.downloadLink;
  if (historyZipUrl) {
    try {
      const response = await fetch(historyZipUrl, {
        headers: { Accept: "application/zip,application/octet-stream,*/*", "User-Agent": "Mozilla/5.0 MacroHub/1.0" },
      });
      if (!response.ok) throw new Error(`ADP history archive HTTP ${response.status}`);
      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
      const csvEntry = zip.getEntries().find(entry => /ADP_NER_history\.csv$/i.test(entry.entryName));
      if (!csvEntry) throw new Error("ADP history archive has no national CSV");
      const parsed = parseAdpNationalArchive(csvEntry.getData().toString("utf8"));
      if (parsed.level.length >= 2) {
        level.splice(0, level.length, ...parsed.level);
        change.splice(0, change.length, ...parsed.change);
      }
    } catch (err) {
      console.warn("ADP official history archive unavailable:", err instanceof Error ? err.message : String(err));
    }
  }

  if (date && card) {
    const raw = Number(String(card.metricValue).replace(/,/g, ""));
    if (Number.isFinite(raw)) {
      const thousands = Math.abs(raw) >= 1000 ? raw / 1000 : raw;
      const value = card.metricDirection === "down" && thousands > 0 ? -thousands : thousands;
      const current = change.find(point => point.date === date);
      if (current) current.value = value;
      else change.push({ date, value });
    }
  }

  for (const rel of histUrls.slice(0, 3)) {
    try {
      const url = rel!.startsWith("http")
        ? rel!
        : `https://adpemploymentreport.com/${rel!.replace(/^\//, "")}`;
      const hist = await (
        await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "macro-economy-tracker/1.0" },
        })
      ).json();
      const parsed = parseAdpHistory(hist);
      for (const p of parsed.change) {
        if (!change.some((c) => c.date === p.date)) change.push(p);
      }
      for (const p of parsed.level) {
        if (!level.some((c) => c.date === p.date)) level.push(p);
      }
    } catch {
      // optional history
    }
  }

  if (!change.length) {
    throw new Error("ADP JSON missing employment change card");
  }

  return {
    level: level.sort((a, b) => a.date.localeCompare(b.date)),
    change: change.sort((a, b) => a.date.localeCompare(b.date)),
    meta: {
      month: month ?? "",
      year,
      title: json.reportOverview?.title ?? "",
    },
  };
}

interface AdpReport {
  reportMonth?: string;
  reportYear?: number | string;
  reportOverview?: {
    title?: string;
    cards?: Array<{
      title?: string;
      description?: string;
      metricName?: string;
      metricValue?: string;
      metricDirection?: string;
    }>;
  };
  chartSections?: Array<{
    chartSubsections?: Array<{ jsonFile?: string; tab_title?: string; downloadLink?: string }>;
  }>;
}

function parseAdpHistory(hist: unknown): { level: RawPoint[]; change: RawPoint[] } {
  const level: RawPoint[] = [];
  const change: RawPoint[] = [];
  const rows = Array.isArray(hist)
    ? hist
    : Array.isArray((hist as { data?: unknown[] }).data)
      ? ((hist as { data: unknown[] }).data as unknown[])
      : Array.isArray((hist as { series?: unknown[] }).series)
        ? ((hist as { series: unknown[] }).series as unknown[])
        : [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date =
      monthYearToDate(String(r.month ?? r.period ?? ""), String(r.year ?? "")) ??
      (typeof r.date === "string" && /^\d{4}-\d{2}/.test(r.date)
        ? r.date.slice(0, 10)
        : null);
    if (!date) continue;
    const chg = Number(String(r.change ?? r.metricValue ?? r.value ?? "").replace(/,/g, ""));
    const lvl = Number(String(r.level ?? r.employment ?? "").replace(/,/g, ""));
    if (Number.isFinite(chg)) {
      change.push({
        date,
        value: Math.abs(chg) >= 1000 ? chg / 1000 : chg,
      });
    }
    if (Number.isFinite(lvl)) {
      level.push({
        date,
        value: lvl > 1_000_000 ? lvl / 1000 : lvl,
      });
    }
  }
  return { level, change };
}

function parseAdpNationalArchive(csv: string): { level: RawPoint[]; change: RawPoint[] } {
  const levels = csv.split(/\r?\n/).flatMap(line => {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]!;
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) { fields.push(field); field = ""; }
      else field += char;
    }
    fields.push(field);
    if (fields[0] !== "M" || fields[1] !== "National" || fields[2] !== "U.S." || !/^\d{4}-\d{2}-\d{2}$/.test(fields[3] ?? "")) return [];
    const seasonallyAdjusted = Number(fields[5]);
    return Number.isFinite(seasonallyAdjusted)
      ? [{ date: fields[3]!, value: seasonallyAdjusted / 1000 }]
      : [];
  }).sort((a, b) => a.date.localeCompare(b.date));

  const changes: RawPoint[] = [];
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    const previousDate = new Date(`${previous.date.slice(0, 7)}-01T00:00:00Z`);
    const currentDate = new Date(`${current.date.slice(0, 7)}-01T00:00:00Z`);
    const monthGap = (currentDate.getUTCFullYear() - previousDate.getUTCFullYear()) * 12 + currentDate.getUTCMonth() - previousDate.getUTCMonth();
    if (monthGap === 1) changes.push({ date: current.date, value: Number((current.value - previous.value).toFixed(3)) });
  }
  return { level: levels, change: changes };
}

function pickMonth(title?: string): string | undefined {
  if (!title) return undefined;
  const m = title.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i
  );
  return m?.[1];
}

function monthYearToDate(month: string, year: string): string | null {
  if (!month || !year) return null;
  const map: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  // month may already be "07" or "July"
  if (/^\d{1,2}$/.test(month)) {
    return `${year}-${month.padStart(2, "0")}-01`;
  }
  const mm = map[month.toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-01`;
}
