import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "setup-fixture", dependencies: { vite: "8", "@macworks/stint": "1.0.0-next.1" } })}\n`);
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
    expect(JSON.parse(consent.stdout.join(""))).toMatchObject({
      state: "needs_linkedin_consent",
      privacy: expect.stringContaining("We don't send your profile or project data to Stint servers; setup runs on your device."),
    });
    expect(consent.stdout.join(""))
      .toContain("The visible browser connects directly to LinkedIn");
    expect(consent.stdout.join(""))
      .toContain("Stint never enters passwords, MFA, or CAPTCHA");

    const invalid = io();
    expect(await runCli(["setup", "linkedin", "--url", "http://example.com/profile", "--project", root, "--json"], invalid)).toBe(2);
    expect(invalid.stderr.join("")).toContain("E_URL");
  });

  it("rejects malformed consent types instead of treating truthy strings as approval", async () => {
    const root = project();
    const answersPath = join(root, "bad-answers.json");
    writeFileSync(answersPath, `${JSON.stringify({
      version: 1,
      project: { path: root },
      source: { kind: "linkedin-browser", url: "https://www.linkedin.com/in/example" },
      consent: { linkedinBrowser: "false" },
    })}\n`);
    const output = io();
    expect(await runCli(["setup", "--answers", answersPath, "--json"], output)).toBe(1);
    expect(output.stderr.join("")).toContain("E_ANSWERS");
  });

  it("returns a terminal handoff for consented browser work in non-TTY mode", async () => {
    const root = project();
    const output = io();
    expect(await runCli(["setup", "linkedin", "--url", "https://www.linkedin.com/in/example", "--experimental-browser", "--project", root, "--json"], output)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({ state: "waiting_for_browser_sign_in", remediation: "rerun_in_tty" });
  });

  it("returns complete_with_handoff without guessing or writing paths for unsupported projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "stint-unsupported-"));
    directories.push(root);
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(
      join(root, "profile.json"),
      `${JSON.stringify({ schemaVersion: 1, entries: [] })}\n`,
    );
    const output = io();

    expect(
      await runCli(
        ["setup", "profile.json", "--project", root, "--apply", "--json"],
        output,
      ),
    ).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      state: "complete_with_handoff",
      projectInspection: {
        framework: "unknown",
        ambiguities: ["framework", "dataPath"],
      },
    });
    expect(() => readFileSync(join(root, "stint.config.json"))).toThrow();
    expect(() => readFileSync(join(root, "src/stint.data.ts"))).toThrow();
  });

  it("does not silently ignore session or rejected-review answers", async () => {
    const root = project();
    const resumePath = join(root, "resume.json");
    writeFileSync(resumePath, `${JSON.stringify({
      version: 1,
      project: { path: root },
      session: { action: "resume" },
    })}\n`);
    const resumeOutput = io();
    expect(await runCli(["setup", "--answers", resumePath, "--json"], resumeOutput)).toBe(0);
    expect(JSON.parse(resumeOutput.stdout.join(""))).toMatchObject({ state: "failed_recoverably" });

    const rejectPath = join(root, "reject.json");
    writeFileSync(rejectPath, `${JSON.stringify({
      version: 1,
      project: { path: root },
      source: { kind: "file", path: "profile.json" },
      review: { mode: "reject" },
    })}\n`);
    const rejectOutput = io();
    expect(await runCli(["setup", "--answers", rejectPath, "--json"], rejectOutput)).toBe(0);
    expect(JSON.parse(rejectOutput.stdout.join(""))).toMatchObject({ state: "needs_review" });
  });
});
