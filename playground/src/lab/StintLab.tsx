"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { animate, type AnimationPlaybackControls } from "motion";

import type {
  StintChangeMeta,
  StintFeedbackHandler,
  StintInputSource,
} from "../../../packages/stint/src/feedback.js";
import { normalizeStintConfig } from "../../../packages/stint/src/schema.js";
import {
  formatExperienceRange,
  formatMonth,
  indexToMonth,
  monthToIndex,
  resolveActiveEntry,
} from "../../../packages/stint/src/timeline.js";
import type {
  CurrentMonthMode,
  MonthString,
  NormalizedStintConfig,
  NormalizedStintExperience,
  NormalizedStintRole,
  StintConfig,
  StintDiagnostic,
  StintSelection,
} from "../../../packages/stint/src/types.js";
import { useCurrentMonth } from "../../../packages/stint/src/useCurrentMonth.js";
import { useExperienceSelection } from "../../../packages/stint/src/useExperienceSelection.js";
import {
  useResponsiveOrientation,
  type ResolvedOrientation,
  type StintOrientation,
} from "../../../packages/stint/src/useResponsiveOrientation.js";
import type { FixId } from "./fixes.js";

const NO_FIXES: ReadonlySet<FixId> = new Set();

/* ---------- geometry & motion constants ---------- */

/** months — unselectable lead pad so the first year label has room */
const LEAD_PAD_MONTHS = 6;
/** months — unselectable trail pad past the newest month */
const TRAIL_PAD_MONTHS = 2;
/** px — gaussian falloff radius for tick magnification around the cursor */
const CURSOR_SIGMA = 30;
/** months — how far the accent softens past a band's edges */
const RANGE_SIGMA = 3;
/** target upper bound for the number of rendered ticks */
const MAX_TICKS = 60;

const SCALE_REST = 0.6;
const SCALE_HOVER_INACTIVE = 0.78;
const SCALE_ACTIVE = 1.25;
const SCALE_ACTIVE_HOVER = 1.4;

const EASE_BACK_IN_OUT = [0.68, -0.55, 0.265, 1.55] as const;
const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const;

const KEYBOARD_PAGE_MONTHS = 12;
const SETTLE_ANNOUNCE_MS = 400;
const DISENGAGE_GRACE_MS = 250;

/* ---------- public prop types ---------- */

export interface StintLogoContext {
  entry: NormalizedStintExperience;
  isActive: boolean;
  /** px — the square artwork region being filled */
  size: number;
}

export interface StintReadoutContext {
  entry: NormalizedStintExperience;
  role: NormalizedStintRole | null;
  month: MonthString;
  isCurrent: boolean;
  formattedRange: string;
  /** The package-rendered readout body, for slot wrappers such as links. */
  children: ReactNode;
}

export interface StintTickContext {
  monthIndex: number;
  entry: NormalizedStintExperience;
  /** 0 at the newest edge of the entry band, 1 at the oldest edge */
  bandFraction: number;
}

export interface StintSlots {
  /** Artwork inside each rail tile and the readout tile. */
  logo?: (context: StintLogoContext) => ReactNode;
  /** Wraps (or replaces) the readout body — the place for a company link. */
  readout?: (context: StintReadoutContext) => ReactNode;
  /** Replaces the "Current" badge content. */
  currentLabel?: (context: { entry: NormalizedStintExperience }) => ReactNode;
  /** Replaces the settled status message content. */
  status?: (context: { message: string }) => ReactNode;
}

export type StintClassNameSlot =
  | "root"
  | "readout"
  | "currentLabel"
  | "rail"
  | "logo"
  | "ruler"
  | "tick"
  | "tickLabel"
  | "status";

export interface StintLabProps extends StintProps {
  /** Proposed fixes to apply on top of the shipped behaviour. */
  fixes?: ReadonlySet<FixId>;
}

export interface StintProps {
  /** Consumer-supplied config in the public schema. */
  data: StintConfig;
  currentMonth?: CurrentMonthMode;
  /** Layout axis; horizontal by default. */
  orientation?: StintOrientation;
  /** Controlled selection. */
  value?: StintSelection;
  defaultValue?: StintSelection;
  onChange?: (selection: StintSelection, meta: StintChangeMeta) => void;
  onFeedback?: StintFeedbackHandler;
  onDiagnostics?: (diagnostics: readonly StintDiagnostic[]) => void;
  /**
   * Return to the current role when the pointer leaves the widget.
   * Off by default: committed selections survive pointer leave.
   */
  resetOnLeave?: boolean;
  locale?: string;
  labels?: {
    slider?: string;
    current?: string;
  };
  slots?: StintSlots;
  classNames?: Partial<Record<StintClassNameSlot, string>>;
  /**
   * Advanced hook: per-tick accent paint inside the active band. Return a
   * CSS color, or nullish for the default accent token.
   */
  getTickColor?: (context: StintTickContext) => string | null | undefined;
  className?: string;
  style?: CSSProperties;
}

