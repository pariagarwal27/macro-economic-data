export const RELEASE_PREPARE_LEAD_MS = 5_000;
/** A scheduled release can be fetched only during its local release day. */
export function isWithinReleaseFetchWindow(
  scheduledAt: string,
  now = Date.now(),
  allowBeforeReleaseMs = 0,
  timeZone = "UTC",
) {
  const releaseAt = exactReleaseTimestamp(scheduledAt);
  const scheduledDate = releaseAt == null
    ? scheduledAt.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    : dateInTimeZone(new Date(releaseAt), timeZone);
  if (!scheduledDate || dateInTimeZone(new Date(now), timeZone) !== scheduledDate) return false;
  return releaseAt == null || now >= releaseAt - allowBeforeReleaseMs;
}

function dateInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** A date or an unzoned wall time is not a confirmed publication instant. */
export function exactReleaseTimestamp(scheduledAt: string): number | null {
  if (!/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(scheduledAt)) return null;
  const instant = Date.parse(scheduledAt);
  return Number.isFinite(instant) ? instant : null;
}

export async function waitForReleaseInstant(scheduledAt: string, clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}, leadMs = 0): Promise<void> {
  const instant = exactReleaseTimestamp(scheduledAt);
  if (instant == null) return;
  // Recheck the clock after every wake: timers can run early or the system
  // clock can be corrected. Never send a release request before its deadline.
  for (let remaining = instant - leadMs - clock.now(); remaining > 0; remaining = instant - leadMs - clock.now()) {
    await clock.sleep(Math.min(remaining, 1_000));
  }
}

export function releaseRetryDelayMs(adapter: string | undefined, scheduledAt: string, now = Date.now()): number {
  const instant = exactReleaseTimestamp(scheduledAt);
  if (instant == null || now < instant) return 5_000;
  const elapsed = now - instant;
  // Preserve the desktop bridge cadence. Public sources need a short retry
  // window too: a response arriving just before publication must not cost 5s.
  // Back off after that window rather than polling rapidly all release day.
  if (adapter === "lseg") return elapsed < 30_000 ? 1_000 : 5_000;
  if (elapsed < 60_000) return 500;
  return elapsed < 300_000 ? 1_000 : 5_000;
}
