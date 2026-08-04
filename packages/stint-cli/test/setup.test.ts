import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";

const directories: string[] = [];

function io(isTTY = false): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    isTTY,
    stdout,
    stderr,
    writeOut(value) {
      stdout.push(value);
    },
    writeError(value) {
      stderr.push(value);
    },
  };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "stint-setup-"));
  directories.push(root);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "setup-fixture", dependencies: { vite: "8" } })}\n`);
  writeFileSync(join(root, "profile.json"), `${JSON.stringify({ schemaVersion: 1, entries: [] })}\n`);
  return root;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("setup", () => {
  it("returns the compact source menu without opening a prompt in non-TTY mode", async () => {
    const root = project();
    const output = io();
    expect(await runCli(["setup", "--project", root, "--json"], output)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      state: "needs_source_choice",
      sources: ["Import a file", "Paste or enter history", "LinkedIn browser (experimental)"],
    });
    expect(output.stderr).toEqual([]);
  });

  it("uses inferred paths and returns a reviewable plan before apply", async () => {
    const root = project();
    const output = io();
    expect(await runCli(["setup", "profile.json", "--project", root, "--json"], output)).toBe(0);
    const result = JSON.parse(output.stdout.join(""));
    expect(result).toMatchObject({ state: "ready_to_apply", dryRun: true });
    expect(result.actions.map((action: { path: string }) => action.path)).toEqual([
      "stint.config.json",
      "src/stint.data.ts",
    ]);
    expect(readFileSync(join(root, "profile.json"), "utf8")).toContain("schemaVersion");
    expect(() => readFileSync(join(root, "stint.config.json"))).toThrow();
  });

  it("accepts one structured answers payload and applies only when explicitly requested", async () => {
    const root = project();
    writeFileSync(join(root, "answers.json"), `${JSON.stringify({
      version: 1,
      project: { path: root },
      source: { kind: "file", path: "profile.json" },
      session: { action: "new" },
      consent: { linkedinBrowser: false, agentProviderBoundary: false },
      review: { mode: "approve" },
      conflict: "abort",
      integration: { mode: "handoff" },
      apply: true,
    })}\n`);
    const output = io();
    expect(await runCli(["setup", "--answers", join(root, "answers.json"), "--json"], output)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({ state: "complete" });
    expect(readFileSync(join(root, "stint.config.json"), "utf8")).toContain("schemaVersion");
  });

  it("requires consent and a valid LinkedIn URL before the experimental browser path", async () => {
    const root = project();
    const consent = io();
    expect(await runCli(["setup", "linkedin", "--url", "https://www.linkedin.com/in/example", "--project", root, "--json"], consent)).toBe(0);
    expect(JSON.parse(consent.stdout.join(""))).toMatchObject({ state: "needs_linkedin_consent" });

    const invalid = io();
    expect(await runCli(["setup", "linkedin", "--url", "http://example.com/profile", "--project", root, "--json"], invalid)).toBe(2);
    expect(invalid.stderr.join("")).toContain("E_URL");
  });
});
