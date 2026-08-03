import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stint } from "@macworks/stint";
import "@macworks/stint/styles.css";
import "@macworks/stint/presets.css";

import { fixtureConfig } from "./data";

declare global {
  interface Window {
    __stintFeedback: unknown[];
  }
}

window.__stintFeedback = [];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Stint
      data={fixtureConfig}
      currentMonth={{ mode: "fixed", month: "2026-07" }}
      orientation="responsive"
      onFeedback={(event) => window.__stintFeedback.push(event)}
    />
  </StrictMode>,
);
