import type { RawPoint } from "./transforms";

export function parseOnsCsv(text: string, monthlyOnly = false): RawPoint[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const points: RawPoint[] = [];
  let inData = false;

  for (const line of lines) {
    const match = line.match(/^\"?(\d{4}(?:\s+[A-Z]{3}|\s+Q[1-4])?)\"?\s*,\s*\"?(-?[\d.]+)\"?/i);
    if (!match) {
      if (/^\"?Date\"?/i.test(line) || /^\"?CDID\"?/i.test(line)) inData = true;
      continue;
    }
    inData = true;
    const period = match[1].replace(/\"/g, "").trim();
    if (monthlyOnly && !/^\d{4}\s+[A-Z]{3}$/i.test(period)) continue;
    const date = onsDate(period);
    const value = Number(match[2]);
    if (date && Number.isFinite(value)) points.push({ date, value });
  }

  if (!inData && points.length === 0) {
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 2) continue;
      const period = parts[0].replace(/\"/g, "").trim();
      if (monthlyOnly && !/^\d{4}\s+[A-Z]{3}$/i.test(period)) continue;
      const date = onsDate(period);
      const value = Number(parts[1].replace(/\"/g, "").trim());
      if (date && Number.isFinite(value)) points.push({ date, value });
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function onsDate(period: string): string | null {
  const monthMatch = period.match(/^(\d{4})\s+([A-Z]{3})$/i);
  if (monthMatch) {
    const month = monthNum(monthMatch[2]);
    if (!month) return null;
    return `${monthMatch[1]}-${month}-01`;
  }
  const quarterMatch = period.match(/^(\d{4})\s+Q([1-4])$/i);
  if (quarterMatch) {
    const month = String((Number(quarterMatch[2]) - 1) * 3 + 1).padStart(2, "0");
    return `${quarterMatch[1]}-${month}-01`;
  }
  if (/^\d{4}$/.test(period)) return `${period}-01-01`;
  if (/^\d{4}-\d{2}/.test(period)) return period.slice(0, 10);
  return null;
}

function monthNum(month: string): string | null {
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  return months[month.toUpperCase()] ?? null;
}
