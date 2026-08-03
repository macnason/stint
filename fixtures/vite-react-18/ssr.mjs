// Server rendering without browser globals proves the package is SSR-safe.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Stint } from "@macnas/stint";
import { normalizeStintConfig } from "@macnas/stint/schema";

const config = {
  schemaVersion: 1,
  entries: [
    {
      id: "tidepool",
      company: "Tidepool Systems",
      start: "2019-03",
      end: null,
      roles: [{ id: "tidepool-designer", title: "Product Designer", start: "2019-03" }],
    },
  ],
};

const normalized = normalizeStintConfig(config, { referenceMonth: "2026-07" });
if (normalized.errors.length > 0) {
  throw new Error("schema normalization failed in SSR fixture");
}

const html = renderToString(
  createElement(Stint, {
    data: config,
    currentMonth: { mode: "live", initialMonth: "2026-07", timeZone: "UTC" },
    orientation: "responsive",
  }),
);

if (!html.includes("data-axis")) {
  throw new Error(`SSR output missing component markup: ${html.slice(0, 200)}`);
}
if (!html.includes("Tidepool Systems")) {
  throw new Error("SSR output missing entry content");
}
console.log("ssr-ok");
