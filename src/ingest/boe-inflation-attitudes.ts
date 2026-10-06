import type { RawPoint } from "./transforms";

const SITEMAP =
  "https://www.bankofengland.co.uk/sitemap/inflation-attitudes-survey";

export type BoeIasQuestion = "1y" | "2y" | "5y";

const QUESTION_PATTERNS: Record<BoeIasQuestion, RegExp[]> = {
  "1y": [/question\s*2a[\s\S]{0,900}?(?:median[^%]{0,160}?|answer[^%]{0,160}?)([0-9]+(?:\.[0-9]+)?)\s*%/i],
  "2y": [/question\s*2b[\s\S]{0,900}?(?:median[^%]{0,160}?|answer[^%]{0,160}?)([0-9]+(?:\.[0-9]+)?)\s*%/i],
  "5y": [/question\s*2c[\s\S]{0,900}?(?:median[^%]{0,160}?|answer[^%]{0,160}?)([0-9]+(?:\.[0-9]+)?)\s*%/i],
};

export async function fetchBoeInflationExpectations1y(): Promise<RawPoint[]> {
  return fetchBoeInflationExpectations("1y");
}

export async function fetchBoeInflationExpectations(
  question: BoeIasQuestion
): Promise<RawPoint[]> {
  const res = await fetch(SITEMAP, {
    headers: {
      "User-Agent": "macro-economy-tracker/1.0",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`BoE IAS sitemap ${res.status}`);

  const html = await res.text();
  const urls = [
    ...html.matchAll(
      /href="(https:\/\/www\.bankofengland\.co\.uk\/inflation-attitudes-survey\/\d{4}\/[^\"]+)"/gi
    ),
    ...html.matchAll(
      /href="(\/inflation-attitudes-survey\/\d{4}\/[^\"]+)"/gi
    ),
  ]
    .map((m) => (m[1]!.startsWith("http") ? m[1]! : `https://www.bankofengland.co.uk${m[1]!}`))
    .filter((u) => !u.endsWith(".pdf") && !u.endsWith(".xlsx"));

  const unique = [...new Set(urls)].sort().slice(-60);
  const points: RawPoint[] = [];
  const pattern = QUESTION_PATTERNS[question];

  for (const url of unique) {
    try {
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": "macro-economy-tracker/1.0",
          Accept: "text/html",
        },
      });
      if (!pageRes.ok) continue;
      const page = await pageRes.text();
      const date = parseSurveyDate(page, url);
      if (!date) continue;

      const text = page
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ");
      let match: RegExpMatchArray | null = null;
      for (const candidate of pattern) { match = text.match(candidate); if (match) break; }
      if (!match) continue;

      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      points.push({ date, value });
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      // Skip an individual survey vintage.
    }
  }

  const byDate = new Map<string, number>();
  for (const p of points.sort((a, b) => a.date.localeCompare(b.date))) {
    byDate.set(p.date, p.value);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

function parseSurveyDate(html: string, url: string): string | null {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  const text = `${title} ${url}`;
  const m = text.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)[ -](\d{4})/i
  );
  if (!m) return null;
  const month = monthNum(m[1]!);
  return month ? `${m[2]}-${month}-01` : null;
}

function monthNum(name: string): string | null {
  const m: Record<string, string> = {
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
  return m[name.toLowerCase()] ?? null;
}
