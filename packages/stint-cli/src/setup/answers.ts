import { lstatSync, readSync } from "node:fs";

import { CliError } from "../diagnostics.js";
import { isRecord, readFileNoFollow } from "../project.js";

export interface SetupAnswers {
  readonly version: 1;
  readonly project?: { readonly path?: string };
  readonly source?: { readonly kind: string; readonly path?: string; readonly url?: string };
  readonly session?: { readonly action?: "new" | "resume" | "reset" };
  readonly consent?: {
    readonly linkedinBrowser?: boolean;
    readonly agentProviderBoundary?: boolean;
  };
  readonly review?: { readonly mode?: "interactive" | "approve" | "reject" };
  readonly conflict?: "abort" | "overwrite" | "skip";
  readonly integration?: { readonly mode?: "auto" | "handoff" };
  readonly apply?: boolean;
}

export function readAnswers(path: string): SetupAnswers {
  let source: string;
  try {
    source = path === "-"
      ? readBoundedStdin(256 * 1024)
      : readBoundedFile(path, 256 * 1024);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_ANSWERS", "The setup answers file could not be read.", {
      cause: error,
      path: path === "-" ? undefined : path,
    });
  }
  if (source.length > 256 * 1024) {
    throw new CliError("E_ANSWERS_LIMIT", "The setup answers payload exceeds its 256 KiB limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new CliError("E_ANSWERS", "The setup answers payload must be valid JSON.", { cause: error });
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new CliError("E_ANSWERS", "The setup answers payload must declare version 1.");
  }
  if (containsForbiddenField(parsed)) {
    throw new CliError("E_ANSWERS", "Credentials, cookies, browser profiles, raw source, and arbitrary argv are not valid answers.");
  }
  if (!isSetupAnswers(parsed)) {
    throw new CliError("E_ANSWERS", "The setup answers payload contains an invalid field type or value.");
  }
  return parsed;
}

function isSetupAnswers(value: unknown): value is SetupAnswers {
  if (!isRecord(value)) return false;
  if (!keysOnly(value, ["version", "project", "source", "session", "consent", "review", "conflict", "integration", "apply"])) return false;
  if (value.project !== undefined && (!isRecord(value.project) || !keysOnly(value.project, ["path"]) || !optionalString(value.project.path))) return false;
  if (value.source !== undefined) {
    if (!isRecord(value.source) || !keysOnly(value.source, ["kind", "path", "url"]) || (value.source.kind !== "file" && value.source.kind !== "linkedin-browser")) return false;
    if (!optionalString(value.source.path) || !optionalString(value.source.url)) return false;
  }
  if (value.session !== undefined && (!isRecord(value.session) || !keysOnly(value.session, ["action"]) || !["new", "resume", "reset", undefined].includes(value.session.action as string | undefined))) return false;
  if (value.consent !== undefined && (!isRecord(value.consent) || !keysOnly(value.consent, ["linkedinBrowser", "agentProviderBoundary"]) || !optionalBoolean(value.consent.linkedinBrowser) || !optionalBoolean(value.consent.agentProviderBoundary))) return false;
  if (value.review !== undefined && (!isRecord(value.review) || !keysOnly(value.review, ["mode"]) || !["interactive", "approve", "reject", undefined].includes(value.review.mode as string | undefined))) return false;
  if (value.conflict !== undefined && !["abort", "overwrite", "skip"].includes(value.conflict as string)) return false;
  if (value.integration !== undefined && (!isRecord(value.integration) || !keysOnly(value.integration, ["mode"]) || !["auto", "handoff", undefined].includes(value.integration.mode as string | undefined))) return false;
  return value.apply === undefined || typeof value.apply === "boolean";
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function readBoundedFile(path: string, limit: number): string {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new CliError("E_SECURITY", "The setup answers path must be a regular file.", { path });
  }
  if (metadata.size > limit) {
    throw new CliError("E_ANSWERS_LIMIT", "The setup answers payload exceeds its 256 KiB limit.", { path });
  }
  return readFileNoFollow(path).toString("utf8");
}

function readBoundedStdin(limit: number): string {
  const chunks: Buffer[] = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const bytes = readSync(0, buffer, 0, buffer.byteLength, null);
    if (bytes === 0) break;
    total += bytes;
    if (total > limit) throw new CliError("E_ANSWERS_LIMIT", "The setup answers payload exceeds its 256 KiB limit.");
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    if (/password|cookie|credential|argv|raw(html|source)?|profile(path)?/i.test(key)) return true;
    return containsForbiddenField(child);
  });
}
