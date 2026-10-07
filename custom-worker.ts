// @ts-ignore OpenNext creates this module during the production build.
import handler from "./.open-next/worker.js";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const publicData = request.method === "GET" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/cron/");
    if (!publicData) return handler.fetch(request, env, ctx);
    const cache = await caches.open("macro-public-data");
    const key = new Request(request.url);
    const cached = await cache.match(key);
    if (cached) return cached;
    let response: Response;
    try { response = await handler.fetch(request, env, ctx); }
    catch { response = new Response(null, { status: 500 }); }
    if (response.ok) {
      response = new Response(response.body, response);
      // Bound repeated history reads on the free D1 plan while keeping daily
      // series and their calendar listing fresh during the trading day.
      const refreshableData = url.pathname.startsWith("/api/dashboard/") || url.pathname === "/api/economic-calendar";
      response.headers.set("Cache-Control", `public, max-age=${refreshableData ? 300 : 1800}`);
      response.headers.set("X-Macro-Data", "live");
      ctx.waitUntil(cache.put(key, response.clone()));
      return response;
    }
    if (!env.ASSETS) return response;
    const fallbackUrl = new URL(`/data-fallback${url.pathname}.json`, request.url);
    const fallback = await env.ASSETS.fetch(new Request(fallbackUrl));
    if (fallback.ok && fallback.headers.get("content-type")?.includes("json")) {
      let body: BodyInit | null = fallback.body;
      if (url.pathname === "/api/metrics") {
        const data = await fallback.json() as any;
        const region = url.searchParams.get("region") ?? "ALL";
        const category = url.searchParams.get("category") ?? "ALL";
        data.cards = data.cards.filter((card: any) => (region === "ALL" || card.region === region) && (category === "ALL" || card.category === category));
        body = JSON.stringify(data);
      }
      const saved = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Macro-Data": "saved-snapshot", "X-Macro-Snapshot-At": "2026-10-06" } });
      ctx.waitUntil(cache.put(key, saved.clone()));
      return saved;
    }
    return response;
  },
  async scheduled(_event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    if (!env.CRON_SECRET) throw new Error("CRON_SECRET is required for scheduled ingestion");
    // Use the generated handler directly: no public self-fetch or local PC needed.
    const request = new Request("https://macro-economy-tracker.macro-economy-tracker.workers.dev/api/cron/releases", {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const response = await handler.fetch(request, env, ctx);
    const result = await response.json();
    console.log("[scheduled/releases]", JSON.stringify(result));
    if (!response.ok) throw new Error(`Release refresh returned HTTP ${response.status}`);
  },
} satisfies ExportedHandler<CloudflareEnv>;

// @ts-ignore Generated OpenNext durable-object exports.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
