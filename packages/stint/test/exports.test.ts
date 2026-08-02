import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);

const CLIENT_SOURCES = [
  "Stint.tsx",
  "useExperienceSelection.ts",
  "useResponsiveOrientation.ts",
  "useCurrentMonth.ts",
];
const SERVER_SOURCES = ["schema.ts", "timeline.ts", "types.ts", "feedback.ts", "index.ts"];

describe("export map", () => {
  it("exposes root, schema, base CSS, and preset CSS entries", () => {
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./schema",
      "./styles.css",
      "./presets.css",
    ]);
    expect(manifest.exports["./styles.css"]).toBe("./dist/styles.css");
    expect(manifest.exports["./presets.css"]).toBe("./dist/presets.css");
  });

  it("resolves each export to an existing source file", () => {
    for (const source of [...CLIENT_SOURCES, ...SERVER_SOURCES]) {
      expect(
        existsSync(resolve(packageRoot, "src", source)),
        `src/${source} must exist`,
      ).toBe(true);
    }
    expect(existsSync(resolve(packageRoot, "src/styles.css"))).toBe(true);
    expect(existsSync(resolve(packageRoot, "src/presets.css"))).toBe(true);
  });
});

describe("client/server directive boundaries", () => {
  it("marks interactive modules with use client", () => {
    for (const source of CLIENT_SOURCES) {
      const content = readFileSync(resolve(packageRoot, "src", source), "utf8");
      expect(content.startsWith('"use client";'), `${source}`).toBe(true);
    }
  });

  it("keeps server-safe modules free of client directives", () => {
    for (const source of SERVER_SOURCES) {
      const content = readFileSync(resolve(packageRoot, "src", source), "utf8");
      expect(content.includes("use client"), `${source}`).toBe(false);
    }
  });

  it("keeps the schema subpath importable without touching client modules", () => {
    const schema = readFileSync(resolve(packageRoot, "src/schema.ts"), "utf8");
    const timeline = readFileSync(
      resolve(packageRoot, "src/timeline.ts"),
      "utf8",
    );
    for (const content of [schema, timeline]) {
      expect(content).not.toMatch(/from "\.\/(Stint|use[A-Z])/);
      expect(content).not.toMatch(/from "react/);
      expect(content).not.toMatch(/from "motion/);
    }
  });

  it("preserves directives on built client chunks when dist exists", () => {
    const dist = resolve(packageRoot, "dist");
    if (!existsSync(resolve(dist, "index.js"))) return;
    for (const chunk of ["Stint.js", "useExperienceSelection.js"]) {
      const content = readFileSync(resolve(dist, chunk), "utf8");
      expect(content.startsWith('"use client";'), chunk).toBe(true);
    }
    for (const chunk of ["schema.js", "timeline.js", "index.js"]) {
      const content = readFileSync(resolve(dist, chunk), "utf8");
      expect(content.includes('"use client"'), chunk).toBe(false);
    }
  });
});
