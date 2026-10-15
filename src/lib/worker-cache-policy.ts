/** Return the edge-cache TTL for a public API response, or null when it opts out. */
export function publicApiCacheMaxAge(response: Pick<Response, "headers">, refreshable: boolean): number | null {
  const directives = response.headers.get("Cache-Control") ?? "";
  if (/(?:^|,)\s*(?:no-store|no-cache|private)\b/i.test(directives)) return null;
  return refreshable ? 300 : 1800;
}
