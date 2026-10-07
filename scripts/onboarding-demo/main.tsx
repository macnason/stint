import React from "react";
import { createRoot } from "react-dom/client";
import { Stint } from "@macworks/stint";
import "@macworks/stint/styles.css";
import "@macworks/stint/presets.css";
import { stintConfig } from "./stint.data";

createRoot(document.getElementById("root")!).render(
  <main style={{ padding: "48px 42px", color: "#242725", fontFamily: "system-ui, sans-serif" }}>
    <p style={{ fontSize: 11, letterSpacing: ".16em", color: "#687168" }}>A FRESH REACT PROJECT · REAL GENERATED DATA</p>
    <h1 style={{ fontSize: 40, fontWeight: 500, margin: "22px 0 8px", letterSpacing: "-.045em" }}>A career you can explore.</h1>
    <p style={{ color: "#687168", marginBottom: 64 }}>Move through the timeline. Every role came from the imported screenshot.</p>
    <Stint data={stintConfig} currentMonth={{ mode: "fixed", month: "2026-10" }} orientation="horizontal" />
    <p style={{ marginTop: 58, fontSize: 12, color: "#687168" }}>Synthetic example · 3 employers · 5 roles · Local OCR</p>
  </main>,
);
