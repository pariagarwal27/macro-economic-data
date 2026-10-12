/**
 * LSEG adapter bridge.
 *
 * MacroHub should NOT embed LSEG Workspace credentials in the Next.js app.
 * The intended deployment is:
 *
 * Next.js release worker
 *       ↓ localhost/private network
 * LSEG Python worker
 *       ↓
 * LSEG Workspace Desktop session
 *
 * Configure:
 *   LSEG_WORKER_URL=http://127.0.0.1:8787
 *
 * The Python worker contract is:
 * GET /latest?ric=<encoded RIC>
 * GET /history?ric=<encoded RIC>&start=1990-01-01&end=YYYY-MM-DD
 *
 * response:
 * {
 *   "ok": true,
 *   "periodDate": "2026-09-30",
 *   "value": 123.4,
 *   "rawValue": "123.4",
 *   "releasedAt": "2026-09-30T14:30:00Z"
 * }
 */
export async function fetchLsegLatest(
  sourceId: string,
  signal?: AbortSignal
) {
  const worker = process.env.LSEG_WORKER_URL;
  if (!worker) throw new Error("LSEG_WORKER_URL is not configured");

  const url = `${worker.replace(/\/$/, "")}/latest?ric=${encodeURIComponent(sourceId)}`;
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`LSEG worker HTTP ${res.status}`);

  const json = await res.json() as {
    ok: boolean;
    periodDate?: string;
    value?: number;
    rawValue?: string;
    releasedAt?: string;
  };

  if (!json.ok || !json.periodDate || !Number.isFinite(json.value)) {
    return null;
  }

  return {
    periodDate: json.periodDate,
    value: Number(json.value),
    rawValue: json.rawValue ?? String(json.value),
    releasedAt: json.releasedAt ?? new Date().toISOString(),
    note: `Official LSEG ${sourceId}`,
  };
}

export async function fetchLsegHistory(
  sourceId: string,
  options: { start?: string; end?: string } = {},
  signal?: AbortSignal
): Promise<{ date: string; value: number }[]> {
  const worker = process.env.LSEG_WORKER_URL;
  if (!worker) throw new Error("LSEG_WORKER_URL is not configured");

  const url = new URL(`${worker.replace(/\/$/, "")}/history`);
  url.searchParams.set("ric", sourceId);
  url.searchParams.set("start", options.start ?? "1990-01-01");
  url.searchParams.set("end", options.end ?? new Date().toISOString().slice(0, 10));
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`LSEG worker HTTP ${res.status}`);
  const json = await res.json() as {
    ok: boolean;
    observations?: { date: string; value: number }[];
  };
  if (!json.ok || !Array.isArray(json.observations)) return [];

  return json.observations.filter((point) =>
    /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value)
  );
}
