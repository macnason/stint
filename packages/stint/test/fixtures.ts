import type { StintConfig } from "../src/types";

export const referenceMonth = "2025-06";

export function makeConfig(
  overrides: Partial<StintConfig> = {},
): StintConfig {
  return {
    schemaVersion: 1,
    entries: [
      {
        id: "north-star",
        company: "North Star Labs",
        location: "Melbourne, Australia",
        start: "2023-01",
        end: "2024-01",
        priority: 1,
        presentationId: "north-star-mark",
        roles: [
          {
            id: "north-star-designer",
            title: "Product Designer",
            start: "2023-01",
          },
          {
            id: "north-star-senior",
            title: "Senior Product Designer",
            start: "2023-07",
          },
        ],
      },
      {
        id: "field-notes",
        company: "Field Notes Co",
        start: "2024-01",
        end: null,
        priority: 2,
        presentationId: "field-notes-mark",
        roles: [
          {
            id: "field-notes-lead",
            title: "Lead Product Designer",
            start: "2024-01",
          },
        ],
      },
    ],
    ...overrides,
  };
}
