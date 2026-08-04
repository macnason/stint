import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { inspectProject } from "../src/project.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project inspection", () => {
  it("finds the nearest package project and infers Vite/npm targets", () => {
    const root = mkdtempSync(join(tmpdir(), "stint-discovery-"));
    directories.push(root);
    const nested = join(root, "apps", "timeline");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ workspaces: ["apps/*"] })}\n`);
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeFileSync(join(nested, "package.json"), `${JSON.stringify({ dependencies: { vite: "8" } })}\n`);
    const result = inspectProject(nested);
    expect(result.project.root).toBe(realpathSync(nested));
    expect(result.framework).toBe("vite");
    expect(result.packageManager).toBe("npm");
    expect(result.likelyConfigPath).toBe("stint.config.json");
    expect(dirname(result.project.manifestPath)).toBe(realpathSync(nested));
  });

  it("infers Next.js App Router paths from the inspected project layout", () => {
    const root = mkdtempSync(join(tmpdir(), "stint-next-discovery-"));
    directories.push(root);
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ dependencies: { next: "16" } })}\n`,
    );

    const result = inspectProject(root);

    expect(result.framework).toBe("next");
    expect(result.likelyConfigPath).toBe("stint.config.json");
    expect(result.likelyDataPath).toBe("app/stint.data.ts");
    expect(result.ambiguities).toEqual([]);
  });

  it("infers a Next.js src App Router path from the observed directory", () => {
    const root = mkdtempSync(join(tmpdir(), "stint-next-src-discovery-"));
    directories.push(root);
    mkdirSync(join(root, "src", "app"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ dependencies: { next: "16" } })}\n`,
    );

    const result = inspectProject(root);

    expect(result.likelyDataPath).toBe("src/app/stint.data.ts");
    expect(result.ambiguities).toEqual([]);
  });

  it("does not invent a data path for an unsupported project", () => {
    const root = mkdtempSync(join(tmpdir(), "stint-unknown-discovery-"));
    directories.push(root);
    writeFileSync(join(root, "package.json"), "{}\n");

    const result = inspectProject(root);

    expect(result.framework).toBe("unknown");
    expect(result.likelyDataPath).toBeUndefined();
    expect(result.ambiguities).toEqual(["framework", "dataPath"]);
  });
});
