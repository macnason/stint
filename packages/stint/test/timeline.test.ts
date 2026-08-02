import { describe, expect, it } from "vitest";

import { normalizeStintConfig } from "../src/schema";
import {
  addMonths,
  deriveTimelineBounds,
  formatExperienceRange,
  formatMonth,
  getOverlapCandidates,
  indexToMonth,
  monthRange,
  monthToIndex,
  reconcileSelection,
  resolveActiveEntry,
  roleAt,
} from "../src/timeline";
import type {
  NormalizedStintConfig,
  StintSelection,
} from "../src/types";
import { makeConfig, referenceMonth } from "./fixtures";

function normalize(entries = makeConfig().entries): NormalizedStintConfig {
  const result = normalizeStintConfig(
    { schemaVersion: 1, entries },
    { referenceMonth },
  );
  expect(result.errors).toEqual([]);
  return result.config!;
}

describe("month utilities", () => {
  it("converts, offsets, ranges, and formats ISO months at year boundaries", () => {
    expect(monthToIndex("2024-12")).toBe(2024 * 12 + 11);
    expect(indexToMonth(2025 * 12)).toBe("2025-01");
    expect(addMonths("2024-12", 1)).toBe("2025-01");
    expect(monthRange("2024-11", "2025-02")).toEqual([
      "2024-11",
      "2024-12",
      "2025-01",
    ]);
    expect(formatMonth("2025-06", { style: "short" })).toBe("Jun 2025");
    expect(() => monthToIndex("2025-00")).toThrow(/YYYY-MM/);
    expect(() => indexToMonth(10_000 * 12)).toThrow(/four-digit year/);
  });

  it("derives inclusive selected bounds and display ranges from exclusive ends", () => {
    const config = normalize();

    expect(deriveTimelineBounds(config.entries)).toEqual({
      start: "2023-01",
      end: "2025-07",
      firstSelectedMonth: "2023-01",
      lastSelectedMonth: "2025-06",
      startIndex: 2023 * 12,
      endIndexExclusive: 2025 * 12 + 6,
    });
    expect(formatExperienceRange(config.entries[0])).toBe(
      "Jan 2023–Dec 2023",
    );
    expect(
      formatExperienceRange(config.entries[1], { currentLabel: "Now" }),
    ).toBe("Jan 2024–Now");
  });
});

describe("timeline resolution", () => {
  const overlappingEntries = [
    {
      id: "source-first",
      company: "Source First",
      start: "2024-01",
      end: "2025-01",
      priority: 1,
      presentationId: "source-first",
      roles: [{ id: "first-role", title: "Designer", start: "2024-01" }],
    },
    {
      id: "latest",
      company: "Latest",
      start: "2024-06",
      end: "2025-01",
      priority: 1,
      presentationId: "latest",
      roles: [
        { id: "latest-role", title: "Senior Designer", start: "2024-06" },
      ],
    },
    {
      id: "priority",
      company: "Priority",
      start: "2024-02",
      end: "2025-01",
      priority: 3,
      presentationId: "priority",
      roles: [{ id: "priority-role", title: "Lead", start: "2024-02" }],
    },
    {
      id: "source-second",
      company: "Source Second",
      start: "2024-01",
      end: "2025-01",
      priority: 1,
      presentationId: "source-second",
      roles: [{ id: "second-role", title: "Designer", start: "2024-01" }],
    },
  ] as const;

  it("preserves all overlap candidates and resolves priority, latest start, then source order", () => {
    const config = normalize([...overlappingEntries]);
    const candidates = getOverlapCandidates(config.entries, "2024-07");

    expect(candidates.map(({ id }) => id)).toEqual([
      "priority",
      "latest",
      "source-first",
      "source-second",
    ]);
    expect(resolveActiveEntry(config.entries, { month: "2024-07" })?.id).toBe(
      "priority",
    );
    expect(
      resolveActiveEntry(config.entries, {
        month: "2024-07",
        entryId: "source-second",
      })?.id,
    ).toBe("source-second");
    expect(
      Object.fromEntries(
        config.entries.map(({ id, start, end }) => [id, [start, end]]),
      ),
    ).toEqual(
      Object.fromEntries(
        overlappingEntries.map(({ id, start, end }) => [id, [start, end]]),
      ),
    );
  });

  it("derives the active role at exact promotion boundaries", () => {
    const entry = normalize().entries[0];

    expect(roleAt(entry, "2023-06")?.id).toBe("north-star-designer");
    expect(roleAt(entry, "2023-07")?.id).toBe("north-star-senior");
    expect(roleAt(entry, "2024-01")).toBeNull();
  });
});

