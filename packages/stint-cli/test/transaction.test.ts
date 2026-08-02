import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyTransaction,
  planTransaction,
  type TransactionPlan,
} from "../src/transaction.js";

const temporaryDirectories: string[] = [];

function temporaryProject(): string {
  const project = mkdtempSync(join(tmpdir(), "stint-transaction-"));
  temporaryDirectories.push(project);
  writeFileSync(join(project, "package.json"), "{}\n");
  return project;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("transaction planning and application", () => {
  it("uses the identical ordered plan for dry-run and apply", () => {
    const project = temporaryProject();
    const plan = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [
        { path: "src/z.ts", content: "z\n" },
        { path: "stint.config.json", content: "{}\n" },
      ],
    });

    expect(plan.actions.map(({ path, action }) => ({ path, action }))).toEqual([
      { path: "src/z.ts", action: "create" },
      { path: "stint.config.json", action: "create" },
    ]);
    expect(() => readFileSync(join(project, "src/z.ts"), "utf8")).toThrow();

    const applied = applyTransaction(plan);
    expect(publicPlan(applied)).toEqual(publicPlan(plan));
    expect(readFileSync(join(project, "src/z.ts"), "utf8")).toBe("z\n");
  });

  it("treats matching files as unchanged and aborts on drift by default", () => {
    const project = temporaryProject();
    writeFileSync(join(project, "stint.config.json"), "same\n");

    const matching = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [{ path: "stint.config.json", content: "same\n" }],
    });
    expect(matching.actions[0]?.action).toBe("unchanged");

    expect(() =>
      planTransaction({
        projectRoot: project,
        conflict: "abort",
        writes: [{ path: "stint.config.json", content: "different\n" }],
      }),
    ).toThrow(/conflict/i);
  });

  it("allows abort-mode updates only when existing bytes match the expectation", () => {
    const project = temporaryProject();
    writeFileSync(join(project, "stint.config.json"), "old\n");

    const plan = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [
        {
          path: "stint.config.json",
          content: "new\n",
          expectedOriginalContent: "old\n",
        },
      ],
    });

    expect(plan.actions[0]?.action).toBe("overwrite");
    applyTransaction(plan);
    expect(readFileSync(join(project, "stint.config.json"), "utf8")).toBe("new\n");

    expect(() =>
      planTransaction({
        projectRoot: project,
        conflict: "abort",
        writes: [
          {
            path: "stint.config.json",
            content: "next\n",
            expectedOriginalContent: "old\n",
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "E_CONFLICT" }));
  });

  it("rejects and preserves a destination mutated after overwrite planning", () => {
    const project = temporaryProject();
    const path = join(project, "existing.txt");
    writeFileSync(path, "old\n");
    const plan = planTransaction({
      projectRoot: project,
      conflict: "overwrite",
      writes: [{ path: "existing.txt", content: "planned\n" }],
    });

    writeFileSync(path, "concurrent\n");

    expect(() => applyTransaction(plan)).toThrowError(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    expect(readFileSync(path, "utf8")).toBe("concurrent\n");
  });

  it("rejects and preserves a destination created after create planning", () => {
    const project = temporaryProject();
    const path = join(project, "new.txt");
    const plan = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [{ path: "new.txt", content: "planned\n" }],
    });

    writeFileSync(path, "concurrent\n");

    expect(() => applyTransaction(plan)).toThrowError(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    expect(readFileSync(path, "utf8")).toBe("concurrent\n");
  });

  it("rejects destination ancestors that are symlinks", () => {
    const project = temporaryProject();
    const outside = temporaryProject();
    symlinkSync(outside, join(project, "generated"));

    expect(() =>
      planTransaction({
        projectRoot: project,
        conflict: "abort",
        writes: [{ path: "generated/data.ts", content: "secret\n" }],
      }),
    ).toThrow(/symlink/i);
    expect(() => readFileSync(join(outside, "data.ts"), "utf8")).toThrow();
  });

  it("detects a parent swapped to a symlink after planning", () => {
    const project = temporaryProject();
    const outside = temporaryProject();
    mkdirSync(join(project, "src"));
    const plan = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [{ path: "src/data.ts", content: "private\n" }],
    });

    renameSync(join(project, "src"), join(project, "src-original"));
    symlinkSync(outside, join(project, "src"));

    expect(() => applyTransaction(plan)).toThrow(/changed|symlink/i);
    expect(() => readFileSync(join(outside, "data.ts"), "utf8")).toThrow();
  });

  it("rolls back earlier replacements when a later write fails", () => {
    const project = temporaryProject();
    writeFileSync(join(project, "a.txt"), "old-a\n");
    writeFileSync(join(project, "b.txt"), "old-b\n");
    const plan = planTransaction({
      projectRoot: project,
      conflict: "overwrite",
      writes: [
        { path: "a.txt", content: "new-a\n" },
        { path: "b.txt", content: "new-b\n" },
      ],
    });

    expect(() =>
      applyTransaction(plan, {
        beforeWrite(index) {
          if (index === 1) throw new Error("simulated interruption");
        },
      }),
    ).toThrow(/simulated interruption/);
    expect(readFileSync(join(project, "a.txt"), "utf8")).toBe("old-a\n");
    expect(readFileSync(join(project, "b.txt"), "utf8")).toBe("old-b\n");
  });

  it("cleans private backups and writes when replacement setup fails", () => {
    const project = temporaryProject();
    writeFileSync(join(project, "existing.txt"), "old\n");
    const plan = planTransaction({
      projectRoot: project,
      conflict: "overwrite",
      writes: [{ path: "existing.txt", content: "new\n" }],
    });

    expect(() =>
      applyTransaction(plan, {
        beforeBackupWrite() {
          throw new Error("simulated backup write failure");
        },
      }),
    ).toThrow(/simulated backup write failure/);
    expect(readFileSync(join(project, "existing.txt"), "utf8")).toBe("old\n");
    expect(readdirSync(project).filter((name) => name.startsWith(".stint-"))).toEqual(
      [],
    );
  });

  it("uses skip as a transaction-wide policy", () => {
    const project = temporaryProject();
    writeFileSync(join(project, "existing.txt"), "old\n");
    const plan = planTransaction({
      projectRoot: project,
      conflict: "skip",
      writes: [
        { path: "existing.txt", content: "new\n" },
        { path: "missing.txt", content: "new\n" },
      ],
    });
    expect(plan.actions.map((action) => action.action)).toEqual(["skip", "skip"]);
    applyTransaction(plan);
    expect(readFileSync(join(project, "existing.txt"), "utf8")).toBe("old\n");
    expect(() => readFileSync(join(project, "missing.txt"), "utf8")).toThrow();
  });

  it("rolls back all writes when a later destination is read-only", () => {
    const project = temporaryProject();
    mkdirSync(join(project, "locked"), { mode: 0o500 });
    const plan = planTransaction({
      projectRoot: project,
      conflict: "abort",
      writes: [
        { path: "first.txt", content: "first\n" },
        { path: "locked/second.txt", content: "second\n" },
      ],
    });
    try {
      expect(() => applyTransaction(plan)).toThrow();
      expect(() => readFileSync(join(project, "first.txt"), "utf8")).toThrow();
      expect(() => readFileSync(join(project, "locked/second.txt"), "utf8")).toThrow();
    } finally {
      chmodSync(join(project, "locked"), 0o700);
    }
  });
});

function publicPlan(plan: TransactionPlan) {
  return {
    root: plan.projectRoot,
    actions: plan.actions.map(({ path, action, bytes }) => ({ path, action, bytes })),
  };
}
