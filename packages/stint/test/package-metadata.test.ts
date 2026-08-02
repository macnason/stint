import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(resolve(repositoryRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

describe("workspace package metadata", () => {
  // The root was the portfolio app when both lived in one repository. Stint now
  // has its own repository, so the root is a private monorepo shell that only
  // addresses the two published workspaces and never builds an application.
  it("keeps the root a private shell addressing both workspaces", async () => {
    const root = await readJson("package.json");
    const scripts = root.scripts as Record<string, string>;

    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(["packages/*"]);
    expect(scripts.build).toBe("npm run build --workspaces --if-present");
    expect(scripts["build:packages"]).toBe(
      "npm run build --workspaces --if-present",
    );
    expect(scripts.lint).toBe("eslint .");
    expect(scripts.test).toBe("vitest run --config vitest.workspace.ts");

    // No application build may reappear here: this repository publishes
    // packages, and a Next build would reintroduce the portfolio coupling the
    // extraction removed.
    expect(scripts.dev).toBeUndefined();
    expect(scripts.start).toBeUndefined();
    expect(JSON.stringify(scripts)).not.toContain("next ");
  });

  it("declares the runtime peers, Motion dependency, and explicit exports", async () => {
    const runtime = await readJson("packages/stint/package.json");

    expect(runtime.type).toBe("module");
    expect(runtime.files).toEqual(["dist"]);
    expect(runtime.peerDependencies).toEqual({
      react: "^18.2.0 || ^19.0.0",
      "react-dom": "^18.2.0 || ^19.0.0",
    });
    expect(runtime.dependencies).toEqual({ motion: "^12.42.2" });
    expect(Object.keys(runtime.exports as object)).toEqual([
      ".",
      "./schema",
      "./styles.css",
      "./presets.css",
    ]);
  });

  it("declares a Node 22 ESM CLI with an explicit runtime dependency", async () => {
    const cli = await readJson("packages/stint-cli/package.json");
    const runtime = await readJson("packages/stint/package.json");

    expect(cli.type).toBe("module");
    expect(cli.files).toEqual(["dist"]);
    expect(cli.bin).toEqual({ stint: "./dist/cli.js" });
    expect(cli.engines).toEqual({ node: ">=22.0.0" });
    expect(cli.dependencies).toMatchObject({
      [runtime.name as string]: runtime.version,
    });
    expect(cli.dependencies).toHaveProperty("csv-parse");
    expect(cli.dependencies).toHaveProperty("yaml");
    expect(cli.dependencies).toHaveProperty("yauzl");
    expect(Object.keys(cli.exports as object)).toEqual(["."]);
  });

  it("keeps runtime and CLI versions in one Changesets fixed group", async () => {
    const changesets = await readJson(".changeset/config.json");

    expect(changesets.fixed).toEqual([
      ["@macnason/stint", "@macnason/stint-cli"],
    ]);
    expect(changesets.privatePackages).toEqual({ version: true, tag: false });
  });
});
