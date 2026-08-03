import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { renderExperienceModule } from "../src/templates/experience.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("experience data template", () => {
  it("emits a literal typed module that compiles against the core schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "stint-template-"));
    temporaryDirectories.push(directory);
    const generated = renderExperienceModule({ schemaVersion: 1, entries: [] });
    expect(generated).toContain("satisfies StintConfig");
    expect(generated).not.toContain("eval(");

    mkdirSync(join(directory, "src"));
    writeFileSync(join(directory, "src/stint.data.ts"), generated);
    const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    writeFileSync(
      join(directory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            baseUrl: ".",
            paths: {
              "@macworks/stint/schema": [
                join(repository, "packages/stint/src/schema.ts"),
              ],
            },
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      )}\n`,
    );
    execFileSync(join(repository, "node_modules/.bin/tsc"), ["-p", directory], {
      stdio: "pipe",
    });
  });
});
