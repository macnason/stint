import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";

const temporaryDirectories: string[] = [];

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "stint-command-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "package.json"), "{}\n");
  return directory;
}

function captureIo(
  isTTY = false
): CliIo & { stdout: string[]; stderr: string[] } {
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("authoring commands", () => {
  it("initializes matching canonical JSON and typed TypeScript data", async () => {
    const directory = project();
    const io = captureIo();
    const args = [
      "init",
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--data",
      "src/stint.data.ts",
      "--conflict",
      "abort",
      "--json",
    ];

    expect(await runCli(args, io)).toBe(0);
    const config = JSON.parse(
      readFileSync(join(directory, "stint.config.json"), "utf8")
    );
    expect(config).toEqual({ schemaVersion: 1, entries: [] });
    expect(
      readFileSync(join(directory, "src/stint.data.ts"), "utf8")
    ).toContain("satisfies StintConfig");

    const first = JSON.parse(io.stdout.join(""));
    const secondIo = captureIo();
    expect(await runCli(args, secondIo)).toBe(0);
    const second = JSON.parse(secondIo.stdout.join(""));
    expect(
      first.actions.map((action: { path: string }) => action.path)
    ).toEqual(second.actions.map((action: { path: string }) => action.path));
    expect(
      second.actions.every(
        (action: { action: string }) => action.action === "unchanged"
      )
    ).toBe(true);
  });

  it("aborts a repeated init when generated output has drifted", async () => {
    const directory = project();
    const common = [
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--data",
      "src/stint.data.ts",
      "--conflict",
      "abort",
      "--json",
    ];
    expect(await runCli(["init", ...common], captureIo())).toBe(0);
    writeFileSync(join(directory, "src/stint.data.ts"), "drift\n");

    const io = captureIo();
    expect(await runCli(["init", ...common], io)).toBe(1);
    expect(io.stdout).toEqual([]);
    expect(io.stderr.join("")).toContain("E_CONFLICT");
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toBe(
      "drift\n"
    );
  });

  it("adds employers and roles by stable ID without company-name merging", async () => {
    const directory = project();
    const base = [
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--data",
      "src/stint.data.ts",
      "--conflict",
      "overwrite",
      "--json",
    ];
    expect(await runCli(["init", ...base], captureIo())).toBe(0);
    const firstEmployerIo = captureIo();
    expect(
      await runCli(
        [
          "add",
          "employer",
          ...base,
          "--id",
          "acme-one",
          "--company",
          "Acme",
          "--start",
          "2020-01",
          "--end",
          "2021-01",
          "--role-id",
          "designer-one",
          "--role-title",
          "Designer",
          "--role-start",
          "2020-01",
        ],
        firstEmployerIo
      )
    ).toBe(0);
    expect(firstEmployerIo.stdout.join("")).not.toContain("Acme");
    expect(firstEmployerIo.stdout.join("")).not.toContain("Designer");
    expect(
      await runCli(
        [
          "add",
          "employer",
          ...base,
          "--id",
          "acme-two",
          "--company",
          "Acme",
          "--start",
          "2021-01",
          "--end",
          "2022-01",
          "--role-id",
          "designer-two",
          "--role-title",
          "Designer",
          "--role-start",
          "2021-01",
        ],
        captureIo()
      )
    ).toBe(0);
    expect(
      await runCli(
        [
          "add",
          "role",
          ...base,
          "--employer-id",
          "acme-two",
          "--id",
          "lead-two",
          "--title",
          "Lead",
          "--start",
          "2021-06",
        ],
        captureIo()
      )
    ).toBe(0);

    const config = JSON.parse(
      readFileSync(join(directory, "stint.config.json"), "utf8")
    );
    expect(config.entries).toHaveLength(2);
    expect(config.entries[0].roles).toHaveLength(1);
    expect(
      config.entries[1].roles.map((role: { id: string }) => role.id)
    ).toEqual(["designer-two", "lead-two"]);
  });

  it("uses compare-and-swap updates for TTY-default employer and role adds", async () => {
    const directory = project();
    const paths = [
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--data",
      "src/stint.data.ts",
      "--json",
    ];
    expect(
      await runCli(["init", ...paths, "--conflict", "abort"], captureIo(true))
    ).toBe(0);

    expect(
      await runCli(
        [
          "add",
          "employer",
          ...paths,
          "--id",
          "acme",
          "--company",
          "Acme",
          "--start",
          "2020-01",
          "--end",
          "current",
          "--role-id",
          "designer",
          "--role-title",
          "Designer",
          "--role-start",
          "2020-01",
        ],
        captureIo(true)
      )
    ).toBe(0);
    expect(
      await runCli(
        [
          "add",
          "role",
          ...paths,
          "--employer-id",
          "acme",
          "--id",
          "lead",
          "--title",
          "Lead",
          "--start",
          "2022-01",
        ],
        captureIo(true)
      )
    ).toBe(0);

    const config = JSON.parse(
      readFileSync(join(directory, "stint.config.json"), "utf8")
    );
    expect(
      config.entries[0].roles.map((role: { id: string }) => role.id)
    ).toEqual(["designer", "lead"]);
  });

  it("keeps TTY-default adds fail-closed when generated data has drifted", async () => {
    const directory = project();
    const paths = [
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--data",
      "src/stint.data.ts",
      "--json",
    ];
    expect(
      await runCli(["init", ...paths, "--conflict", "abort"], captureIo(true))
    ).toBe(0);
    writeFileSync(join(directory, "src/stint.data.ts"), "drift\n");

    const io = captureIo(true);
    expect(
      await runCli(
        [
          "add",
          "employer",
          ...paths,
          "--id",
          "acme",
          "--company",
          "Acme",
          "--start",
          "2020-01",
          "--end",
          "current",
          "--role-id",
          "designer",
          "--role-title",
          "Designer",
          "--role-start",
          "2020-01",
        ],
        io
      )
    ).toBe(1);
    expect(JSON.parse(io.stderr.join("")).error.code).toBe("E_CONFLICT");
    expect(
      JSON.parse(readFileSync(join(directory, "stint.config.json"), "utf8"))
    ).toEqual({ schemaVersion: 1, entries: [] });
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toBe(
      "drift\n"
    );
  });

  it("requires complete non-TTY mutation flags and emits clean redacted JSON", async () => {
    const directory = project();
    const io = captureIo();
    expect(await runCli(["init", "--project", directory, "--json"], io)).toBe(
      2
    );
    expect(io.stdout).toEqual([]);
    const diagnostic = io.stderr.join("");
    expect(diagnostic).toContain("E_REQUIRED_OPTION");
    expect(diagnostic).not.toMatch(/\u001b\[/);
    expect(diagnostic).not.toContain("?");
  });

  it("documents supported employer fields and exclusive end semantics", async () => {
    const overviewIo = captureIo();
    expect(await runCli(["--help"], overviewIo)).toBe(0);
    expect(overviewIo.stdout.join("")).toContain("--location LOCATION");
    expect(overviewIo.stdout.join("")).toContain("--priority NUMBER");
    expect(overviewIo.stdout.join("")).toContain("--presentation-id ID");
    expect(overviewIo.stdout.join("")).toContain("ends are exclusive");

    const employerIo = captureIo();
    expect(await runCli(["add", "employer", "--help"], employerIo)).toBe(0);
    expect(employerIo.stderr).toEqual([]);
    expect(employerIo.stdout.join("")).toContain("--end YYYY-MM|current|null");
    expect(employerIo.stdout.join("")).toContain("--location LOCATION");
    expect(employerIo.stdout.join("")).toContain("exclusive");

    const roleIo = captureIo();
    expect(await runCli(["add", "role", "--help", "--json"], roleIo)).toBe(0);
    const roleHelp = JSON.parse(roleIo.stdout.join(""));
    expect(roleHelp).toMatchObject({ command: "add role" });
    expect(roleHelp.notes).toContain(
      "A role ends at the next role start or at its employer's exclusive end month."
    );
  });

  it("validates JSON structurally and never loads the adjacent TypeScript", async () => {
    const directory = project();
    writeFileSync(
      join(directory, "stint.config.json"),
      `${JSON.stringify({ schemaVersion: 1, entries: [] })}\n`
    );
    writeFileSync(
      join(directory, "stint.data.ts"),
      'throw new Error("must not execute")\n'
    );
    const io = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--project",
          directory,
          "--config",
          "stint.config.json",
          "--reference-month",
          "2026-07",
          "--json",
        ],
        io
      )
    ).toBe(0);
    expect(JSON.parse(io.stdout.join(""))).toMatchObject({ valid: true });
  });

  it("returns every redacted validation diagnostic with relationship paths", async () => {
    const directory = project();
    writeFileSync(
      join(directory, "stint.config.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            id: "first",
            company: "sensitive-first-company",
            start: "2020-01",
            end: null,
            unsupportedOne: true,
            roles: [{ id: "first-role", title: "First", start: "2020-01" }],
          },
          {
            id: "second",
            company: "sensitive-second-company",
            start: "2021-01",
            end: null,
            unsupportedTwo: true,
            roles: [{ id: "second-role", title: "Second", start: "2021-01" }],
          },
        ],
      })}\n`
    );
    const io = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--project",
          directory,
          "--config",
          "stint.config.json",
          "--reference-month",
          "2026-07",
          "--json",
        ],
        io
      )
    ).toBe(1);

    const failure = JSON.parse(io.stderr.join(""));
    expect(failure.error).toMatchObject({
      code: "E_CONFIG_INVALID",
      valid: false,
    });
    expect(failure.error.errors).toHaveLength(2);
    expect(
      failure.error.errors.map((error: { path: string }) => error.path)
    ).toEqual(["entries[0].unsupportedOne", "entries[1].unsupportedTwo"]);
    expect(
      failure.error.warnings.find(
        (warning: { code: string }) =>
          warning.code === "multiple-current-entries"
      ).relatedPaths
    ).toEqual(["entries[0]", "entries[1]"]);
    expect(
      failure.error.warnings.find(
        (warning: { code: string }) => warning.code === "overlap"
      ).relatedPaths
    ).toEqual(["entries[0]"]);
    expect(io.stderr.join("")).not.toContain("sensitive-first-company");
    expect(io.stderr.join("")).not.toContain("sensitive-second-company");
  });

  it("escapes terminal control bytes in human diagnostics but preserves JSON data", async () => {
    const directory = project();
    const unsafeKey = "unsupported\u001b[31m\u0007\rkey";
    writeFileSync(
      join(directory, "stint.config.json"),
      `${JSON.stringify({
        [unsafeKey]: true,
        schemaVersion: 1,
        entries: [],
      })}\n`
    );
    const common = [
      "validate",
      "--project",
      directory,
      "--config",
      "stint.config.json",
      "--reference-month",
      "2026-07",
    ];

    const humanIo = captureIo();
    expect(await runCli(common, humanIo)).toBe(1);
    const human = humanIo.stderr.join("");
    expect(human).toContain("\\u001b");
    expect(human).toContain("\\u0007");
    expect(human).toContain("\\u000d");
    expect(human.slice(0, -1)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

    const jsonIo = captureIo();
    expect(await runCli([...common, "--json"], jsonIo)).toBe(1);
    expect(JSON.parse(jsonIo.stderr.join("")).error.path).toBe(unsafeKey);
  });

  it("dry-run returns the same plan without writing", async () => {
    const directory = project();
    const io = captureIo();
    expect(
      await runCli(
        [
          "init",
          "--project",
          directory,
          "--config",
          "stint.config.json",
          "--data",
          "src/stint.data.ts",
          "--conflict",
          "abort",
          "--dry-run",
          "--json",
        ],
        io
      )
    ).toBe(0);
    const dryRun = JSON.parse(io.stdout.join(""));
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(() =>
      readFileSync(join(directory, "stint.config.json"), "utf8")
    ).toThrow();

    const applyIo = captureIo();
    expect(
      await runCli(
        [
          "init",
          "--project",
          directory,
          "--config",
          "stint.config.json",
          "--data",
          "src/stint.data.ts",
          "--conflict",
          "abort",
          "--json",
        ],
        applyIo
      )
    ).toBe(0);
    const applied = JSON.parse(applyIo.stdout.join(""));
    expect(applied.actions).toEqual(dryRun.actions);
  });

  it("reports malformed JSON with a source location and writes nothing", async () => {
    const directory = project();
    writeFileSync(
      join(directory, "stint.config.json"),
      '{\n  "schemaVersion": 1,\n  "entries": [\n}\n'
    );
    const io = captureIo();
    expect(
      await runCli(
        [
          "validate",
          "--project",
          directory,
          "--config",
          "stint.config.json",
          "--reference-month",
          "2026-07",
          "--json",
        ],
        io
      )
    ).toBe(1);
    const failure = JSON.parse(io.stderr.join(""));
    expect(failure.error).toMatchObject({ code: "E_CONFIG_PARSE" });
    expect(failure.error.message).toMatch(/line \d+, column \d+/);
    expect(() =>
      readFileSync(join(directory, "src/stint.data.ts"), "utf8")
    ).toThrow();
  });
});
