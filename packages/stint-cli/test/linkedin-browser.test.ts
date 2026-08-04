import { describe, expect, it } from "vitest";

import { parseLinkedInBrowserItems } from "../src/importers/linkedin-browser.js";

describe("LinkedIn browser normalization", () => {
  it("groups rendered roles and keeps current work open-ended", () => {
    const result = parseLinkedInBrowserItems([
      { text: "Staff Designer\nExample Studio\nSydney, Australia\nJan 2022 - Present" },
      { text: "Senior Designer\nExample Studio\nSydney, Australia\nJun 2020 - Dec 2021" },
    ]);
    expect(result.config.entries).toHaveLength(1);
    expect(result.config.entries[0]).toMatchObject({ company: "Example Studio", location: "Sydney, Australia", start: "2020-06", end: null });
    expect(result.config.entries[0]?.roles).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("holds date-less rendered items for review", () => {
    const result = parseLinkedInBrowserItems([{ text: "Example Studio\nStaff Designer" }]);
    expect(result.config.entries).toEqual([]);
    expect(result.warnings[0]?.code).toBe("linkedin-browser-date");
  });
});
