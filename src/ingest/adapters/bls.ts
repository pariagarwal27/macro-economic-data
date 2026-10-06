const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data";

type BlsObservation = {
  year: string;
  period: string;
  periodName: string;
  value: string;
  footnotes?: { code?: string; text?: string }[];
};

type BlsResponse = {
  status: string;
  Results?: { series?: { seriesID: string; data: BlsObservation[] }[] };
};

function periodToDate(year: string, period: string) {
  if (period === "M01") return `${year}-01-01`;
  if (period === "M02") return `${year}-02-01`;
  if (period === "M03") return `${year}-03-01`;
  if (period === "M04") return `${year}-04-01`;
  if (period === "M05") return `${year}-05-01`;
  if (period === "M06") return `${year}-06-01`;
  if (period === "M07") return `${year}-07-01`;
  if (period === "M08") return `${year}-08-01`;
  if (period === "M09") return `${year}-09-01`;
  if (period === "M10") return `${year}-10-01`;
  if (period === "M11") return `${year}-11-01`;
  if (period === "M12") return `${year}-12-01`;
  if (period === "M13") return `${year}-12-01`;
  return `${year}-01-01`;
}

export async function fetchBlsLatest(
  seriesId: string,
  signal?: AbortSignal
) {
  const url = `${BLS_URL}/${encodeURIComponent(seriesId)}?latest=true`;
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);

  const json = (await res.json()) as BlsResponse;
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS request failed: ${json.status}`);
  }

  const obs = json.Results?.series?.[0]?.data?.find(x => /^M\d\d$/.test(x.period));
  if (!obs) return null;

  const value = Number(obs.value);
  if (!Number.isFinite(value)) return null;

  return {
    periodDate: periodToDate(obs.year, obs.period),
    value,
    rawValue: obs.value,
    sourceReleaseLabel: obs.periodName,
  };
}
