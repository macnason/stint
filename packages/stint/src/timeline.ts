import type {
  MonthString,
  NormalizedStintConfig,
  NormalizedStintExperience,
  NormalizedStintRole,
  ReconcileSelectionOptions,
  ReconciliationResult,
  StintSelection,
  TimelineBounds,
} from "./types.js";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthString(value: unknown): value is MonthString {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

export function monthToIndex(month: MonthString | string): number {
  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    throw new RangeError(`Expected an ISO YYYY-MM month, received ${month}`);
  }

  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function indexToMonth(index: number): MonthString {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError(`Expected a non-negative integer month index, received ${index}`);
  }
  if (index >= 10_000 * 12) {
    throw new RangeError(
      `Expected a month index within the four-digit year range, received ${index}`,
    );
  }

  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}` as MonthString;
}

export function addMonths(month: MonthString, amount: number): MonthString {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Expected an integer month offset, received ${amount}`);
  }
  return indexToMonth(monthToIndex(month) + amount);
}

export function monthRange(
  start: MonthString,
  endExclusive: MonthString,
): MonthString[] {
  const startIndex = monthToIndex(start);
  const endIndex = monthToIndex(endExclusive);
  if (endIndex < startIndex) {
    throw new RangeError("End month must not precede start month");
  }

  return Array.from({ length: endIndex - startIndex }, (_, offset) =>
    indexToMonth(startIndex + offset),
  );
}

export interface FormatMonthOptions {
  locale?: string;
  style?: "short" | "long" | "numeric";
}

