#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const separator = process.argv.indexOf("--");
const gateFlag = process.argv.indexOf("--gate");
const gate = gateFlag >= 0 ? process.argv[gateFlag + 1] : undefined;

if (!gate || !["u7", "u11"].includes(gate) || separator < 0) {
  fail("usage: run-release-gate.mjs --gate <u7|u11> -- <command> [args...]");
}

const [command, ...args] = process.argv.slice(separator + 1);
if (!command) fail("a gate command is required");

const root = process.cwd();
const evidencePath = resolve(root, `.context/release-gates/${gate}.json`);
rmSync(evidencePath, { force: true });

const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) fail(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

const packages = ["packages/stint/package.json", "packages/stint-cli/package.json"].map(
  (manifestPath) => {
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
    return { name: manifest.name, version: manifest.version };
  },
);
const evidence = {
  schemaVersion: 1,
  gate,
  status: "passed",
  commit:
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  runId: process.env.STINT_GATE_RUN_ID ?? "local",
  packages,
  command: [command, ...args],
  completedAt: new Date().toISOString(),
};
const temporaryPath = `${evidencePath}.${process.pid}.tmp`;
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, evidencePath);

function fail(message) {
  console.error(`release gate: ${message}`);
  process.exit(1);
}
