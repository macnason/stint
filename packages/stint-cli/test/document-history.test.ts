import { describe, expect, it } from "vitest";
import { parseDocumentHistory } from "../src/documents/history.js";

describe("document history", () => {
  it("reads a LinkedIn PDF, preserves promotions and ignores education", () => {
    const result = parseDocumentHistory(
      "Experience\nAcme\n3 years\nSenior Designer\nJanuary 2022 - Present\nDesigner\nJanuary 2021 - December 2021\nEducation\nCollege\nJanuary 2017 - December 2020",
      "pdf"
    );
    expect(result.config.entries).toHaveLength(1);
    expect(result.config.entries[0]).toMatchObject({
      company: "Acme",
      start: "2021-01",
      end: null,
      roles: [{ title: "Designer" }, { title: "Senior Designer" }],
    });
  });
  it("reads screenshot ordering and converts inclusive end months", () => {
    const result = parseDocumentHistory(
      "Experience\nDesigner\nAcme · Full-time\nJan 2020 - Dec 2021 · 2 yrs\nMelbourne, Australia",
      "image"
    );
    expect(result.config.entries[0]).toMatchObject({
      company: "Acme",
      start: "2020-01",
      end: "2022-01",
      roles: [{ title: "Designer" }],
    });
  });
  it("does not turn year-only dates into invented months", () => {
    const result = parseDocumentHistory(
      "Experience\nAcme\nDesigner\n2020 - 2022",
      "pdf"
    );
    expect(result.config.entries).toEqual([]);
    expect(result.warnings.some((w) => w.code === "document-unresolved")).toBe(
      true
    );
  });
  it("does not interpret a missing end date as current", () => {
    const result = parseDocumentHistory(
      "Experience\nAcme\nDesigner\nJan 2020 -",
      "pdf"
    );
    expect(result.config.entries).toEqual([]);
  });
  it("keeps returns to the same employer separate", () => {
    const result = parseDocumentHistory(
      "Experience\nAcme\nDesigner\nJan 2023 - Present\nAcme\nDesigner\nJan 2020 - Dec 2021",
      "pdf"
    );
    expect(result.config.entries).toHaveLength(2);
  });
  it("handles OCR separators, locations, skills and same-month grouped promotions", () => {
    const result = parseDocumentHistory(
      `< Experience |
Example Studio
Full-time - 3 yrs 6 mos
Melbourne, Victoria, Australia
Head of Design
Oct 2025 - Present - 1yr 1 mo
Hybrid
Skills: Interface Design, +3 skills
Senior Product Designer
May 2023 - Oct 2025 - 2 yrs 6 mos
Skills: Interface Design, +4 skills
Senior Product Designer
Earlier Studio - Full-time
Apr 2022 - May 2023 - 1yr 2 mos
© Interface Design and +4 skills
Old Studio
5 yrs 9 mos
Gold Coast, Australia
Product Design Lead
Jun 2015 - Dec 2016 - 1 yr 7 mos
Skills: Interface Design, +2 skills
Senior Product Designer
Apr 2011 - Jun 2015 - 4 yrs 3 mos`,
      "image"
    );
    expect(
      result.config.entries.map((e) => [
        e.company,
        e.start,
        e.end,
        e.roles.map((r) => r.title),
      ])
    ).toEqual([
      [
        "Old Studio",
        "2011-04",
        "2017-01",
        ["Senior Product Designer", "Product Design Lead"],
      ],
      ["Earlier Studio", "2022-04", "2023-06", ["Senior Product Designer"]],
      [
        "Example Studio",
        "2023-05",
        null,
        ["Senior Product Designer", "Head of Design"],
      ],
    ]);
    expect(result.warnings.some((w) => w.code === "document-unresolved")).toBe(
      false
    );
  });
});
