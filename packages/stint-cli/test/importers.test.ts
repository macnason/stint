import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";
import { parseJsonImport } from "../src/importers/json.js";
import { parseLinkedInCsv } from "../src/importers/linkedin-csv.js";
import { parseYamlImport } from "../src/importers/yaml.js";
import { createZip } from "./zip-fixture.js";

const temporaryDirectories: string[] = [];

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "stint-import-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "package.json"), "{}\n");
  return directory;
}

function captureIo(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    isTTY: false,
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

describe("structured file importers", () => {
  it("imports equivalent JSON and YAML with safe source locations", () => {
    const json = `{
  "schemaVersion": 1,
  "entries": [{
    "id": "northstar-2024",
    "company": "Northstar Labs",
    "start": "2024-01",
    "end": null,
    "roles": [{ "id": "northstar-designer", "title": "Designer", "start": "2024-01" }]
  }]
}`;
    const yaml = `schemaVersion: 1
entries:
  - id: northstar-2024
    company: Northstar Labs
    start: 2024-01
    end: null
    roles:
      - id: northstar-designer
        title: Designer
        start: 2024-01
`;

    expect(parseJsonImport(Buffer.from(json), "career.json").config).toEqual(
      parseYamlImport(Buffer.from(yaml), "career.yaml").config,
    );
    expect(() =>
      parseJsonImport(Buffer.from('{\n  "entries": [}'), "career.json"),
    ).toThrow(/line 2, column/i);
    expect(() =>
      parseYamlImport(Buffer.from("entries:\n  - company: [\n"), "career.yaml"),
    ).toThrow(/line \d+, column \d+/i);
  });

  it("rejects excessive JSON nesting and YAML aliases/custom tags", () => {
    expect(() =>
      parseJsonImport(Buffer.from(`${"[".repeat(70)}0${"]".repeat(70)}`), "deep.json"),
    ).toThrow(/nesting limit/i);
    expect(() =>
      parseYamlImport(Buffer.from("base: &base [1]\ncopy: *base\n"), "alias.yaml"),
    ).toThrow(/aliases/i);
    expect(() =>
      parseYamlImport(Buffer.from("value: !include secret.txt\n"), "tag.yaml"),
    ).toThrow(/custom tags/i);
  });
});

describe("LinkedIn Positions CSV", () => {
  it("handles normalized headers, quoted fields, promotions, overlaps, and current roles", () => {
    const csv = `\ufeff company name ,TITLE,Location,Started On,Finished On,Description
"Nebula, Inc.","Product Designer",Melbourne,Jan 2020,Jun 2021,"Line one,
line two"
"Nebula, Inc.","Senior Product Designer",Melbourne,Jul 2021,Dec 2022,"Promotion"
Parallel Foundry,"Design
Systems Lead",Remote,Nov 2022,,"Current"
`;
    const first = parseLinkedInCsv(Buffer.from(csv), "Positions.csv");
    const second = parseLinkedInCsv(Buffer.from(csv), "Positions.csv");

    expect(second.config).toEqual(first.config);
    expect(first.config.entries).toHaveLength(2);
    expect(first.config.entries[0]).toMatchObject({
      start: "2020-01",
      end: "2023-01",
      roles: [
        { title: "Product Designer", start: "2020-01" },
        { title: "Senior Product Designer", start: "2021-07" },
      ],
    });
    expect(first.config.entries[1]).toMatchObject({
      start: "2022-11",
      end: null,
      roles: [{ title: "Design\nSystems Lead", start: "2022-11" }],
    });
    expect(first.config.entries.every((entry) => /^[a-z0-9-]+$/.test(entry.id))).toBe(true);
  });

  it("fails closed on required-column drift and redacts malformed row contents", () => {
    expect(() =>
      parseLinkedInCsv(
        Buffer.from("Employer,Job,From,To\nSecretCo,SecretRole,Jan 2020,Dec 2020\n"),
        "Positions.csv",
      ),
    ).toThrow(/required LinkedIn Positions columns/i);

    const marker = "SOURCE_ROW_SECRET_8b22";
    try {
      parseLinkedInCsv(
        Buffer.from(
          `Company Name,Title,Started On,Finished On\n${marker},Designer,not-a-month,\n`,
        ),
        "Positions.csv",
      );
      throw new Error("expected import failure");
    } catch (error) {
      expect(String(error)).not.toContain(marker);
      expect(String(error)).toMatch(/row 2/i);
    }
  });

  it("rejects excessive CSV rows and record sizes", () => {
    const header = "Company Name,Title,Started On,Finished On\n";
    const row = "Synthetic Studio,Designer,Jan 2024,\n";
    expect(() =>
      parseLinkedInCsv(
        Buffer.from(`${header}${row.repeat(10_001)}`),
        "Positions.csv",
      ),
    ).toThrow(/row limit/i);
    expect(() =>
      parseLinkedInCsv(
        Buffer.from(`${header}Synthetic Studio,${"x".repeat(129 * 1024)},Jan 2024,\n`),
        "Positions.csv",
      ),
    ).toThrow(/malformed|record|limit/i);
  });
});

describe("import command transaction", () => {
  it("writes canonical JSON and typed TypeScript, keeps input, and stays redacted", async () => {
    const directory = project();
    const input = join(directory, "Positions.csv");
    writeFileSync(
      input,
      "Company Name,Title,Location,Started On,Finished On\nSynthetic Atelier,Designer,Remote,Jan 2024,\n",
    );
    const io = captureIo();
    expect(
      await runCli(
        [
          "import",
          input,
          "--format",
          "linkedin-csv",
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
        io,
      ),
    ).toBe(0);

    expect(readFileSync(input, "utf8")).toContain("Synthetic Atelier");
    expect(readFileSync(join(directory, "stint.config.json"), "utf8")).toContain(
      "Synthetic Atelier",
    );
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toContain(
      "satisfies StintConfig",
    );
    expect(io.stdout.join("")).not.toContain("Synthetic Atelier");
    expect(JSON.parse(io.stdout.join(""))).toMatchObject({ ok: true, importedEntries: 1 });
  });

  it("has dry-run parity and aborts conflicts without partial writes", async () => {
    const directory = project();
    const input = join(directory, "career.json");
    writeFileSync(
      input,
      JSON.stringify({ schemaVersion: 1, entries: [] }),
    );
    const common = [
      "import",
      input,
      "--format",
      "json",
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

    const dryIo = captureIo();
    expect(await runCli([...common, "--dry-run"], dryIo)).toBe(0);
    expect(() => readFileSync(join(directory, "stint.config.json"))).toThrow();
    const dryPlan = JSON.parse(dryIo.stdout.join(""));

    const applyIo = captureIo();
    expect(await runCli(common, applyIo)).toBe(0);
    const applyPlan = JSON.parse(applyIo.stdout.join(""));
    expect(applyPlan.actions).toEqual(dryPlan.actions);

    writeFileSync(join(directory, "src/stint.data.ts"), "user content\n");
    const conflictIo = captureIo();
    expect(await runCli(common, conflictIo)).toBe(1);
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toBe(
      "user content\n",
    );

    const skipIo = captureIo();
    const skipArgs = common.map((value, index) =>
      common[index - 1] === "--conflict" ? "skip" : value,
    );
    expect(await runCli(skipArgs, skipIo)).toBe(0);
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toBe(
      "user content\n",
    );
    const skipActions = JSON.parse(skipIo.stdout.join("")).actions as Array<{
      action: string;
    }>;
    expect(skipActions.some((action) => action.action === "skip")).toBe(true);
    expect(
      skipActions.every((action) => ["skip", "unchanged"].includes(action.action)),
    ).toBe(true);

    const overwriteIo = captureIo();
    const overwriteArgs = common.map((value, index) =>
      common[index - 1] === "--conflict" ? "overwrite" : value,
    );
    expect(await runCli(overwriteArgs, overwriteIo)).toBe(0);
    expect(readFileSync(join(directory, "src/stint.data.ts"), "utf8")).toContain(
      "satisfies StintConfig",
    );
  });

  it("reports invalid JSON locations without writes or source contents", async () => {
    const directory = project();
    const marker = "SOURCE_JSON_SECRET_1d31";
    const input = join(directory, "career.json");
    writeFileSync(input, `{\n  "${marker}": [}\n`);
    const io = captureIo();
    expect(
      await runCli(
        [
          "import",
          input,
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
        io,
      ),
    ).toBe(1);
    expect(io.stderr.join("")).toMatch(/line 2, column/i);
    expect(io.stderr.join("")).not.toContain(marker);
    expect(() => readFileSync(join(directory, "stint.config.json"))).toThrow();
    expect(() => readFileSync(join(directory, "src/stint.data.ts"))).toThrow();
  });

  it("imports a full LinkedIn ZIP without deleting or rewriting the archive", async () => {
    const directory = project();
    const input = join(directory, "linkedin-export.zip");
    const archive = createZip([
      { name: "Profile.csv", content: "unrelated synthetic category" },
      {
        name: "Positions.csv",
        content:
          "Company Name,Title,Location,Started On,Finished On\nArchive Atelier,Designer,Remote,Jan 2024,Present\n",
      },
    ]);
    writeFileSync(input, archive);
    expect(
      await runCli(
        [
          "import",
          input,
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
        captureIo(),
      ),
    ).toBe(0);
    expect(readFileSync(input)).toEqual(archive);
  });
});
