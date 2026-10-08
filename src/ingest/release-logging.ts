export const RELEASE_RETRY_COOLDOWN_MS = 2 * 60_000;

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
