import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSetupSession, cleanupSetupSession, writeSessionCheckpoint } from "../src/setup/session.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("setup sessions", () => {
  it("uses private checkpoint permissions and rejects credential-shaped fields", () => {
    const root = mkdtempSync(join(tmpdir(), "stint-session-"));
    directories.push(root);
    const session = createSetupSession(root);
    writeSessionCheckpoint(session, { state: "needs_review", fields: { company: "Example" } });
    expect(statSync(session.directory).mode & 0o777).toBe(0o700);
    expect(statSync(session.checkpointPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(session.checkpointPath, "utf8")).toContain("needs_review");
    expect(() => writeSessionCheckpoint(session, { cookies: "secret" })).toThrow(/cannot contain/i);
    cleanupSetupSession(session);
  });
});
