import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  it("installs local tarballs offline and exercises bin, help, init, validate, and import", () => {
    const consumer = temporaryDirectory("stint-packed-consumer-");
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "stint-offline-smoke", version: "1.0.0", private: true }, null, 2)}\n`,
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
        runtimeTarball,
        cliTarball,
      ],
      consumer,
    );

    const bin = join(consumer, "node_modules/.bin/stint");
    expect(run(bin, ["--help"], consumer)).toContain("stint import INPUT");
    run(
      bin,
      [
        "init",
        "--project",
        consumer,
        "--config",
        "stint.config.json",
        "--data",
        "src/stint.data.ts",
        "--conflict",
        "abort",
        "--json",
      ],
      consumer,
    );
    const validation = JSON.parse(
      run(
        bin,
        [
          "validate",
          "--project",
          consumer,
          "--config",
          "stint.config.json",
          "--reference-month",
          "2026-07",
          "--json",
        ],
        consumer,
      ),
    );
    expect(validation).toMatchObject({ valid: true });

    const positions = join(consumer, "Positions.csv");
    writeFileSync(
      positions,
      "Company Name,Title,Location,Started On,Finished On\nOffline Works,Designer,Remote,Jan 2024,\n",
    );
    const imported = JSON.parse(
      run(
        bin,
        [
          "import",
          positions,
          "--format",
          "linkedin-csv",
          "--project",
          consumer,
          "--config",
          "stint.config.json",
          "--data",
          "src/stint.data.ts",
          "--conflict",
          "overwrite",
          "--reference-month",
          "2026-07",
          "--json",
        ],
        consumer,
      ),
    );
    expect(imported).toMatchObject({ ok: true, importedEntries: 1 });
    expect(JSON.parse(readFileSync(join(consumer, "stint.config.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      entries: [{ company: "Offline Works" }],
    });
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