export function formatMonth(
  month: MonthString,
  { locale = "en", style = "short" }: FormatMonthOptions = {},
): string {
  const index = monthToIndex(month);
  const year = Math.floor(index / 12);
  const monthIndex = index % 12;
  const monthStyle = style === "numeric" ? "2-digit" : style;

  return new Intl.DateTimeFormat(locale, {
    month: monthStyle,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export function deriveTimelineBounds(
  entries: readonly NormalizedStintExperience[],
): TimelineBounds | null {
  if (entries.length === 0) return null;

  let startIndex = entries[0]!.startIndex;
  let endIndexExclusive = entries[0]!.endIndexExclusive;
  for (const entry of entries.slice(1)) {
    startIndex = Math.min(startIndex, entry.startIndex);
    endIndexExclusive = Math.max(endIndexExclusive, entry.endIndexExclusive);
  }

  return {
    start: indexToMonth(startIndex),
    end: indexToMonth(endIndexExclusive),
    firstSelectedMonth: indexToMonth(startIndex),
    lastSelectedMonth: indexToMonth(endIndexExclusive - 1),
    startIndex,
    endIndexExclusive,
  };
}

export interface FormatExperienceRangeOptions extends FormatMonthOptions {
  currentLabel?: string;
}

export function deriveCurrentLabel(
  entry: NormalizedStintExperience,
  currentLabel = "Current",
): string | null {
  return entry.isCurrent ? currentLabel : null;
}

export function formatExperienceRange(
  entry: NormalizedStintExperience,
  options: FormatExperienceRangeOptions = {},
): string {
  const { currentLabel = "Current", ...monthOptions } = options;
  const start = formatMonth(entry.start, monthOptions);
  const end = entry.isCurrent
    ? currentLabel
    : formatMonth(indexToMonth(entry.endIndexExclusive - 1), monthOptions);
  return `${start}–${end}`;
}

export function entryContainsMonth(
  entry: NormalizedStintExperience,
  month: MonthString,
): boolean {
  return entryContainsIndex(entry, monthToIndex(month));
}

function entryContainsIndex(
  entry: NormalizedStintExperience,
  index: number,
): boolean {
  return index >= entry.startIndex && index < entry.endIndexExclusive;
}

function compareCandidates(
  left: NormalizedStintExperience,
  right: NormalizedStintExperience,
): number {
  return (
    right.priority - left.priority ||
    right.startIndex - left.startIndex ||
    left.sourceOrder - right.sourceOrder
  );
}

export function getOverlapCandidates(
  entries: readonly NormalizedStintExperience[],
  month: MonthString,
): NormalizedStintExperience[] {
  const index = monthToIndex(month);
  return entries
    .filter((entry) => entryContainsIndex(entry, index))
    .sort(compareCandidates);
}

export function selectEntryById(
  entries: readonly NormalizedStintExperience[],
  month: MonthString,
  entryId: string,
): NormalizedStintExperience | null {
  const index = monthToIndex(month);
  return entries.find(
    (entry) => entry.id === entryId && entryContainsIndex(entry, index),
  ) ?? null;
}

export function resolveActiveEntry(
  entries: readonly NormalizedStintExperience[],
  selection: StintSelection,
): NormalizedStintExperience | null {
  const index = monthToIndex(selection.month);
  if (selection.entryId) {
    const selected = entries.find(
      (entry) =>
        entry.id === selection.entryId && entryContainsIndex(entry, index),
    );
    if (selected) return selected;
  }

  let active: NormalizedStintExperience | null = null;
  for (const entry of entries) {
    if (
      entryContainsIndex(entry, index) &&
      (!active || compareCandidates(entry, active) < 0)
    ) {
      active = entry;
    }
  }
  return active;
}

export function roleAt(
  entry: NormalizedStintExperience,
  month: MonthString,
): NormalizedStintRole | null {
  if (!entryContainsMonth(entry, month)) return null;
  const index = monthToIndex(month);

  for (let roleIndex = entry.roles.length - 1; roleIndex >= 0; roleIndex -= 1) {
    const role = entry.roles[roleIndex];
    if (index >= role.startIndex && index < role.endIndexExclusive) return role;
  }
  return null;
}

function activeIdentity(
  config: NormalizedStintConfig | undefined,
  selection: StintSelection | null,
): { entryId?: string; roleId?: string } {
  if (!config || !selection || !isMonthString(selection.month)) return {};
  const entry = resolveActiveEntry(config.entries, selection);
  return {
    entryId: entry?.id,
    roleId: entry ? roleAt(entry, selection.month)?.id : undefined,
  };
}

export function reconcileSelection(
  selection: StintSelection | null | undefined,
  config: NormalizedStintConfig,
  { previousConfig }: ReconcileSelectionOptions = {},
): ReconciliationResult {
  const before = activeIdentity(previousConfig ?? config, selection ?? null);
  if (!config.bounds) {
    return {
      selection: null,
      reason: "reset",
      cause: "empty-data",
      changes: {
        month: selection !== null && selection !== undefined,
        entry: before.entryId !== undefined,
        role: before.roleId !== undefined,
      },
    };
  }

  let reason: ReconciliationResult["reason"] = "retain";
  let cause: ReconciliationResult["cause"] = "selection-valid";
  let month: MonthString;

  if (!selection) {
    reason = "reset";
    cause = "missing-selection";
    month = config.bounds.lastSelectedMonth;
  } else if (!isMonthString(selection.month)) {
    reason = "reset";
    cause = "invalid-month";
    month = config.bounds.lastSelectedMonth;
  } else {
    const index = monthToIndex(selection.month);
    if (index < config.bounds.startIndex) {
      reason = "clamp";
      cause = "before-bounds";
      month = config.bounds.firstSelectedMonth;
    } else if (index >= config.bounds.endIndexExclusive) {
      reason = "clamp";
      cause = "after-bounds";
      month = config.bounds.lastSelectedMonth;
    } else {
      month = selection.month;
    }
  }

  const requestedEntry = selection?.entryId
    ? selectEntryById(config.entries, month, selection.entryId)
    : undefined;

  if (selection?.entryId && !requestedEntry && reason === "retain") {
    reason = "reset";
    cause = "entry-unavailable";
  }

  const entry = requestedEntry ?? resolveActiveEntry(config.entries, { month });
  const nextSelection: StintSelection = entry
    ? { month, entryId: entry.id }
    : { month };
  const after = activeIdentity(config, nextSelection);

  return {
    selection: nextSelection,
    reason,
    cause,
    changes: {
      month: selection?.month !== month,
      entry: before.entryId !== after.entryId,
      role: before.roleId !== after.roleId,
    },
  };
}
