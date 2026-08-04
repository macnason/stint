import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const temporaryDirectories: string[] = [];
let packedDirectory = "";
let runtimeTarball = "";
let cliTarball = "";

beforeAll(() => {
  expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
  run("npm", ["run", "build", "--workspace", "packages/stint"], root);
  run("npm", ["run", "build", "--workspace", "packages/stint-cli"], root);
  packedDirectory = temporaryDirectory("stint-packed-artifacts-");
  run(
    "npm",
    ["pack", "--workspace", "packages/stint", "--pack-destination", packedDirectory],
    root,
  );
  run(
    "npm",
    ["pack", "--workspace", "packages/stint-cli", "--pack-destination", packedDirectory],
    root,
  );
  const tarballs = readdirSync(packedDirectory);
  runtimeTarball = join(
    packedDirectory,
    tarballs.find((name) => /^macworks-stint-\d/.test(name))!,
  );
  cliTarball = join(
    packedDirectory,
    tarballs.find((name) => /^macworks-stint-cli-/.test(name))!,
  );
}, 60_000);

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packed CLI", () => {
  it("installs local tarballs offline and exercises setup from a clean Next.js project", () => {
    const consumer = temporaryDirectory("stint-packed-consumer-");
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({
        name: "stint-next-smoke",
        version: "1.0.0",
        private: true,
      }, null, 2)}\n`,
    );
    run(
      "npm",
      [
        "install",
        "--offline",
        "--legacy-peer-deps",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--omit=dev",
        runtimeTarball,
        cliTarball,
      ],
      consumer,
    );

    const manifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
    manifest.devDependencies = {
      next: "16.0.0",
      react: "19.2.1",
      "react-dom": "19.2.1",
    };
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const npxStint = (args: readonly string[]) =>
      run("npx", ["--no-install", "stint", ...args], consumer);
    expect(npxStint(["--help"])).toContain("stint import INPUT");
    mkdirSync(join(consumer, "app"), { recursive: true });
    writeFileSync(
      join(consumer, "profile.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            id: "offline-works",
            company: "Offline Works",
            start: "2024-01",
            end: null,
            roles: [
              {
                id: "designer",
                title: "Designer",
                start: "2024-01",
              },
            ],
          },
        ],
      })}\n`,
    );
    writeFileSync(
      join(consumer, "answers.json"),
      `${JSON.stringify({
        version: 1,
        project: { path: "." },
        source: { kind: "file", path: "profile.json" },
        review: { mode: "approve" },
        conflict: "abort",
        integration: { mode: "auto" },
      })}\n`,
    );

    const plan = JSON.parse(
      npxStint(["setup", "--answers", "answers.json", "--json"]),
    );
    expect(plan).toMatchObject({
      state: "ready_to_apply",
      dryRun: true,
      projectInspection: {
        framework: "next",
        likelyConfigPath: "stint.config.json",
        likelyDataPath: "app/stint.data.ts",
      },
    });
    expect(plan.actions.map((action: { path: string }) => action.path)).toEqual([
      "stint.config.json",
      "app/stint.data.ts",
    ]);
    expect(plan.installPlan).toMatchObject({
      packageName: "@macworks/stint",
      version: "1.0.0-next.2",
    });
    expect(() => readFileSync(join(consumer, "stint.config.json"))).toThrow();

    manifest.dependencies = { "@macworks/stint": "1.0.0-next.2" };
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const applied = JSON.parse(
      npxStint([
        "setup",
        "--answers",
        "answers.json",
        "--apply",
        "--json",
      ]),
    );
    expect(applied).toMatchObject({ ok: true, state: "complete", importedEntries: 1 });
    expect(JSON.parse(readFileSync(join(consumer, "stint.config.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      entries: [{ company: "Offline Works" }],
    });
    expect(readFileSync(join(consumer, "app/stint.data.ts"), "utf8")).toContain(
      "satisfies StintConfig",
    );
  });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_offline: "true",
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}
