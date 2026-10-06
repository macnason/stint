import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
const cli = resolve("packages/stint-cli/dist/cli.js");
const results = [];
for (const name of ["profile.pdf", "scanned-profile.pdf", "profile.png"]) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "extract",
        resolve("packages/stint-cli/test/fixtures/documents", name),
        "--json",
      ],
      { encoding: "utf8", timeout: 95000 }
    );
    if (result.status !== 0)
      throw new Error(result.stderr || "Extraction failed");
    const extracted = JSON.parse(result.stdout);
    if (extracted.draft.entries.length !== 2)
      throw new Error("Unexpected extracted history");
    times.push(Math.round(performance.now() - start));
  }
  times.sort((a, b) => a - b);
  results.push({
    fixture: name,
    medianMs: times[2],
    minMs: times[0],
    maxMs: times[4],
  });
}
console.table(results);
