import { readReleaseUpdates } from "@/data/release-updates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supplied = request.headers.get("last-event-id") || url.searchParams.get("after");
  if (supplied != null && !/^\d+$/.test(supplied)) return new Response("Invalid release cursor", { status: 400 });
  let cursor: number | null = supplied == null ? null : Number(supplied);
  if (cursor != null && !Number.isSafeInteger(cursor)) return new Response("Invalid release cursor", { status: 400 });
  let stopped = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => { stopped = true; };
      request.signal.addEventListener("abort", stop);
      // Keep the number of database reads bounded for the local app.
      const until = Date.now() + 22_000;
      try {
        controller.enqueue(encoder.encode("retry: 500\n\n"));
        let heartbeat = 0;
        while (!stopped && Date.now() < until) {
          const batch = await readReleaseUpdates(cursor);
          if (stopped) break;
          const changed = cursor == null || batch.cursor !== cursor;
          cursor = batch.cursor;
          if (changed) controller.enqueue(encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify(batch)}\n\n`));
          else if (++heartbeat >= 40) { controller.enqueue(encoder.encode(": keepalive\n\n")); heartbeat = 0; }
          if (!batch.hasMore) await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!stopped) controller.close();
      } catch (error) {
        if (!stopped) controller.error(error);
      } finally {
        request.signal.removeEventListener("abort", stop);
      }
    },
    cancel() { stopped = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