/* ---------- pure geometry helpers ---------- */

interface Axis {
  /** continuous month domain, oldest → newest */
  min: number;
  span: number;
  firstIndex: number;
  lastIndex: number;
}

function deriveAxis(config: NormalizedStintConfig): Axis | null {
  if (!config.bounds) return null;
  const min = config.bounds.startIndex - LEAD_PAD_MONTHS;
  const max = config.bounds.endIndexExclusive + TRAIL_PAD_MONTHS;
  return {
    min,
    span: max - min,
    firstIndex: config.bounds.startIndex,
    lastIndex: config.bounds.endIndexExclusive - 1,
  };
}

/** fraction along the oldest → newest axis for a continuous month value */
const fractionFor = (axis: Axis, month: number) => (month - axis.min) / axis.span;

interface Tick {
  index: number;
  fraction: number;
  major: boolean;
  year: number;
}

function buildTicks(axis: Axis): Tick[] {
  const steps = [1, 2, 3, 4, 6, 12];
  const step = steps.find((s) => axis.span / s <= MAX_TICKS) ?? 12;
  const ticks: Tick[] = [];
  const first = Math.ceil(axis.min / step) * step;
  for (let index = first; index <= axis.min + axis.span; index += step) {
    ticks.push({
      index,
      fraction: fractionFor(axis, index),
      major: index % 12 === 0,
      year: Math.floor(index / 12),
    });
  }
  return ticks;
}

/**
 * Bands used for painting the ruler. Edges snap outward to calendar-year
 * boundaries but are clamped to the neighbouring entry's edge, so cutoffs
 * stay hard and non-overlapping entries never share notches.
 */
function deriveVisualBands(
  entries: readonly NormalizedStintExperience[],
): [number, number][] {
  return entries.map((entry, index) => {
    let start = Math.floor(entry.startIndex / 12) * 12;
    let end = Math.ceil(entry.endIndexExclusive / 12) * 12;
    const previous = entries[index - 1];
    const next = entries[index + 1];
    if (previous) start = Math.max(start, previous.endIndexExclusive);
    if (next) end = Math.min(end, Math.max(next.startIndex, entry.endIndexExclusive));
    start = Math.min(start, entry.startIndex);
    return [start, Math.max(end, entry.startIndex + 1)];
  });
}

/** 1 inside the band, gaussian falloff (in months) outside its edges. */
function rangeStrength(month: number, band: [number, number]): number {
  if (month >= band[0] && month < band[1]) return 1;
  const distance = month < band[0] ? band[0] - month : month - band[1];
  return Math.exp(-(distance * distance) / (2 * RANGE_SIGMA * RANGE_SIGMA));
}

