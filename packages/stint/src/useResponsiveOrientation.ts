"use client";

import { useEffect, useState, type RefObject } from "react";

export type StintOrientation = "vertical" | "horizontal" | "responsive";
export type ResolvedOrientation = "vertical" | "horizontal";

/** rem width below which responsive mode renders horizontally. */
export const RESPONSIVE_BREAKPOINT_REM = 40;

function remToPx(rem: number): number {
  if (typeof document === "undefined") return rem * 16;
  const rootSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return rem * (Number.isFinite(rootSize) && rootSize > 0 ? rootSize : 16);
}

/**
 * Resolves the interaction axis for `responsive` orientation. The visual
 * switch is owned entirely by a CSS container query at the same 40rem
 * boundary; this hook only synchronizes interaction semantics (pointer axis,
 * arrow-key direction, `aria-orientation`) after measurement, so SSR markup
 * never changes shape.
 */
export function useResponsiveOrientation(
  containerRef: RefObject<HTMLElement | null>,
  orientation: StintOrientation,
): ResolvedOrientation {
  const [measured, setMeasured] = useState<ResolvedOrientation>("vertical");

  useEffect(() => {
    if (orientation !== "responsive") return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const threshold = remToPx(RESPONSIVE_BREAKPOINT_REM);
    const sync = (width: number) => {
      // A zero width means the container is not laid out yet (or hidden);
      // keep the previous semantics rather than guessing.
      if (width > 0) setMeasured(width < threshold ? "horizontal" : "vertical");
    };
    sync(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((observerEntries) => {
      const width =
        observerEntries[0]?.contentBoxSize?.[0]?.inlineSize ??
        observerEntries[0]?.contentRect.width ??
        el.getBoundingClientRect().width;
      sync(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, orientation]);

  return orientation === "responsive" ? measured : orientation;
}
