import type { StintConfig } from "@macnas/stint/schema";

/** Clearly fictional demo career data — no real person is described. */
export const fixtureConfig: StintConfig = {
  schemaVersion: 1,
  entries: [
    {
      id: "tidepool",
      company: "Tidepool Systems",
      location: "Fremantle, Australia",
      start: "2019-03",
      end: "2021-08",
      roles: [
        { id: "tidepool-designer", title: "Product Designer", start: "2019-03" },
        {
          id: "tidepool-senior",
          title: "Senior Product Designer",
          start: "2020-06",
        },
      ],
    },
    {
      id: "lanternworks",
      company: "Lanternworks",
      location: "Wellington, New Zealand",
      start: "2021-09",
      end: null,
      roles: [
        { id: "lantern-lead", title: "Design Lead", start: "2021-09" },
      ],
    },
  ],
};