function nearestEntry(
  entries: readonly NormalizedStintExperience[],
  monthIndex: number,
): NormalizedStintExperience | null {
  let best: NormalizedStintExperience | null = null;
  let bestDistance = Infinity;
  for (const entry of entries) {
    if (monthIndex >= entry.startIndex && monthIndex < entry.endIndexExclusive) {
      return entry;
    }
    const distance =
      monthIndex < entry.startIndex
        ? entry.startIndex - monthIndex
        : monthIndex - (entry.endIndexExclusive - 1);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ---------- component ---------- */

export function StintLab({
  data,
  currentMonth,
  orientation = "horizontal",
  value,
  defaultValue,
  onChange,
  onFeedback,
  onDiagnostics,
  resetOnLeave = false,
  locale,
  labels,
  slots,
  classNames,
  getTickColor,
  className,
  style,
  fixes = NO_FIXES,
}: StintLabProps) {
  const referenceMonth = useCurrentMonth(currentMonth);
  // Widened alias: the MonthString union is too wide for a deps tuple.
  const referenceMonthKey: string = referenceMonth;
  const normalized = useMemo(
    () => normalizeStintConfig(data, { referenceMonth: referenceMonthKey as MonthString }),
    [data, referenceMonthKey],
  );
  const config = normalized.config;

  const onDiagnosticsRef = useRef(onDiagnostics);
  useEffect(() => {
    onDiagnosticsRef.current = onDiagnostics;
  });
  useEffect(() => {
    if (normalized.diagnostics.length > 0) {
      onDiagnosticsRef.current?.(normalized.diagnostics);
    }
  }, [normalized]);

  const containerRef = useRef<HTMLDivElement>(null);
  const resolved = useResponsiveOrientation(containerRef, orientation);

  const selectionState = useExperienceSelection({
    config,
    value,
    defaultValue,
    onChange,
  });

  if (!config || !config.bounds || config.entries.length === 0) {
    return null;
  }

  return (
    <StintTimeline
      key={resolvedKey(orientation)}
      config={config}
      resolved={resolved}
      orientation={orientation}
      selectionState={selectionState}
      onFeedback={onFeedback}
      resetOnLeave={resetOnLeave}
      locale={locale}
      labels={labels}
      slots={slots}
      classNames={classNames}
      getTickColor={getTickColor}
      className={className}
      style={style}
      containerRef={containerRef}
      fixes={fixes}
    />
  );
}

// Explicit orientation changes remount the timeline so stale drag geometry
// can never leak across an axis change; responsive stays mounted and syncs.
const resolvedKey = (orientation: StintOrientation) => orientation;

interface StintTimelineProps {
  config: NormalizedStintConfig;
  resolved: ResolvedOrientation;
  orientation: StintOrientation;
  selectionState: ReturnType<typeof useExperienceSelection>;
  onFeedback?: StintFeedbackHandler;
  resetOnLeave: boolean;
  locale?: string;
  labels?: StintProps["labels"];
  slots?: StintSlots;
  classNames?: StintProps["classNames"];
  getTickColor?: StintProps["getTickColor"];
  className?: string;
  style?: CSSProperties;
  containerRef: React.RefObject<HTMLDivElement | null>;
  fixes: ReadonlySet<FixId>;
}

function StintTimeline({
  config,
  resolved,
  orientation,
  selectionState,
  onFeedback,
  resetOnLeave,
  locale,
  labels,
  slots,
  classNames,
  getTickColor,
  className,
  style,
  containerRef,
  fixes,
}: StintTimelineProps) {
  const has = (id: FixId) => fixes.has(id);
  const axis = deriveAxis(config)!;
  const ticks = useMemo(() => buildTicks(axis), [axis.min, axis.span]); // eslint-disable-line react-hooks/exhaustive-deps
  const visualBands = useMemo(
    () => deriveVisualBands(config.entries),
    [config.entries],
  );
  const horizontal = resolved === "horizontal";

  const { selection, entry, role, propose } = selectionState;
  const committedMonthIndex = selection
    ? monthToIndex(selection.month)
    : axis.lastIndex;
  const displayEntry =
    entry ?? nearestEntry(config.entries, committedMonthIndex);

  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const rulerRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const logoRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const state = useRef({
    targetMonth: committedMonthIndex + 0.5,
    currentMonth: committedMonthIndex + 0.5,
    raf: 0,
    running: false,
    engagedCount: 0,
    engaged: false,
    disengageTimer: null as ReturnType<typeof setTimeout> | null,
    dragPointerId: null as number | null,
    reducedMotion: false,
    lastFrameAt: 0,
    lastPointerType: "",
    axisLength: 0,
    scaleTargets: [] as (number | undefined)[],
    scaleAnims: [] as (AnimationPlaybackControls | undefined)[],
  });

  // Refs so the imperative frame loop always sees the latest React state.
  const frameContext = useRef({
    config,
    axis,
    horizontal,
    visualBands,
    ticks,
    activeEntryId: displayEntry?.id ?? null,
    propose,
    onFeedback,
    getTickColor,
    resetOnLeave,
    fixes,
  });
  frameContext.current = {
    config,
    axis,
    horizontal,
    visualBands,
    ticks,
    activeEntryId: displayEntry?.id ?? null,
    propose,
    onFeedback,
    getTickColor,
    resetOnLeave,
    fixes,
  };

  const emit = useCallback(
    (event: Parameters<StintFeedbackHandler>[0]) => {
      frameContext.current.onFeedback?.(event);
    },
    [],
  );

  /* ----- Motion-driven logo scale: slow overshooting grow, snappy shrink ----- */

  const activeEntryIndex = config.entries.findIndex(
    (candidate) => candidate.id === displayEntry?.id,
  );

  const targetScaleFor = useCallback(
    (index: number) => {
      const s = state.current;
      const el = logoRefs.current[index];
      const isActive = index === activeEntryIndex;
      const isHovered = Boolean(el?.matches(":hover"));
      if (isActive) return isHovered ? SCALE_ACTIVE_HOVER : SCALE_ACTIVE;
      if (s.engaged && isHovered) return SCALE_HOVER_INACTIVE;
      return SCALE_REST;
    },
    [activeEntryIndex],
  );

  const syncScale = useCallback(
    (index: number) => {
      const s = state.current;
      const el = logoRefs.current[index];
      if (!el) return;
      const target = targetScaleFor(index);
      if (s.scaleTargets[index] === target) return;
      const growing = target > (s.scaleTargets[index] ?? SCALE_REST);
      s.scaleTargets[index] = target;
      s.scaleAnims[index]?.stop();
      const opacity =
        s.engaged && index !== activeEntryIndex
          ? el.matches(":hover")
            ? 0.75
            : 0.45
          : 1;
      if (frameContext.current.fixes.has("css-logos")) {
        el.dataset.labGrow = growing ? "true" : "false";
        el.style.setProperty("--lab-scale", String(target));
        el.style.opacity = String(opacity);
        return;
      }
      const spring = frameContext.current.fixes.has("logo-spring");
      s.scaleAnims[index] = animate(
        el,
        { scale: target, opacity },
        s.reducedMotion
          ? { duration: 0 }
          : spring
            ? growing
              ? { type: "spring", visualDuration: 0.35, bounce: 0.25 }
              : { type: "spring", visualDuration: 0.22, bounce: 0 }
            : growing
              ? { delay: 0.08, duration: 0.55, ease: [...EASE_BACK_IN_OUT] }
              : { duration: 0.28, ease: [...EASE_OUT_STRONG] },
      );
    },
    [activeEntryIndex, targetScaleFor],
  );

  const syncAllScales = useCallback(() => {
    for (let i = 0; i < config.entries.length; i++) syncScale(i);
  }, [config.entries.length, syncScale]);

  const scalesSeeded = useRef(false);
  useLayoutEffect(() => {
    if (!frameContext.current.fixes.has("first-paint")) return;
    if (scalesSeeded.current) return;
    scalesSeeded.current = true;
    const s = state.current;
    for (let i = 0; i < logoRefs.current.length; i++) {
      const el = logoRefs.current[i];
      if (!el) continue;
      const target = targetScaleFor(i);
      s.scaleTargets[i] = target;
      if (frameContext.current.fixes.has("css-logos")) {
        el.style.setProperty("--lab-scale", String(target));
      } else {
        el.style.transform = `scale(${target})`;
      }
      el.style.opacity = "1";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    state.current.scaleTargets = [];
    syncAllScales();
  }, [activeEntryIndex, syncAllScales]);

  /* ----- reduced motion: runtime changes apply immediately ----- */

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      const s = state.current;
      s.reducedMotion = query.matches;
      setReducedMotion(query.matches);
      if (query.matches) {
        // Stop interpolation and overshoot instantly; state stays current.
        s.currentMonth = s.targetMonth;
        for (const anim of s.scaleAnims) anim?.stop();
        s.scaleTargets = [];
        syncAllScales();
        ensureLoop();
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- frame loop: tick magnification + band paint, paused while idle ----- */

  const paintFrame = useCallback(() => {
    const s = state.current;
    const c = frameContext.current;
    const now = performance.now();
    const dt = s.lastFrameAt ? Math.min(64, now - s.lastFrameAt) : 1000 / 60;
    s.lastFrameAt = now;
    const lerp = s.reducedMotion
      ? 1
      : c.fixes.has("refresh-rate")
        ? 1 - Math.pow(1 - 0.22, dt / (1000 / 60))
        : 0.22;
    s.currentMonth += (s.targetMonth - s.currentMonth) * lerp;
    const monthEpsilon = 0.05 / Math.max(1, s.axisLength / c.axis.span);
    if (Math.abs(s.targetMonth - s.currentMonth) < Math.max(0.01, monthEpsilon)) {
      s.currentMonth = s.targetMonth;
    }

    const activeIndex = c.config.entries.findIndex(
      (candidate) => candidate.id === c.activeEntryId,
    );
    const entryIndex = activeIndex >= 0 ? activeIndex : c.config.entries.length - 1;
    const activeEntry = c.config.entries[entryIndex];
    const band = c.visualBands[entryIndex] ?? [0, 1];
    const length = s.axisLength || 1;
    const pxFor = (month: number) =>
      fractionFor(c.axis, month) * length;
    const currentPx = pxFor(s.currentMonth);

    for (let i = 0; i < c.ticks.length; i++) {
      const tick = c.ticks[i];
      const el = tickRefs.current[i];
      if (!el) continue;
      const distance = Math.abs(pxFor(tick.index) - currentPx);
      const magnify = Math.exp(
        -(distance * distance) / (2 * CURSOR_SIGMA * CURSOR_SIGMA),
      );
      const strength = rangeStrength(tick.index, band);
      el.style.transform = c.horizontal
        ? `scaleY(${1 + magnify * 0.85})`
        : `scaleX(${1 + magnify * 0.85})`;
      el.style.opacity = String(0.42 + strength * 0.5 + magnify * 0.08);
      if (strength === 1 && activeEntry) {
        const bandSpan = Math.max(1, band[1] - band[0]);
        const custom = c.getTickColor?.({
          monthIndex: tick.index,
          entry: activeEntry,
          bandFraction: (band[1] - tick.index) / bandSpan,
        });
        el.style.background = custom ?? "var(--stint-accent)";
      } else {
        el.style.background = "";
      }

      if (tick.major) {
        const label = labelRefs.current.get(tick.year);
        if (label) {
          const inBand = tick.index < band[1] && tick.index + 12 > band[0];
          label.style.color = inBand ? "var(--stint-label-active)" : "";
          label.style.opacity = String(0.55 + strength * 0.45 + magnify * 0.15);
        }
      }
    }

    if (s.engaged) {
      const month = Math.min(
        c.axis.lastIndex,
        Math.max(c.axis.firstIndex, Math.floor(s.currentMonth)),
      );
      commitScrubMonth(month);
    }

    if (s.currentMonth === s.targetMonth && !s.engaged) {
      s.running = false;
      s.lastFrameAt = 0;
      return;
    }
    s.raf = requestAnimationFrame(paintFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureLoop = useCallback(() => {
    const s = state.current;
    if (s.running) return;
    s.running = true;
    s.raf = requestAnimationFrame(paintFrame);
  }, [paintFrame]);

  // Commit a scrub month during pointer movement (source: pointer).
  const lastScrubbedMonth = useRef<number | null>(null);
  const commitScrubMonth = useCallback((monthIndex: number) => {
    if (lastScrubbedMonth.current === monthIndex) return;
    lastScrubbedMonth.current = monthIndex;
    const c = frameContext.current;
    const month = indexToMonth(monthIndex);
    const active = resolveActiveEntry(c.config.entries, { month });
    const previous = c.activeEntryId;
    c.propose(active ? { month, entryId: active.id } : { month }, "pointer");
    c.onFeedback?.({ type: "month-change", month, source: "pointer" });
    if (active && previous !== active.id) {
      c.onFeedback?.({
        type: "entry-change",
        month,
        entryId: active.id,
        previousEntryId: previous,
        source: "pointer",
      });
    }
  }, []);

  const [axisPx, setAxisPx] = useState(0);

  // Proposed: measure and paint before the browser's first paint.
  useLayoutEffect(() => {
    if (!frameContext.current.fixes.has("first-paint")) return;
    const el = rulerRef.current;
    if (!el) return;
    const s = state.current;
    s.axisLength = horizontal ? el.offsetWidth : el.offsetHeight;
    cancelAnimationFrame(s.raf);
    s.running = true;
    paintFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizontal]);

  // Measure the ruler's axis length and keep it fresh across resizes.
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const length = horizontal ? rect.width : rect.height;
      state.current.axisLength = length;
      setAxisPx(length);
      ensureLoop();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [horizontal, ensureLoop]);

  // Axis or data changes cancel stale drag geometry and re-sync the cursor.
  useEffect(() => {
    const s = state.current;
    s.dragPointerId = null;
    s.targetMonth = committedMonthIndex + 0.5;
    s.currentMonth = committedMonthIndex + 0.5;
    ensureLoop();
    return () => {
      cancelAnimationFrame(s.raf);
      s.running = false;
      if (s.disengageTimer !== null) clearTimeout(s.disengageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizontal, config]);

  // Keyboard/logo commits move the cursor even while the loop is idle.
  useEffect(() => {
    const s = state.current;
    if (s.engaged || s.dragPointerId !== null) return;
    s.targetMonth = committedMonthIndex + 0.5;
    ensureLoop();
  }, [committedMonthIndex, ensureLoop]);

  /* ----- proposed: keep the cursor inside the scrolled viewport ----- */

  const followedOnce = useRef(false);
  useLayoutEffect(() => {
    if (!frameContext.current.fixes.has("scroll-follow") || !horizontal) return;
    const ruler = rulerRef.current;
    const viewport = ruler?.parentElement;
    if (!ruler || !viewport) return;
    if (viewport.scrollWidth <= viewport.clientWidth) return;
    const s = state.current;
    if (s.dragPointerId !== null) return;
    const x = fractionFor(axis, committedMonthIndex + 0.5) * ruler.offsetWidth;
    const margin = 32;
    const center = x - viewport.clientWidth / 2;
    if (!followedOnce.current) {
      followedOnce.current = true;
      viewport.scrollLeft = center;
      return;
    }
    const left = viewport.scrollLeft;
    if (x < left + margin || x > left + viewport.clientWidth - margin) {
      viewport.scrollTo({
        left: center,
        behavior: s.reducedMotion ? "auto" : "smooth",
      });
    }
  }, [committedMonthIndex, horizontal, axis]);

  /* ----- settled announcements without flooding ----- */

  const rangeText = displayEntry
    ? formatExperienceRange(displayEntry, {
        locale,
        currentLabel: labels?.current ?? "Current",
      })
    : "";
  useEffect(() => {
    if (!displayEntry) return;
    const message = [
      displayEntry.company,
      role?.title,
      rangeText,
    ]
      .filter(Boolean)
      .join(", ");
    const timer = setTimeout(() => setAnnouncement(message), SETTLE_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [displayEntry, role, rangeText]);

  /* ----- engage / disengage ----- */

  const engage = useCallback(
    (source: StintInputSource) => {
      const s = state.current;
      if (s.disengageTimer !== null) {
        clearTimeout(s.disengageTimer);
        s.disengageTimer = null;
      }
      if (!s.engaged) emit({ type: "engage", source });
      s.engaged = true;
      syncAllScales();
      ensureLoop();
    },
    [emit, ensureLoop, syncAllScales],
  );

  const settle = useCallback(
    (source: StintInputSource) => {
      const s = state.current;
      if (s.engagedCount > 0) return;
      if (s.disengageTimer !== null) clearTimeout(s.disengageTimer);
      s.disengageTimer = setTimeout(() => {
        s.disengageTimer = null;
        if (s.engagedCount > 0) return;
        const c = frameContext.current;
        if (!s.engaged) return;
        s.engaged = false;
        emit({ type: "release", source });
        if (c.resetOnLeave) {
          const month = indexToMonth(c.axis.lastIndex);
          const active = resolveActiveEntry(c.config.entries, { month });
          c.propose(active ? { month, entryId: active.id } : { month }, "reset");
          s.targetMonth = c.axis.lastIndex + 0.5;
        } else {
          // Preserve the committed selection; park the cursor on it.
          s.targetMonth = Math.min(
            c.axis.lastIndex + 0.5,
            Math.max(c.axis.firstIndex, s.targetMonth),
          );
        }
        state.current.scaleTargets = [];
        syncAllScales();
        ensureLoop();
      }, DISENGAGE_GRACE_MS);
    },
    [emit, ensureLoop, syncAllScales],
  );

  /* ----- pointer input ----- */

  const pointerToTarget = useCallback((event: ReactPointerEvent) => {
    const el = rulerRef.current;
    const s = state.current;
    const c = frameContext.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollOffset =
      c.horizontal && !c.fixes.has("scrub-offset")
        ? (el.parentElement?.scrollLeft ?? 0)
        : 0;
    const fraction = c.horizontal
      ? (event.clientX - rect.left + scrollOffset) / Math.max(1, rect.width)
      : 1 - (event.clientY - rect.top) / Math.max(1, rect.height);
    const month = c.axis.min + fraction * c.axis.span;
    s.targetMonth = Math.min(
      c.axis.lastIndex + 1,
      Math.max(c.axis.firstIndex, month),
    );
    ensureLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScrubMove = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      if (
        event.pointerType !== "mouse" &&
        s.dragPointerId === null
      ) {
        return;
      }
      pointerToTarget(event);
    },
    [pointerToTarget],
  );

  const onScrubDown = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      // Nested drawers and sheets must not claim a timeline scrub gesture.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      s.dragPointerId = event.pointerId;
      s.lastPointerType = event.pointerType;
      engage("pointer");
      pointerToTarget(event);
    },
    [engage, pointerToTarget],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      if (s.dragPointerId !== event.pointerId) return;
      s.dragPointerId = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Touch/pen have no lingering hover; settle on lift while mouse waits
      // for the zone leave event.
      if (event.pointerType !== "mouse") {
        s.engagedCount = 0;
        settle("pointer");
      }
    },
    [settle],
  );

  const isTouchLike = (type: string) => type === "touch" || type === "pen";

  const onZoneEnter = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      s.lastPointerType = event.pointerType;
      if (!isTouchLike(event.pointerType)) {
        s.engagedCount++;
        engage("pointer");
      }
    },
    [engage],
  );

  const onZoneLeave = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      s.lastPointerType = event.pointerType;
      if (!isTouchLike(event.pointerType)) {
        s.engagedCount = Math.max(0, s.engagedCount - 1);
        if (s.dragPointerId === null) settle("pointer");
      }
    },
    [settle],
  );

  /* ----- keyboard input ----- */

  const moveSelection = useCallback(
    (delta: number | "first" | "last") => {
      const c = frameContext.current;
      const current = state.current;
      const committed = Math.min(
        c.axis.lastIndex,
        Math.max(c.axis.firstIndex, Math.floor(current.targetMonth)),
      );
      const next =
        delta === "first"
          ? c.axis.firstIndex
          : delta === "last"
            ? c.axis.lastIndex
            : Math.min(
                c.axis.lastIndex,
                Math.max(c.axis.firstIndex, committed + delta),
              );
      const month = indexToMonth(next);
      const active = resolveActiveEntry(c.config.entries, { month });
      const previous = c.activeEntryId;
      c.propose(active ? { month, entryId: active.id } : { month }, "keyboard");
      current.targetMonth = next + 0.5;
      ensureLoop();
      if (active && previous !== active.id) {
        c.onFeedback?.({
          type: "entry-change",
          month,
          entryId: active.id,
          previousEntryId: previous,
          source: "keyboard",
        });
      }
    },
    [ensureLoop],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const c = frameContext.current;
      // Arrows follow the visual axis; Page/Home/End follow logical time.
      const forwardKeys = c.horizontal
        ? ["ArrowRight", "ArrowUp"]
        : ["ArrowUp", "ArrowLeft"];
      const backKeys = c.horizontal
        ? ["ArrowLeft", "ArrowDown"]
        : ["ArrowDown", "ArrowRight"];
      if (forwardKeys.includes(event.key)) {
        moveSelection(1);
      } else if (backKeys.includes(event.key)) {
        moveSelection(-1);
      } else if (event.key === "PageUp") {
        moveSelection(KEYBOARD_PAGE_MONTHS);
      } else if (event.key === "PageDown") {
        moveSelection(-KEYBOARD_PAGE_MONTHS);
      } else if (event.key === "Home") {
        moveSelection("first");
      } else if (event.key === "End") {
        moveSelection("last");
      } else {
        return;
      }
      event.preventDefault();
    },
    [moveSelection],
  );

  /* ----- proposed: soften readout swaps ----- */

  const liveLayerRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLSpanElement>(null);
  const shownEntryId = useRef(displayEntry?.id);
  const shownRoleId = useRef(role?.id);
  useLayoutEffect(() => {
    const previousEntry = shownEntryId.current;
    const previousRole = shownRoleId.current;
    shownEntryId.current = displayEntry?.id;
    shownRoleId.current = role?.id;
    if (!frameContext.current.fixes.has("readout-swap")) return;
    if (state.current.reducedMotion) return;
    const swapIn: Keyframe[] = [
      { opacity: 0, filter: "blur(3px)", translate: "0 4px" },
      { opacity: 1, filter: "blur(0px)", translate: "0 0" },
    ];
    const timing = { duration: 180, easing: `cubic-bezier(${EASE_OUT_STRONG.join(",")})` };
    if (previousEntry !== displayEntry?.id && liveLayerRef.current) {
      liveLayerRef.current.animate(swapIn, timing);
    } else if (previousRole !== role?.id && roleRef.current) {
      roleRef.current.animate(swapIn, timing);
    }
  }, [displayEntry?.id, role?.id]);

  /* ----- proposed: thin year labels to the space available ----- */

  const labelStride = useMemo(() => {
    if (!has("year-labels") || axisPx === 0) return 1;
    const pxPerYear = (axisPx / axis.span) * 12;
    const minGap = horizontal ? 44 : 20;
    return [1, 2, 5, 10, 20, 50].find((n) => n * pxPerYear >= minGap) ?? 50;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixes, axisPx, axis.span, horizontal]);

  /* ----- rendering ----- */

  const isCurrent = Boolean(displayEntry?.isCurrent);
  const currentLabelText = labels?.current ?? "Current";
  const monthText = selection
    ? formatMonth(selection.month, { locale, style: "long" })
    : "";
  const valueText = [
    monthText,
    displayEntry?.company,
    role?.title,
  ]
    .filter(Boolean)
    .join(" — ");

  const defaultLogo = (context: StintLogoContext) => (
    <span aria-hidden="true" className="stint__logoFallback">
      {context.entry.company.slice(0, 1).toUpperCase()}
    </span>
  );
  const renderLogo = slots?.logo ?? defaultLogo;

  const atOldest = committedMonthIndex <= axis.firstIndex;
  const atNewest = committedMonthIndex >= axis.lastIndex;

  const renderBody = (
    bodyEntry: NormalizedStintExperience,
    bodyRole: NormalizedStintRole | null,
    live: boolean,
  ) => (
    <>
      <span
        className={cx("stint__currentLabel", classNames?.currentLabel)}
        data-visible={
          (live ? isCurrent || has("month-pill") : bodyEntry.isCurrent) || undefined
        }
        aria-hidden={live && !has("month-pill") ? !isCurrent : true}
      >
        {has("month-pill") ? (
          <span className="stint__currentBadge lab-monthPill">
            {live
              ? atNewest && isCurrent
                ? currentLabelText
                : formatMonth(selection?.month ?? indexToMonth(axis.lastIndex), { locale })
              : "Sep 0000"}
          </span>
        ) : (
          slots?.currentLabel?.({ entry: bodyEntry }) ?? (
            <span className="stint__currentBadge">{currentLabelText}</span>
          )
        )}
      </span>
      <span className="stint__readoutLogo">
        {renderLogo({ entry: bodyEntry, isActive: true, size: 48 })}
      </span>
      <span className="stint__company">{bodyEntry.company}</span>
      <span ref={live ? roleRef : undefined} className="stint__role">
        {bodyRole?.title ?? ""}
      </span>
      {bodyEntry.location ? (
        <span className="stint__location">{bodyEntry.location}</span>
      ) : (
        <span className="stint__location stint__location--range">
          {live
            ? rangeText
            : formatExperienceRange(bodyEntry, {
                locale,
                currentLabel: currentLabelText,
              })}
        </span>
      )}
    </>
  );
  const readoutBody = displayEntry ? renderBody(displayEntry, role, true) : null;
  const reserveReadout = has("reserve-readout");
  const sizers = reserveReadout
    ? config.entries.flatMap((sizerEntry) =>
        (sizerEntry.roles.length > 0 ? sizerEntry.roles : [null]).map(
          (sizerRole) => (
            <div
              key={`${sizerEntry.id}:${sizerRole?.id ?? ""}`}
              className="lab-layer lab-sizer"
              aria-hidden="true"
              inert
            >
              {renderBody(sizerEntry, sizerRole, false)}
            </div>
          ),
        ),
      )
    : null;

  const liveReadout = displayEntry ? (
    <div ref={liveLayerRef} className="lab-layer">
      {slots?.readout
        ? slots.readout({
            entry: displayEntry,
            role,
            month: selection?.month ?? indexToMonth(axis.lastIndex),
            isCurrent,
            formattedRange: rangeText,
            children: readoutBody,
          })
        : readoutBody}
    </div>
  ) : null;
  const readout = displayEntry ? (
    <div className={cx("stint__readout", classNames?.readout)}>
      {reserveReadout ? (
        <div className="lab-stack">
          {sizers}
          {liveReadout}
        </div>
      ) : (
        liveReadout
      )}
    </div>
  ) : null;


  return (
    <div
      ref={containerRef}
      className={cx("stint", className, classNames?.root)}
      style={style}
      data-orientation={orientation}
      data-axis={resolved}
      data-reduced-motion={reducedMotion || undefined}
      {...Object.fromEntries([...fixes].map((id) => [`data-lab-${id}`, ""]))}
      onPointerEnter={onZoneEnter}
      onPointerLeave={onZoneLeave}
    >
      {readout}

      {/* Rail and ruler share a horizontal viewport so a narrow host never
          compresses calendar labels into each other. */}
      <div className="stint__timeline">
        {/* Logo rail — marks where each entry sits on the timeline */}
        <div
          className={cx("stint__rail", classNames?.rail)}
          onPointerMove={onScrubMove}
          onPointerDown={onScrubDown}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {config.entries.map((railEntry, index) => (
            <div
              key={railEntry.id}
              className="stint__logoShell"
              style={
                {
                  "--stint-p": fractionFor(
                    axis,
                    (railEntry.startIndex + railEntry.endIndexExclusive) / 2,
                  ),
                } as CSSProperties
              }
            >
              <button
                ref={(el) => {
                  logoRefs.current[index] = el;
                }}
                type="button"
                className={cx("stint__logo", classNames?.logo)}
                data-active={railEntry.id === displayEntry?.id || undefined}
                aria-label={`${railEntry.company}, ${formatExperienceRange(railEntry, { locale, currentLabel: currentLabelText })}`}
                aria-pressed={railEntry.id === displayEntry?.id}
                onClick={() => {
                  const mid = Math.floor(
                    (railEntry.startIndex + railEntry.endIndexExclusive - 1) / 2,
                  );
                  const month = indexToMonth(mid);
                  const previous = frameContext.current.activeEntryId;
                  propose({ month, entryId: railEntry.id }, "logo");
                  state.current.targetMonth = mid + 0.5;
                  ensureLoop();
                  if (previous !== railEntry.id) {
                    emit({
                      type: "entry-change",
                      month,
                      entryId: railEntry.id,
                      previousEntryId: previous,
                      source: "logo",
                    });
                  }
                }}
                onPointerEnter={() => syncScale(index)}
                onPointerLeave={() => syncScale(index)}
              >
                {renderLogo({
                  entry: railEntry,
                  isActive: railEntry.id === displayEntry?.id,
                  size: 30,
                })}
              </button>
            </div>
          ))}
        </div>

        {/* Ruler — the slider surface */}
        <div
          ref={rulerRef}
          role="slider"
          tabIndex={0}
          aria-label={labels?.slider ?? "Scrub through work experience by month"}
          aria-valuemin={0}
          aria-valuemax={axis.lastIndex - axis.firstIndex}
          aria-valuenow={committedMonthIndex - axis.firstIndex}
          aria-valuetext={valueText}
          aria-orientation={resolved}
          className={cx("stint__ruler", classNames?.ruler)}
          data-at-oldest={atOldest || undefined}
          data-at-newest={atNewest || undefined}
          onPointerMove={onScrubMove}
          onPointerDown={onScrubDown}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onFocus={() => engage("keyboard")}
          onBlur={() => {
            state.current.engagedCount = 0;
            if (!isTouchLike(state.current.lastPointerType)) settle("keyboard");
          }}
          onKeyDown={onKeyDown}
        >
          <div className="stint__tickField" aria-hidden="true">
            {ticks.map((tick, index) => (
              <div key={tick.index} className="stint__tickGroup">
                <div
                  ref={(el) => {
                    tickRefs.current[index] = el;
                  }}
                  className={cx("stint__tick", classNames?.tick)}
                  data-major={tick.major || undefined}
                  style={{ "--stint-p": tick.fraction } as CSSProperties}
                />
                {tick.major && tick.year % labelStride === 0 && (
                  <span
                    ref={(el) => {
                      if (el) labelRefs.current.set(tick.year, el);
                      else labelRefs.current.delete(tick.year);
                    }}
                    className={cx("stint__tickLabel", classNames?.tickLabel)}
                    style={{ "--stint-p": tick.fraction } as CSSProperties}
                  >
                    {tick.year}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Settled announcements for assistive technology */}
      <div
        role="status"
        aria-live="polite"
        className={cx("stint__status", classNames?.status)}
      >
        {slots?.status?.({ message: announcement }) ?? announcement}
      </div>
    </div>
  );
}
