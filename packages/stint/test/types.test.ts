import { describe, expect, it } from "vitest";

import type { MonthString, StintConfig } from "../src/types";

const validMonth: MonthString = "2024-01";
const validConfig = {
  schemaVersion: 1,
  entries: [
    {
      id: "example",
      company: "Example",
      start: "2024-01",
      end: "2025-12",
      roles: [{ id: "role", title: "Designer", start: "2024-01" }],
    },
  ],
} as const satisfies StintConfig;

// @ts-expect-error MonthString requires a four-digit year.
const shortYear: MonthString = "24-01";
// @ts-expect-error MonthString rejects years longer than four digits.
const longYear: MonthString = "20240-01";
// @ts-expect-error MonthString requires a zero-padded month.
const unpaddedMonth: MonthString = "2024-1";
// @ts-expect-error MonthString only accepts calendar months 01 through 12.
const invalidMonth: MonthString = "2024-13";

describe("MonthString type contract", () => {
  it("accepts valid literals directly in package configuration", () => {
    expect(validMonth).toBe("2024-01");
    expect(validConfig.entries[0].end).toBe("2025-12");
    expect([shortYear, longYear, unpaddedMonth, invalidMonth]).toHaveLength(4);
  });
});
