import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];
let runtimeTarball = "";

const INSTALL_TIMEOUT = 300_000;

// Strings that must never appear in package output or fixture bundles
// sourced from the package.
const PORTFOLIO_INTEGRATIONS = [
  "torph",
  "web-haptics",
  "border-beam",
  "next-themes",
  "vaul",
  "up.com.au",
];

beforeAll(() => {
  run("npm", ["run", "build", "--workspace", "packages/stint"], root);
  const packedDirectory = temporaryDirectory("stint-packed-runtime-");
  run(
    "npm",
    ["pack", "--workspace", "packages/stint", "--pack-destination", packedDirectory],
    root,
  );
  const tarball = readdirSync(packedDirectory).find((name) =>
    /^macworks-stint-\d/.test(name),
  );
  expect(tarball).toBeTruthy();
  runtimeTarball = join(packedDirectory, tarball!);
}, INSTALL_TIMEOUT);

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setupFixture(name: string): string {
  const consumer = temporaryDirectory(`stint-fixture-${name}-`);
  cpSync(resolve(root, "fixtures", name), consumer, { recursive: true });
  run(
    "npm",
    [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
    ],
    consumer,
  );
  run(
    "npm",
    [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-save",
      runtimeTarball,
    ],
    consumer,
  );
  return consumer;
}

function assertNoPortfolioIntegrations(content: string, label: string) {
  for (const dependency of PORTFOLIO_INTEGRATIONS) {
    expect(
      content.toLowerCase().includes(dependency),
      `${label} must not contain ${dependency}`,
    ).toBe(false);
  }
}

describe.each(["vite-react-18", "vite-react-19"] as const)(
  "packed runtime in %s",
  (fixture) => {
    it(
      "builds, server-renders, and stays free of portfolio integrations",
      () => {
        const consumer = setupFixture(fixture);

        // Production build from the tarball, no transpile assistance.
        run("npm", ["run", "build"], consumer);
        const assets = readdirSync(join(consumer, "dist/assets"));
        const js = assets.filter((name) => name.endsWith(".js"));
        const css = assets.filter((name) => name.endsWith(".css"));
        expect(js.length).toBeGreaterThan(0);
        expect(css.length).toBeGreaterThan(0);

        for (const asset of js) {
          const content = readFileSync(
            join(consumer, "dist/assets", asset),
            "utf8",
          );
          assertNoPortfolioIntegrations(content, `${fixture}/${asset}`);
        }
        const cssContent = css
          .map((asset) => readFileSync(join(consumer, "dist/assets", asset), "utf8"))
          .join("\n");
        // Transparent masks ship with the bundle and paint no surface color.
        expect(cssContent).toContain("mask-image");
        expect(cssContent).toContain("stint-presets");

        // Server rendering without browser globals.
        const ssr = run("node", ["ssr.mjs"], consumer);
        expect(ssr).toContain("ssr-ok");
      },
      INSTALL_TIMEOUT,
    );
  },
);

describe("packed runtime in next-app-router", () => {
  it(
    "builds and prerenders a Server Component page without transpilePackages",
    () => {
      const consumer = setupFixture("next-app-router");
      run("npm", ["run", "build"], consumer, {
        BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "1",
        BROWSERSLIST_IGNORE_OLD_DATA: "1",
      });

      const html = readFileSync(
        join(consumer, ".next/server/app/index.html"),
        "utf8",
      );
      // The client component server-rendered with a live server seed.
      expect(html).toContain("data-axis");
      expect(html).toContain("Lanternworks");
      expect(html).toContain("fictional entries validated on the server");
      assertNoPortfolioIntegrations(html, "next prerender");

      // No transpilePackages present in the fixture config.
      const config = readFileSync(join(consumer, "next.config.ts"), "utf8");
      expect(config).not.toMatch(/transpilePackages\s*:/);
    },
    INSTALL_TIMEOUT * 2,
  );
});

describe("packed declarations and export map", () => {
  it(
    "resolves declarations for every export and rejects deep imports",
    () => {
      const consumer = setupFixture("vite-react-19");

      // Bundler-mode declaration resolution through the export map.
      const attw = spawnSync(
        "npx",
        [
          "--yes",
          "@arethetypeswrong/cli",
          "--pack",
          runtimeTarball,
          "--profile",
          "esm-only",
          "--exclude-entrypoints",
          "./styles.css",
          "./presets.css",
        ],
        { cwd: consumer, encoding: "utf8", timeout: INSTALL_TIMEOUT },
      );
      expect(
        attw.status,
        `attw failed:\n${attw.stdout}\n${attw.stderr}`,
      ).toBe(0);

      // publint checks the manifest/exports shape of the packed tarball.
      const publint = spawnSync(
        "npx",
        ["--yes", "publint", "--strict", runtimeTarball],
        { cwd: consumer, encoding: "utf8", timeout: INSTALL_TIMEOUT },
      );
      expect(
        publint.status,
        `publint failed:\n${publint.stdout}\n${publint.stderr}`,
      ).toBe(0);

      // Undeclared deep imports must not resolve.
      const deep = spawnSync(
        "node",
        ["-e", "import('@macworks/stint/timeline').then(()=>process.exit(0),()=>process.exit(7))"],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(deep.status).toBe(7);
    },
    INSTALL_TIMEOUT * 2,
  );
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): string {
  // Vitest exports NODE_ENV=test, which breaks nested production builds
  // (Next selects the dev JSX runtime and prerendering fails).
  const cleanEnv = { ...process.env, ...env };
  delete cleanEnv.NODE_ENV;
  delete cleanEnv.VITEST;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: INSTALL_TIMEOUT,
    env: cleanEnv,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}