describe("selection reconciliation", () => {
  it("retains a stable controlled selection when entries reorder", () => {
    const previousConfig = normalize();
    const nextConfig = normalize([...makeConfig().entries].reverse());

    expect(
      reconcileSelection(
        { month: "2024-05", entryId: "field-notes" },
        nextConfig,
        { previousConfig },
      ),
    ).toMatchObject({
      selection: { month: "2024-05", entryId: "field-notes" },
      reason: "retain",
      changes: { month: false, entry: false, role: false },
    });
  });

  it("resets a removed overlap choice to the deterministic candidate", () => {
    const previousConfig = normalize([
      ...makeConfig().entries,
      {
        id: "side-project",
        company: "Side Project",
        start: "2024-03",
        end: "2024-09",
        priority: 0,
        presentationId: "side-project",
        roles: [
          { id: "side-role", title: "Advisor", start: "2024-03" },
        ],
      },
    ]);
    const nextConfig = normalize();

    expect(
      reconcileSelection(
        { month: "2024-05", entryId: "side-project" },
        nextConfig,
        { previousConfig },
      ),
    ).toMatchObject({
      selection: { month: "2024-05", entryId: "field-notes" },
      reason: "reset",
      cause: "entry-unavailable",
      changes: { month: false, entry: true, role: true },
    });
  });

  it("clamps a selection after a shortened dataset and reports active changes", () => {
    const previousConfig = normalize();
    const shortened = makeConfig().entries.map((entry) =>
      entry.id === "field-notes" ? { ...entry, end: "2025-01" } : entry,
    );
    const nextConfig = normalize(shortened);

    expect(
      reconcileSelection(
        { month: "2025-05", entryId: "field-notes" },
        nextConfig,
        { previousConfig },
      ),
    ).toMatchObject({
      selection: { month: "2024-12", entryId: "field-notes" },
      reason: "clamp",
      cause: "after-bounds",
      changes: { month: true, entry: false, role: false },
    });
  });

  it("resets an absent value to the latest selected month", () => {
    const config = normalize();

    expect(reconcileSelection(null, config)).toMatchObject({
      selection: { month: "2025-06", entryId: "field-notes" },
      reason: "reset",
      cause: "missing-selection",
    });
  });

  it("resets a malformed persisted month without resolving it first", () => {
    const config = normalize();
    const malformedSelection = {
      month: "2025-99",
      entryId: "field-notes",
    } as unknown as StintSelection;

    expect(reconcileSelection(malformedSelection, config)).toMatchObject({
      selection: { month: "2025-06", entryId: "field-notes" },
      reason: "reset",
      cause: "invalid-month",
      changes: { month: true, entry: true, role: true },
    });
  });

  it("handles a malformed persisted month when the dataset is empty", () => {
    const config = normalize([]);
    const malformedSelection = {
      month: "not-a-month",
      entryId: "missing",
    } as unknown as StintSelection;

    expect(reconcileSelection(malformedSelection, config)).toEqual({
      selection: null,
      reason: "reset",
      cause: "empty-data",
      changes: { month: true, entry: false, role: false },
    });
  });

  it("reports active identity changes when falling back to empty data", () => {
    const previousConfig = normalize();
    const config = normalize([]);

    expect(
      reconcileSelection(
        { month: "2024-05", entryId: "field-notes" },
        config,
        { previousConfig },
      ),
    ).toEqual({
      selection: null,
      reason: "reset",
      cause: "empty-data",
      changes: { month: true, entry: true, role: true },
    });
  });

  it("falls back to the first active entry when clamping before bounds", () => {
    const config = normalize();

    expect(
      reconcileSelection(
        { month: "2022-12", entryId: "field-notes" },
        config,
      ),
    ).toEqual({
      selection: { month: "2023-01", entryId: "north-star" },
      reason: "clamp",
      cause: "before-bounds",
      changes: { month: true, entry: true, role: true },
    });
  });

  it("preserves an in-range month that has no active entry", () => {
    const entriesWithGap = makeConfig().entries.map((entry) =>
      entry.id === "field-notes"
        ? {
            ...entry,
            start: "2024-03" as const,
            roles: entry.roles.map((role) => ({
              ...role,
              start: "2024-03" as const,
            })),
          }
        : entry,
    );
    const config = normalize(entriesWithGap);

    expect(reconcileSelection({ month: "2024-02" }, config)).toEqual({
      selection: { month: "2024-02" },
      reason: "retain",
      cause: "selection-valid",
      changes: { month: false, entry: false, role: false },
    });
  });
});
