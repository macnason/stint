import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STINT_SCHEMA_VERSION,
  normalizeStintConfig,
  validateStintConfig,
} from "../src/schema";
import { makeConfig, referenceMonth } from "./fixtures";

describe("canonical Stint schema", () => {
  it("normalizes a versioned config without mutating or sharing source data", () => {
    const input = makeConfig({
      entries: [...makeConfig().entries].reverse(),
    });
    const snapshot = structuredClone(input);

    const result = normalizeStintConfig(input, { referenceMonth });

    expect(result.errors).toEqual([]);
    expect(result.config?.schemaVersion).toBe(STINT_SCHEMA_VERSION);
    expect(result.config?.entries.map(({ id }) => id)).toEqual([
      "north-star",
      "field-notes",
    ]);
    expect(result.config?.entries.map(({ sourceOrder }) => sourceOrder)).toEqual([
      1, 0,
    ]);
    expect(result.config?.entries[1]).toMatchObject({
      end: null,
      endIndexExclusive: 2025 * 12 + 6,
      isCurrent: true,
    });
    expect(input).toEqual(snapshot);
    expect(result.config?.entries).not.toBe(input.entries);
    expect(result.config?.entries[0].roles).not.toBe(input.entries[1].roles);
  });

  it("accepts an empty config and derives no bounds", () => {
    const result = normalizeStintConfig(
      { schemaVersion: 1, entries: [] },
      { referenceMonth },
    );

    expect(result).toMatchObject({
      config: { schemaVersion: 1, entries: [], bounds: null },
      diagnostics: [],
      errors: [],
      warnings: [],
    });
  });

  it("normalizes a single closed entry with an exclusive end boundary", () => {
    const result = normalizeStintConfig(
      { schemaVersion: 1, entries: [makeConfig().entries[0]] },
      { referenceMonth },
    );

    expect(result.errors).toEqual([]);
    expect(result.config?.bounds).toMatchObject({
      firstSelectedMonth: "2023-01",
      lastSelectedMonth: "2023-12",
      end: "2024-01",
    });
  });

  it("rejects malformed months, duplicate stable IDs, empty roles and titles, and invalid spans at stable paths", () => {
    const result = validateStintConfig(
      {
        schemaVersion: 1,
        entries: [
          {
            id: "duplicate",
            company: "One",
            start: "2024-1",
            end: "2024-01",
            roles: [],
          },
          {
            id: "duplicate",
            company: "Two",
            start: "2024-03",
            end: "2024-03",
            roles: [
              { id: "same-role", title: "", start: "2024-02" },
              { id: "same-role", title: "Designer", start: "2025-13" },
            ],
          },
        ],
      },
      { referenceMonth },
    );

    expect(result.errors.map(({ code, path }) => [code, path])).toEqual([
      ["invalid-month", "entries[0].start"],
      ["empty-roles", "entries[0].roles"],
      ["duplicate-entry-id", "entries[1].id"],
      ["invalid-entry-span", "entries[1].end"],
      ["empty-role-title", "entries[1].roles[0].title"],
      ["role-outside-entry", "entries[1].roles[0].start"],
      ["duplicate-role-id", "entries[1].roles[1].id"],
      ["invalid-month", "entries[1].roles[1].start"],
    ]);
    expect(result.config).toBeNull();
  });

  it("reports gaps, overlaps, multiple current entries, future entries, and missing presentation references as warnings", () => {
    const result = normalizeStintConfig(
      {
        schemaVersion: 1,
        entries: [
          {
            id: "current-a",
            company: "Current A",
            start: "2025-01",
            end: null,
            roles: [{ id: "a-role", title: "Designer", start: "2025-01" }],
          },
          {
            id: "current-b",
            company: "Current B",
            start: "2025-03",
            end: null,
            presentationId: "b-mark",
            roles: [{ id: "b-role", title: "Designer", start: "2025-03" }],
          },
          {
            id: "future",
            company: "Future Co",
            start: "2026-01",
            end: "2026-04",
            presentationId: "future-mark",
            roles: [
              { id: "future-role", title: "Designer", start: "2026-01" },
            ],
          },
        ],
      },
      { referenceMonth },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings.map(({ code, path }) => [code, path])).toEqual([
      ["missing-presentation", "entries[0].presentationId"],
      ["future-entry", "entries[2].start"],
      ["multiple-current-entries", "entries"],
      ["overlap", "entries[1]"],
      ["gap", "entries[2]"],
    ]);
  });

  it("rejects unknown or mistyped fields before generated TypeScript is written", () => {
    const result = validateStintConfig(
      {
        schemaVersion: 1,
        entries: [
          {
            id: "strict-entry",
            company: "Strict Co",
            start: "2024-01",
            end: "2025-01",
            priority: "high",
            href: "https://example.invalid",
            roles: [
              {
                id: "strict-role",
                title: "Designer",
                start: "2024-01",
                end: "2025-01",
              },
            ],
          },
        ],
        privateNotes: true,
      },
      { referenceMonth },
    );

    expect(result.errors.map(({ code, path }) => [code, path])).toEqual([
      ["invalid-config", "privateNotes"],
      ["invalid-config", "entries[0].href"],
      ["invalid-config", "entries[0].priority"],
      ["invalid-config", "entries[0].roles[0].end"],
    ]);
    expect(result.config).toBeNull();
  });

  it("rejects reversed spans and role starts outside an otherwise valid employer span", () => {
    const result = validateStintConfig(
      {
        schemaVersion: 1,
        entries: [
          {
            id: "reversed",
            company: "Reversed",
            start: "2025-04",
            end: "2025-01",
            presentationId: "reversed",
            roles: [
              { id: "reversed-role", title: "Designer", start: "2025-04" },
            ],
          },
          {
            id: "outside",
            company: "Outside",
            start: "2024-01",
            end: "2024-05",
            presentationId: "outside",
            roles: [
              { id: "outside-role", title: "Designer", start: "2024-05" },
            ],
          },
        ],
      },
      { referenceMonth },
    );

    expect(result.errors.map(({ code, path }) => [code, path])).toEqual([
      ["invalid-entry-span", "entries[0].end"],
      ["role-outside-entry", "entries[0].roles[0].start"],
      ["zero-length-role", "entries[0].roles[0].start"],
      ["role-outside-entry", "entries[1].roles[0].start"],
      ["zero-length-role", "entries[1].roles[0].start"],
    ]);
  });

  it("keeps the server-safe schema entry free of client directives and browser globals", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/schema.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/^["']use client["']/m);
    expect(source).not.toMatch(/\b(?:document|window|navigator)\b/);
    await expect(import("../src/schema")).resolves.toHaveProperty(
      "normalizeStintConfig",
    );
  });
});
