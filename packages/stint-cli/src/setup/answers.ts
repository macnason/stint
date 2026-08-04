import { readFileSync } from "node:fs";

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
    source = (path === "-" ? readFileSync(0) : readFileNoFollow(path)).toString("utf8");
  } catch (error) {
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
  return parsed as unknown as SetupAnswers;
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    if (/password|cookie|credential|argv|raw(html|source)?|profile(path)?/i.test(key)) return true;
    return containsForbiddenField(child);
  });
}
