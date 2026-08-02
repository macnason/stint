"use client";

import { useEffect, useState } from "react";

import { isMonthString } from "./timeline.js";
import type { CurrentMonthMode, MonthString } from "./types.js";

const MAX_TIMEOUT = 2 ** 31 - 1;

/** The YYYY-MM month for a timestamp as observed in an IANA timezone. */
export function monthInTimeZone(
  timeZone: string,
  at: number = Date.now(),
): MonthString {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(at));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const value = `${year.padStart(4, "0")}-${month}`;
  if (!isMonthString(value)) {
    throw new RangeError(`Could not resolve a month in time zone ${timeZone}`);
  }
  return value;
}

/**
 * Binary-search the UTC timestamp of the next month rollover as observed in
 * the given timezone, to one-minute precision.
 */
function nextRolloverAt(timeZone: string, from: number): number {
  const startMonth = monthInTimeZone(timeZone, from);
  let low = from;
  // 35 days always crosses at least one month boundary.
  let high = from + 35 * 24 * 60 * 60 * 1000;
  while (high - low > 60 * 1000) {
    const mid = low + (high - low) / 2;
    if (monthInTimeZone(timeZone, mid) === startMonth) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * Resolves the reference month for a `CurrentMonthMode`. Fixed mode is fully
 * deterministic and never schedules anything. Live mode starts from the
 * SSR-provided seed when present (so hydration matches the server) and rolls
 * forward at each month boundary in the configured timezone.
 */
export function useCurrentMonth(
  mode: CurrentMonthMode | undefined,
): MonthString {
  const live = !mode || mode.mode === "live";
  const timeZone = (live && mode?.mode === "live" && mode.timeZone) || "UTC";
  const seed =
    mode?.mode === "fixed"
      ? mode.month
      : mode?.initialMonth ?? monthInTimeZone(timeZone);
  const [month, setMonth] = useState<MonthString>(seed);

  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const arm = () => {
      if (cancelled) return;
      // Roll forward immediately if the seed is behind the actual month.
      const actual = monthInTimeZone(timeZone);
      setMonth((previous) => (previous === actual ? previous : actual));
      const target = nextRolloverAt(timeZone, Date.now());
      const wait = Math.max(1000, target - Date.now());
      timer = setTimeout(arm, Math.min(wait, MAX_TIMEOUT));
    };

    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live, timeZone]);

  if (mode?.mode === "fixed") return mode.month;
  return month;
}
