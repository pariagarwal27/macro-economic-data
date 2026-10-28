"use client";

import { useEffect, useRef, type ReactNode } from "react";

const SVG_NS = "http://www.w3.org/2000/svg";
const TRACE_DURATION = 1500;
let traceId = 0;
function seriesKey(path: SVGPathElement | SVGRectElement, root: HTMLDivElement, kind: "line" | "bars"): string {
  const svg = path.ownerSVGElement;
  if (!svg) return "orphan";
  const selector = kind === "bars" ? ".recharts-bar-rectangle path, .recharts-bar-rectangle rect" : ".recharts-line-curve";
  const chartIndex = [...root.querySelectorAll<SVGSVGElement>("svg.recharts-surface")].indexOf(svg);
  const index = [...svg.querySelectorAll<SVGPathElement | SVGRectElement>(selector)].indexOf(path);
  return `${chartIndex}:${index}`;
}

function parkPointer(path: SVGPathElement): () => void {
  const svg = path.ownerSVGElement;
  const length = path.getTotalLength();
  if (!svg || !Number.isFinite(length) || length <= 0) return () => {};
  const end = path.getPointAtLength(length);
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("data-chart-trace-pointer", "");
  group.setAttribute("data-chart-trace-static", "");
  group.setAttribute("aria-hidden", "true");
  group.style.pointerEvents = "none";
  group.setAttribute("transform", `translate(${end.x} ${end.y})`);
  const color = getComputedStyle(path).stroke;
  for (const [radius, opacity] of [[9, 0.18], [3.5, 1]]) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", color);
    circle.setAttribute("opacity", String(opacity));
    group.appendChild(circle);
  }
  svg.appendChild(group);
  return () => group.remove();
}

function animateBar(element: SVGPathElement | SVGRectElement): () => void {
  const oldBox = element.style.transformBox;
  const oldOrigin = element.style.transformOrigin;
  element.style.transformBox = "fill-box";
  const bounds = element.getBBox();
  const zeroY = Number(element.ownerSVGElement?.querySelector(".recharts-reference-line-line")?.getAttribute("y1"));
  const origin = Number.isFinite(zeroY) && zeroY < bounds.y + bounds.height / 2 ? "center top" : "center bottom";
  element.style.transformOrigin = origin;
  element.setAttribute("data-chart-bar-trace", "running");
  const animation = element.animate(
    [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
    { duration: 1100, easing: "cubic-bezier(.2,.75,.25,1)", fill: "both" },
  );
  const restore = () => {
    animation.cancel();
    element.style.transformBox = oldBox;
    element.style.transformOrigin = oldOrigin;
    element.removeAttribute("data-chart-bar-trace");
  };
  animation.addEventListener("finish", restore, { once: true });
  return restore;
}

function animatePath(path: SVGPathElement): () => void {
  const svg = path.ownerSVGElement;
  const shape = path.getAttribute("d");
  const length = path.getTotalLength();
  if (!svg || !shape || !Number.isFinite(length) || length <= 0) return () => {};
  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-chart-trace-layer", "running");
  layer.setAttribute("aria-hidden", "true");
  layer.style.pointerEvents = "none";
  const mask = document.createElementNS(SVG_NS, "mask");
  const maskId = `chart-trace-mask-${++traceId}`;
  mask.id = maskId;
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const bounds = path.getBBox();
  mask.setAttribute("x", String(bounds.x - 20));
  mask.setAttribute("y", String(bounds.y - 20));
  mask.setAttribute("width", String(bounds.width + 40));
  mask.setAttribute("height", String(bounds.height + 40));

  // Reveal the exact existing curve, preserving dashed trends and dual axes.
  const reveal = document.createElementNS(SVG_NS, "path");
  reveal.setAttribute("d", shape);
  reveal.setAttribute("fill", "none");
  reveal.setAttribute("stroke", "white");
  reveal.setAttribute("stroke-width", String((parseFloat(getComputedStyle(path).strokeWidth) || 3) + 2));
  reveal.setAttribute("stroke-linecap", "round");
  reveal.setAttribute("stroke-dasharray", `${length} ${length}`);
  reveal.setAttribute("stroke-dashoffset", String(length));
  const draw = document.createElementNS(SVG_NS, "animate");
  draw.setAttribute("attributeName", "stroke-dashoffset");
  draw.setAttribute("from", String(length));
  draw.setAttribute("to", "0");
  draw.setAttribute("dur", `${TRACE_DURATION}ms`);
  draw.setAttribute("begin", "indefinite");
  draw.setAttribute("fill", "freeze");
  reveal.appendChild(draw);
  mask.appendChild(reveal);
  const defs = document.createElementNS(SVG_NS, "defs");
  defs.appendChild(mask);
  layer.appendChild(defs);

  const pointer = document.createElementNS(SVG_NS, "g");
  pointer.setAttribute("data-chart-trace-pointer", "");
  const color = getComputedStyle(path).stroke;
  for (const [radius, opacity] of [[9, 0.18], [3.5, 1]]) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", color);
    circle.setAttribute("opacity", String(opacity));
    pointer.appendChild(circle);
  }
  const motion = document.createElementNS(SVG_NS, "animateMotion");
  motion.setAttribute("path", shape);
  motion.setAttribute("dur", `${TRACE_DURATION}ms`);
  motion.setAttribute("begin", "indefinite");
  motion.setAttribute("calcMode", "paced");
  motion.setAttribute("fill", "freeze");
  pointer.appendChild(motion);
  layer.appendChild(pointer);

  const dots = path.closest(".recharts-line")?.querySelector<SVGGElement>(".recharts-line-dots");
  const oldOpacity = dots?.style.opacity ?? "";
  const oldMask = path.getAttribute("mask");
  if (dots) dots.style.opacity = "0";
  svg.appendChild(layer);
  path.setAttribute("mask", `url(#${maskId})`);
  draw.beginElement();
  motion.beginElement();
  const finish = window.setTimeout(() => {
    if (dots) dots.style.opacity = oldOpacity;
    layer.setAttribute("data-chart-trace-layer", "complete");
  }, TRACE_DURATION);
  return () => {
    window.clearTimeout(finish);
    if (dots) dots.style.opacity = oldOpacity;
    if (oldMask == null) path.removeAttribute("mask");
    else path.setAttribute("mask", oldMask);
    layer.remove();
  };
}

