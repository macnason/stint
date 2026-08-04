import { chmodSync, constants, mkdirSync, openSync, writeFileSync, closeSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CliError } from "../diagnostics.js";

export interface SetupSession {
  readonly id: string;
  readonly directory: string;
  readonly checkpointPath: string;
}

export function createSetupSession(baseDirectory = join(tmpdir(), "stint")): SetupSession {
  mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
  chmodSync(baseDirectory, 0o700);
  const id = randomUUID();
  const directory = join(baseDirectory, id);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  return { id, directory, checkpointPath: join(directory, "checkpoint.json") };
}

export function writeSessionCheckpoint(session: SetupSession, value: unknown): void {
  const text = JSON.stringify(value);
  if (text.length > 256 * 1024) throw new CliError("E_ANSWERS_LIMIT", "The setup checkpoint exceeds its size limit.");
  if (/password|cookie|credential|raw(html|source)?|profile(path)?/i.test(text)) {
    throw new CliError("E_SECURITY", "Setup checkpoints cannot contain credentials, cookies, raw sources, or browser profiles.");
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(session.checkpointPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, `${text}\n`);
    chmodSync(session.checkpointPath, 0o600);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function cleanupSetupSession(session: SetupSession): void {
  rmSync(session.directory, { recursive: true, force: true });
}
