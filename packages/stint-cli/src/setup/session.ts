import { chmodSync, constants, lstatSync, mkdirSync, openSync, writeFileSync, closeSync, rmSync, statSync } from "node:fs";
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
  try {
    const existing = lstatSync(baseDirectory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new CliError("E_SECURITY", "The setup session base must be a real directory.");
    }
    if (typeof process.getuid === "function" && existing.uid !== process.getuid()) {
      throw new CliError("E_SECURITY", "The setup session base must be owned by the current user.");
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (!isMissing(error)) throw new CliError("E_SECURITY", "The setup session base could not be inspected.", { cause: error });
  }
  mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
  chmodSync(baseDirectory, 0o700);
  const id = randomUUID();
  const directory = join(baseDirectory, id);
  mkdirSync(directory, { mode: 0o700 });
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new CliError("E_SECURITY", "The setup session directory is not a real directory.");
  if (typeof process.getuid === "function" && statSync(directory).uid !== process.getuid()) throw new CliError("E_SECURITY", "The setup session directory is not owned by the current user.");
  chmodSync(directory, 0o700);
  return { id, directory, checkpointPath: join(directory, "checkpoint.json") };
}

export function writeSessionCheckpoint(session: SetupSession, value: unknown): void {
  if (!isSafeCheckpoint(value)) {
    throw new CliError("E_SECURITY", "Setup checkpoints may contain only normalized setup fields and cannot contain credentials or raw sources.");
  }
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new CliError("E_ANSWERS_LIMIT", "The setup checkpoint exceeds its size limit.");
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

function isSafeCheckpoint(value: unknown): boolean {
  if (!isRecord(value) || !keysOnly(value, ["state", "fields", "warnings", "provenance", "sessionId"])) return false;
  if (value.state !== undefined && typeof value.state !== "string") return false;
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") return false;
  for (const key of ["warnings", "provenance"] as const) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string"))) return false;
  }
  if (value.fields !== undefined && (!isRecord(value.fields) || !keysOnly(value.fields, ["company", "title", "location", "start", "end"]))) return false;
  return true;
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}
