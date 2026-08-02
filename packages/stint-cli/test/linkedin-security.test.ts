import { describe, expect, it, vi } from "vitest";

import { parseLinkedInZip } from "../src/importers/linkedin-zip.js";
import { createZip } from "./zip-fixture.js";

const positions =
  "Company Name,Title,Location,Started On,Finished On\nSynthetic Studio,Designer,Remote,Jan 2024,\n";

describe("LinkedIn full-export ZIP security", () => {
  it("reads only Positions in memory, ignores unrelated data, and makes no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const archive = createZip([
      { name: "Connections.csv", content: "unrelated private category" },
      { name: "Positions.csv", content: positions },
      { name: "messages/private.txt", content: "unrelated private message" },
    ]);

    const result = await parseLinkedInZip(archive, "linkedin-export.zip");

    expect(result.config.entries).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ["absolute paths", [{ name: "/Positions.csv", content: positions }]],
    ["drive-absolute paths", [{ name: "C:/Positions.csv", content: positions }]],
    ["parent traversal", [{ name: "../Positions.csv", content: positions }]],
    [
      "symlinks",
      [
        {
          name: "Positions.csv",
          content: positions,
          externalAttributes: (0o120777 << 16) >>> 0,
        },
      ],
    ],
    [
      "duplicate members",
      [
        { name: "Positions.csv", content: positions },
        { name: "Positions.csv", content: positions },
      ],
    ],
  ])("rejects %s", async (_name, entries) => {
    await expect(
      parseLinkedInZip(createZip(entries), "linkedin-export.zip"),
    ).rejects.toThrow(/unsafe|duplicate|symlink/i);
  });

  it("rejects missing Positions, excessive entry counts, sizes, and compression ratios", async () => {
    await expect(
      parseLinkedInZip(
        createZip([{ name: "Profile.csv", content: "unrelated" }]),
        "linkedin-export.zip",
      ),
    ).rejects.toThrow(/Positions/i);

    await expect(
      parseLinkedInZip(
        createZip(
          Array.from({ length: 1_025 }, (_, index) => ({
            name: `unrelated-${index}.txt`,
            content: "x",
          })),
        ),
        "linkedin-export.zip",
      ),
    ).rejects.toThrow(/entry limit/i);

    await expect(
      parseLinkedInZip(
        createZip([
          {
            name: "Positions.csv",
            content: positions,
            declaredUncompressedSize: 9 * 1024 * 1024,
          },
        ]),
        "linkedin-export.zip",
      ),
    ).rejects.toThrow(/size limit/i);

    await expect(
      parseLinkedInZip(
        createZip([
          { name: "Positions.csv", content: positions },
          { name: "unrelated.txt", content: "A".repeat(256 * 1024) },
        ]),
        "linkedin-export.zip",
      ),
    ).rejects.toThrow(/compression ratio/i);

  });

  it("rejects malformed Positions without exposing source row contents", async () => {
    const marker = "ARCHIVE_SOURCE_SECRET_b191";
    const archive = createZip([
      {
        name: "Positions.csv",
        content: `Company Name,Title,Started On,Finished On\n${marker},Designer,invalid,\n`,
      },
    ]);

    try {
      await parseLinkedInZip(archive, "linkedin-export.zip");
      throw new Error("expected import failure");
    } catch (error) {
      expect(String(error)).not.toContain(marker);
      expect(String(error)).toMatch(/row 2/i);
    }
  });
});
