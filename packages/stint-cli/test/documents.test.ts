import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractDocument } from "../src/documents/extract.js";
import { runCli, type CliIo } from "../src/cli.js";

const fixtures = fileURLToPath(
  new URL("./fixtures/documents/", import.meta.url)
);
const directories: string[] = [];
const io = () => {
  const stdout: string[] = [],
    stderr: string[] = [];
  return {
    isTTY: false,
    stdout,
    stderr,
    writeOut: (s: string) => {
      stdout.push(s);
    },
    writeError: (s: string) => {
      stderr.push(s);
    },
  } satisfies CliIo & { stdout: string[]; stderr: string[] };
};
afterEach(() =>
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true }))
);

describe("bundled offline document extraction", () => {
  for (const [file, format] of [
    ["profile.pdf", "pdf"],
    ["scanned-profile.pdf", "pdf"],
    ["profile.png", "image"],
  ] as const) {
    it(`extracts actual ${file} with the bundled engines and model`, async () => {
      const result = await extractDocument(
        readFileSync(join(fixtures, file)),
        format
      );
      expect(result.extraction).toEqual({
        pages: 1,
        ocrPages: file === "profile.pdf" ? 0 : 1,
      });
      expect(
        result.config.entries.map((e) => [
          e.company,
          e.start,
          e.end,
          e.roles[0]?.title,
        ])
      ).toEqual([
        ["Earlier Studio", "2020-01", "2022-01", "Designer"],
        ["Acme Studio", "2022-01", null, "Senior Designer"],
      ]);
      expect(
        result.warnings.some((w) => w.code === "document-unresolved")
      ).toBe(false);
    }, 20_000);
  }
  it("keeps employer groups through locations, skills, and OCR punctuation", async () => {
    const result = await extractDocument(
      readFileSync(join(fixtures, "grouped-profile.png")),
      "image"
    );
    expect(
      result.config.entries.map((entry) => [entry.company, entry.roles.length])
    ).toEqual([
      ["Old Studio", 2],
      ["Earlier Studio", 1],
      ["Example Studio", 2],
    ]);
    expect(
      result.warnings.some((warning) => warning.code === "document-unresolved")
    ).toBe(false);
  }, 20_000);
  it("ignores logo artwork and keeps each logo's employer together", async () => {
    const result = await extractDocument(
      readFileSync(join(fixtures, "logo-profile.png")),
      "image"
    );
    expect(
      result.config.entries.map((entry) => [
        entry.company,
        entry.roles.map((role) => role.title),
      ])
    ).toEqual([
      ["Example Podcast", ["Co-Host"]],
      ["Chat Studio", ["Co-Founder"]],
      ["Hub Studio", ["Staff Designer", "Principal Designer"]],
    ]);
    expect(
      result.warnings.some((warning) => warning.code === "document-unresolved")
    ).toBe(false);
  }, 20_000);
  it("holds damaged dates for review and refuses partial application", async () => {
    const root = mkdtempSync(join(tmpdir(), "stint-document-"));
    directories.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { vite: "8" } })
    );
    const source = join(root, "damaged.pdf");
    writeFileSync(
      source,
      readFileSync(join(fixtures, "profile.pdf"), "utf8").replace(
        "January 2020",
        "January 2024"
      )
    );
    const preview = io();
    expect(
      await runCli(["setup", source, "--project", root, "--json"], preview)
    ).toBe(0);
    expect(JSON.parse(preview.stdout.join("")).state).toBe("needs_review");
    const apply = io();
    expect(
      await runCli(
        ["setup", source, "--project", root, "--apply", "--json"],
        apply
      )
    ).toBe(1);
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
  });
  it("rejects corrupt files and oversized images with actionable errors", async () => {
    await expect(
      extractDocument(Buffer.from("%PDF-broken"), "pdf")
    ).rejects.toThrow("Could not read");
    await expect(
      extractDocument(Buffer.from("not an image"), "image")
    ).rejects.toThrow("PNG or JPEG");
    const png = Buffer.from(readFileSync(join(fixtures, "profile.png")));
    png.writeUInt32BE(100000, 16);
    await expect(extractDocument(png, "image")).rejects.toThrow(
      "16 megapixels"
    );
  });
  it("saves a private canonical draft without a project and refuses to replace it", async () => {
    const root = mkdtempSync(join(tmpdir(), "stint-document-"));
    directories.push(root);
    const output = join(root, "draft.json");
    const first = io();
    expect(
      await runCli(
        [
          "extract",
          join(fixtures, "profile.pdf"),
          "--output",
          output,
          "--json",
        ],
        first
      )
    ).toBe(0);
    expect(JSON.parse(first.stdout.join("")).draft).toEqual(
      JSON.parse(readFileSync(output, "utf8"))
    );
    const second = io();
    expect(
      await runCli(
        ["extract", join(fixtures, "profile.pdf"), "--output", output],
        second
      )
    ).toBe(1);
    expect(second.stderr.join("")).toContain("never overwritten");
  });
  it("previews histories in setup and only writes after an explicit apply", async () => {
    const root = mkdtempSync(join(tmpdir(), "stint-document-"));
    directories.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { vite: "8", "@macworks/stint": "1.0.0-next.3" },
      })
    );
    const args = ["setup", join(fixtures, "profile.pdf"), "--project", root];
    const preview = io();
    expect(await runCli(args, preview)).toBe(0);
    expect(preview.stdout.join("")).toContain("Acme Studio");
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    const dryRun = io();
    expect(
      await runCli([...args, "--apply", "--dry-run", "--json"], dryRun)
    ).toBe(0);
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    const apply = io();
    expect(await runCli([...args, "--apply", "--json"], apply)).toBe(0);
    expect(
      JSON.parse(readFileSync(join(root, "stint.config.json"), "utf8")).entries
    ).toHaveLength(2);
  });
});
