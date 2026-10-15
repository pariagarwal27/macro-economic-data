// Keep release-day polling responsive while avoiding a tight request loop
// when an official source has not published the observation yet.
export const RELEASE_RETRY_COOLDOWN_MS = 5_000;
// This lease protects an unfinished request; it is not a retry delay.
export const RELEASE_PROCESSING_LEASE_MS = 2 * 60_000;

export type ReleaseLogFields = Record<string, unknown> & {
  event: string;
  at?: string;
};

export function nextReleaseRetryAt(
  attemptStartedAt: string,
  cooldownMs = RELEASE_RETRY_COOLDOWN_MS,
) {
  return new Date(Date.parse(attemptStartedAt) + cooldownMs).toISOString();
}

function redactSecrets(value: string) {
  return value
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|key|token|access_token|client_secret)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/("(?:api[_-]?key|token|access_token|client_secret)"\s*:\s*")[^"]+("?)/gi, "$1[redacted]$2");
}

export function formatReleaseLog(fields: ReleaseLogFields) {
  const safeFields: Record<string, unknown> = {
    ...fields,
    at: fields.at ?? new Date().toISOString(),
  };
  if (typeof safeFields.error === "string") safeFields.error = redactSecrets(safeFields.error);
  return `[release-worker] ${JSON.stringify(safeFields)}`;
}

export function logReleaseEvent(fields: ReleaseLogFields) {
  console.log(formatReleaseLog(fields));
}
