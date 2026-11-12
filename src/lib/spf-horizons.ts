export const SPF_HORIZONS = [
  { id: "current", label: "Current year", offset: 0 },
  { id: "next", label: "Next year", offset: 1 },
  { id: "two-years", label: "Two years ahead", offset: 2 },
  { id: "lt", label: "Long term", offset: "long-term" },
] as const;

export function spfForecastTarget(date: string, offset: number | "long-term") {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return year + (offset === "long-term" ? month >= 7 ? 5 : 4 : offset);
}

export function spfSurveyLabel(date: string, offset: number | "long-term") {
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  return `Survey Q${quarter} ${date.slice(0, 4)} · forecast for ${spfForecastTarget(date, offset)}`;
}
