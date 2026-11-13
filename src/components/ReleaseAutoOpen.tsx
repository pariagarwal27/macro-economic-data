"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getClientJsonCache, updateClientJsonCache } from "@/lib/client-json-cache";
import { buildReleaseOpenings, enqueueReleaseOpenings, mergeReleaseUpdates, type ReleaseOpening, type ReleaseUpdate } from "@/lib/release-notifications";

const STORAGE_KEY = "macrohub:release-stream:v1";
type CacheMetric = { history: Array<{ date: string; value: number }>; displayReleasedAt?: string | null };

/** Observe committed publications globally, including when the calendar is not visible. */
export function ReleaseAutoOpen() {
  const router = useRouter();
  const pathname = usePathname();
  const queue = useRef<ReleaseOpening[]>([]);
  const current = useRef<ReleaseOpening | null>(null);
  const seen = useRef(new Set<string>());
  const cursor = useRef<number | null>(null);
  const pendingUpdates = useRef<ReleaseUpdate[]>([]);
  const openingTimer = useRef<number | null>(null);
  const visited = useRef(false);
  const [waiting, setWaiting] = useState(0);

  const save = useCallback(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ cursor: cursor.current, seen: [...seen.current].slice(-1000), pending: [...(current.current ? [current.current] : []), ...queue.current] }));
    } catch { /* The live connection still works without session storage. */ }
  }, []);

  const openNext = useCallback(() => {
    if (current.current || !queue.current.length) return;
    const next = queue.current.shift()!;
    current.current = next;
    const path = `/country/${next.region.toLowerCase()}`;
    visited.current = window.location.pathname === path;
    setWaiting(queue.current.length);
    save();
    if (visited.current) {
      window.dispatchEvent(new CustomEvent("macrohub:auto-release-open", { detail: next }));
    } else {
      router.push(`${path}?openMetric=${encodeURIComponent(next.metricId)}&releaseKey=${encodeURIComponent(next.key)}&releasePeriod=${encodeURIComponent(next.periodDate.slice(0, 7))}`);
    }
  }, [router, save]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
      if (Number.isSafeInteger(saved?.cursor) && saved.cursor >= 0) cursor.current = saved.cursor;
      if (Array.isArray(saved?.seen)) seen.current = new Set(saved.seen.filter((key: unknown): key is string => typeof key === "string"));
      if (Array.isArray(saved?.pending)) queue.current = saved.pending.filter((item: ReleaseOpening) => item && typeof item.key === "string" && item.key !== current.current?.key && ["US", "UK", "EA"].includes(item.region));
    } catch { /* Start with a fresh cursor if stored state is unavailable. */ }
    const stream = new EventSource(`/api/releases/stream${cursor.current == null ? "" : `?after=${cursor.current}`}`);
    stream.onmessage = event => {
      let payload: { cursor: number; updates: ReleaseUpdate[] };
      try { payload = JSON.parse(event.data); } catch { return; }
      if (!Number.isSafeInteger(payload.cursor) || !Array.isArray(payload.updates)) return;
      cursor.current = payload.cursor;
      if (payload.updates.length) {
        for (const region of ["US", "UK", "EA"] as const) {
          const key = `dashboard:${region}`;
          if (getClientJsonCache<Record<string, CacheMetric>>(key, false)) {
            updateClientJsonCache<Record<string, CacheMetric>>(key, metrics => mergeReleaseUpdates(metrics, payload.updates));
          }
        }
        window.dispatchEvent(new CustomEvent("macrohub:release-updates", { detail: payload.updates }));
        // Allow one short batch for release priority, bounded from the FIRST
        // update. A stream of component commits must not postpone opening.
        pendingUpdates.current.push(...payload.updates);
        if (openingTimer.current == null) openingTimer.current = window.setTimeout(() => {
          const batch = pendingUpdates.current;
          pendingUpdates.current = [];
          openingTimer.current = null;
          queue.current = enqueueReleaseOpenings(queue.current, buildReleaseOpenings(batch), seen.current);
          setWaiting(queue.current.length);
          save();
          openNext();
        }, 250);
      }
      save();
    };
    const onClose = (event: Event) => {
      const key = (event as CustomEvent<{ key: string }>).detail?.key;
      if (!key || key !== current.current?.key) return;
      current.current = null;
      visited.current = false;
      save();
      openNext();
    };
    window.addEventListener("macrohub:release-card-closed", onClose);
    const restoreTimer = window.setTimeout(openNext, 0);
    return () => {
      window.clearTimeout(restoreTimer);
      if (openingTimer.current != null) window.clearTimeout(openingTimer.current);
      openingTimer.current = null;
      pendingUpdates.current = [];
      window.removeEventListener("macrohub:release-card-closed", onClose);
      stream.close();
      save();
    };
  }, [openNext, save]);

  useEffect(() => {
    const active = current.current;
    if (!active) return;
    const targetPath = `/country/${active.region.toLowerCase()}`;
    if (pathname === targetPath) visited.current = true;
    else if (visited.current) {
      current.current = null;
      visited.current = false;
      save();
      openNext();
    }
  }, [pathname, openNext, save]);

  return waiting > 0 ? <div className="release-auto-open-queue" role="status">{waiting} more {waiting === 1 ? "release" : "releases"} waiting · close this card to view the next</div> : null;
}
