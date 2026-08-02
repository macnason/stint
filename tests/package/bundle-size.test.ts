import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const distDir = resolve(root, "packages/stint/dist");

/** R42: package-owned default-entry JavaScript, minified and gzipped,
 * excluding React, React DOM, and externalized Motion. */
const SIZE_LIMIT_BYTES = 20 * 1024;

const PORTFOLIO_INTEGRATIONS = [
  "torph",
  "web-haptics",
  "border-beam",
  "next-themes",
  "vaul",
  "up.com.au",
  "macnason",
];

beforeAll(() => {
  if (!existsSync(resolve(distDir, "index.js"))) {
    const result = spawnSync(
      "npm",
      ["run", "build", "--workspace", "packages/stint"],
      { cwd: root, encoding: "utf8", timeout: 180_000 },
    );
    if (result.status !== 0) {
      throw new Error(`package build failed:\n${result.stdout}\n${result.stderr}`);
    }
  }
}, 200_000);

describe("default entry size budget (R42)", () => {
  it("keeps package-owned gzipped JavaScript at or below 20 kB", () => {
    const chunks = readdirSync(distDir).filter((name) => name.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);
    let total = 0;
    for (const chunk of chunks) {
      const content = readFileSync(resolve(distDir, chunk));
      // Externals stay imports; the chunk itself is package-owned code.
      total += gzipSync(content, { level: 9 }).byteLength;
    }
    expect(total).toBeLessThanOrEqual(SIZE_LIMIT_BYTES);
  });

  it("externalizes react, react-dom, and motion rather than bundling them", () => {
    const index = readFileSync(resolve(distDir, "Stint.js"), "utf8");
    expect(index).toMatch(/from\s+"react"/);
    expect(index).toMatch(/from\s+"motion"/);
    // Bundled copies would show up as their internal markers.
    expect(index).not.toContain("react.production");
    expect(index).not.toContain("motion-dom");
  });
});

describe("portfolio integration exclusion", () => {
  it("keeps portfolio-only integrations and personal data out of dist", () => {
    for (const file of readdirSync(distDir)) {
      if (file.endsWith(".map")) continue;
      const content = readFileSync(resolve(distDir, file), "utf8").toLowerCase();
      for (const banned of PORTFOLIO_INTEGRATIONS) {
        expect(
          content.includes(banned),
          `dist/${file} must not contain ${banned}`,
        ).toBe(false);
      }
    }
  });

  it("packs only dist and manifest files into the tarball", () => {
    const result = spawnSync(
      "npm",
      ["pack", "--workspace", "packages/stint", "--dry-run", "--json"],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const [report] = JSON.parse(result.stdout);
    const files = (report.files as { path: string }[]).map((f) => f.path);
    for (const file of files) {
      expect(
        file === "package.json" ||
          file === "README.md" ||
          file === "LICENSE" ||
          file.startsWith("dist/"),
        `unexpected tarball member: ${file}`,
      ).toBe(true);
    }
    // Personal portfolio assets can never ship.
    expect(files.some((file) => file.includes("images/logos"))).toBe(false);
  });
});
