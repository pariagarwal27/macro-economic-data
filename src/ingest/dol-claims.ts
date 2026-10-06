import { getD1Database } from "@/db";
import type { RawPoint } from "./transforms";


/**
 * DOL ETA Unemployment Insurance Weekly Claims.
 *
 * Uses the official DOL PDF first, then the DOL claims HTML page.
 */
export async function fetchDolClaims(): Promise<{
  initial: RawPoint[];
  continuing: RawPoint[];
}> {
  if (getD1Database()) return fromHtml();
  try {
    return await fromPdf();
  } catch (pdfErr) {
    console.warn("[dol] PDF parse failed:", pdfErr);
  }

  return fromHtml();
}

async function fromPdf(): Promise<{
  initial: RawPoint[];
  continuing: RawPoint[];
}> {
  const packageName = process.env.LOCAL_PDF_MODULE ?? "pdf-parse";
  const { PDFParse } = await import(/* webpackIgnore: true */ packageName) as typeof import("pdf-parse");
  const { getPath } = await import(/* webpackIgnore: true */ `${packageName}/worker`) as typeof import("pdf-parse/worker");
  PDFParse.setWorker(getPath());
  const res = await fetch("https://www.dol.gov/ui/data.pdf", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
      Accept: "application/pdf",
    },
  });

  if (!res.ok) {
    throw new Error(`DOL PDF ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  const parser = new PDFParse({
    data: buf,
  });

  const result = await parser.getText();
  const text = result.text.replace(/\s+/g, " ").trim();

  await parser.destroy();

  if (!text) {
    throw new Error("DOL PDF: extracted text is empty");
  }

  /*
   * Initial claims and continuing claims refer to different
   * week-ending dates in the DOL release.
   */
  const initial = extractInitialClaimsRelease(text);
  const continuing = extractContinuingClaimsRelease(text);

  if (!initial) {
    throw new Error("DOL PDF: no initial claims figure");
  }

  return {
    initial: [
      {
        date: initial.date,
        value: initial.value,
      },
    ],

    continuing: continuing
      ? [
          {
            date: continuing.date,
            value: continuing.value,
          },
        ]
      : [],
  };
}

function extractInitialClaimsRelease(
  text: string
): { date: string; value: number } | null {
  /*
   * DOL release wording:
   *
   * "In the week ending September 26, the advance figure for
   * seasonally adjusted initial claims was 197,000..."
   *
   * Keep the date tied specifically to the initial-claims sentence.
   */
  const patterns = [
    /in\s+the\s+week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?),\s*the\s+advance\s+figure\s+for\s+seasonally\s+adjusted\s+initial\s+claims\s+was\s+([0-9,]+)/i,

    /week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)[^.!?]{0,180}?advance\s+(?:figure\s+for\s+)?seasonally\s+adjusted\s+initial\s+claims\s+(?:was\s+)?([0-9,]+)/i,

    /week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)[^.!?]{0,180}?initial\s+claims\s+(?:was|were)\s+([0-9,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const date = parseDolDate(match[1]);
    const value = Number(match[2].replace(/,/g, ""));

    if (date && Number.isFinite(value) && value >= 1000) {
      return { date, value };
    }
  }

  return null;
}

function extractContinuingClaimsRelease(
  text: string
): { date: string; value: number } | null {
  /*
   * DOL release wording:
   *
   * "The advance seasonally adjusted insured unemployment rate was
   * ... for the week ending September 19..."
   *
   * followed by:
   *
   * "the advance number for seasonally adjusted insured unemployment
   * during the week ending September 19 was 1,701,000..."
   */
  const patterns = [
    /advance\s+number\s+for\s+seasonally\s+adjusted\s+insured\s+unemployment\s+during\s+the\s+week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)\s+was\s+([0-9,]+)/i,

    /seasonally\s+adjusted\s+insured\s+unemployment\s+during\s+the\s+week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)[^.!?]{0,120}?([0-9,]{3,})/i,

    /insured\s+unemployment\s+(?:during\s+)?the\s+week\s+ending\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)[^.!?]{0,120}?([0-9,]{3,})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const date = parseDolDate(match[1]);
    const value = Number(match[2].replace(/,/g, ""));

    if (date && Number.isFinite(value) && value >= 1000) {
      return { date, value };
    }
  }

  return null;
}

function parseDolDate(value: string): string | null {
  /*
   * The DOL text sometimes omits the year because the surrounding
   * release already establishes the current year.
   */
  const normalized = value.includes(",")
    ? value
    : `${value}, ${new Date().getUTCFullYear()}`;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

async function fromHtml(): Promise<{
  initial: RawPoint[];
  continuing: RawPoint[];
}> {
  const claims = await fetch(
    "https://oui.doleta.gov/unemploy/claims.asp",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
        Accept: "text/html",
      },
    }
  );

  if (!claims.ok) {
    throw new Error(`DOL claims HTML ${claims.status}`);
  }

  const text = (await claims.text())
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  const match = text.match(
    /week(?:\s+ending|\s+ended)?\s+([A-Za-z]+\s+\d{1,2}(?:,\s*20\d{2})?)[^.!?]{0,160}?Initial Claims[^0-9]{0,80}([0-9,]{3,})/i
  );

  if (!match) {
    throw new Error(
      "DOL claims HTML has no latest initial claims print"
    );
  }

  const date = parseDolDate(match[1]);
  const value = Number(match[2].replace(/,/g, ""));

  if (!date) {
    throw new Error("DOL claims HTML has invalid week ending date");
  }

  if (!Number.isFinite(value) || value < 1000) {
    throw new Error("DOL claims HTML has invalid initial claims value");
  }

  return {
    initial: [
      {
        date,
        value,
      },
    ],
    continuing: [],
  };
}