/** Animate newly selected series once; data redraws only move the parked endpoint. */
export function useChartTrace(enabled = true, kind: "line" | "bars" = "line") {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root || root.parentElement?.closest("[data-chart-trace]")) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const paths = new Map<string, { path: SVGPathElement | SVGRectElement; shape: string; dispose: () => void; animated: boolean }>();
    let visible = false;
    const refresh = () => {
      const bounds = root.getBoundingClientRect();
      visible = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight && getComputedStyle(root).visibility !== "hidden";
      if (!visible) return;
      const selector = kind === "bars" ? ".recharts-bar-rectangle path, .recharts-bar-rectangle rect" : ".recharts-line-curve";
      const present = new Set(root.querySelectorAll<SVGPathElement | SVGRectElement>(selector));
      for (const path of present) {
        const shape = path.getAttribute("d") ?? `${path.getAttribute("x")},${path.getAttribute("y")},${path.getAttribute("width")},${path.getAttribute("height")}`;
        if (!shape) continue;
        const key = seriesKey(path, root, kind);
        const previous = paths.get(key);
        if (previous?.path === path && previous.shape === shape) continue;
        if (previous) {
          previous.dispose();
          // A refreshed/replaced shape never replays its entrance animation.
          paths.set(key, { path, shape, dispose: kind === "line" ? parkPointer(path as SVGPathElement) : () => {}, animated: previous.animated });
          continue;
        }
        const dispose = reducedMotion.matches
          ? (kind === "line" ? parkPointer(path as SVGPathElement) : () => {})
          : (kind === "line" ? animatePath(path as SVGPathElement) : animateBar(path));
        paths.set(key, { path, shape, dispose: dispose ?? (() => {}), animated: !reducedMotion.matches });
      }
    };
    // Ignore the graphics we insert so setup cannot trigger itself again.
    const owned = (node: Node) => node instanceof Element && Boolean(node.closest("[data-chart-trace-layer]"));
    const observer = new MutationObserver(records => {
      if (records.some(record => !owned(record.target) && (record.type === "attributes" || [...record.addedNodes, ...record.removedNodes].some(node => !owned(node))))) refresh();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["d", "stroke"] });
    const viewport = new IntersectionObserver(refresh);
    viewport.observe(root);
    const onMotionChange = () => {
      if (!reducedMotion.matches) return;
      for (const [key, state] of paths) {
        state.dispose();
        paths.set(key, { ...state, dispose: kind === "line" ? parkPointer(state.path as SVGPathElement) : () => {} });
      }
    };
    reducedMotion.addEventListener("change", onMotionChange);
    refresh();
    return () => {
      observer.disconnect();
      viewport.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
      paths.forEach(value => value.dispose());
      paths.clear();
    };
  }, [enabled, kind]);
  return ref;
}

export function ChartTrace({ enabled = true, kind = "line", children }: { enabled?: boolean; kind?: "line" | "bars"; children: ReactNode }) {
  const ref = useChartTrace(enabled, kind);
  return <div ref={ref} data-chart-trace={enabled ? "" : undefined} style={{ width: "100%", minWidth: 0 }}>{children}</div>;
}
