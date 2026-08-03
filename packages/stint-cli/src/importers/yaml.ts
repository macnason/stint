import { isAlias, parseDocument } from "yaml";
import type { StintConfig } from "@macworks/stint/schema";

import { CliError } from "../diagnostics.js";
import { decodeUtf8, type ImportResult } from "./json.js";

export const MAX_YAML_BYTES = 1024 * 1024;
const MAX_YAML_DEPTH = 64;
const MAX_YAML_NODES = 50_000;

export function parseYamlImport(source: Buffer, sourcePath: string): ImportResult {
  if (source.byteLength > MAX_YAML_BYTES) {
    throw new CliError("E_IMPORT_LIMIT", "The YAML input exceeds the 1 MiB limit.", {
      path: sourcePath,
    });
  }
  const text = decodeUtf8(source, sourcePath, "YAML");
  const document = parseDocument(text, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  const unsafe = inspectNode(document.contents, 0, { count: 0 });
  if (unsafe === "alias") {
    throw new CliError("E_SECURITY", "YAML aliases are not supported.", {
      path: sourcePath,
    });
  }
  if (unsafe === "tag") {
    throw new CliError("E_SECURITY", "YAML custom tags are not supported.", {
      path: sourcePath,
    });
  }
  if (unsafe === "depth") {
    throw new CliError("E_IMPORT_LIMIT", "The YAML input exceeds the nesting limit.", {
      path: sourcePath,
    });
  }
  if (unsafe === "nodes") {
    throw new CliError("E_IMPORT_LIMIT", "The YAML input exceeds the node limit.", {
      path: sourcePath,
    });
  }
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const issue = document.errors[0] ?? document.warnings[0]!;
    const location = yamlErrorLocation(text, issue);
    throw new CliError(
      "E_IMPORT_PARSE",
      `The YAML input is invalid at line ${location.line}, column ${location.column}.`,
      { cause: issue, path: sourcePath },
    );
  }
  try {
    return {
      config: document.toJS({ maxAliasCount: 0 }) as StintConfig,
      warnings: [],
    };
  } catch (error) {
    throw new CliError("E_IMPORT_PARSE", "The YAML input could not be decoded safely.", {
      cause: error,
      path: sourcePath,
    });
  }
}

function yamlErrorLocation(
  source: string,
  issue: { linePos?: readonly { line: number; col: number }[]; pos?: readonly number[] },
): { line: number; column: number } {
  const direct = issue.linePos?.[0];
  if (direct) return { line: direct.line, column: direct.col };
  const preceding = source.slice(0, issue.pos?.[0] ?? 0);
  const lines = preceding.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

type UnsafeNode = "alias" | "tag" | "depth" | "nodes" | null;

function inspectNode(
  node: unknown,
  depth: number,
  state: { count: number },
): UnsafeNode {
  if (node === null || node === undefined) return null;
  state.count += 1;
  if (state.count > MAX_YAML_NODES) return "nodes";
  if (depth > MAX_YAML_DEPTH) return "depth";
  if (isAlias(node)) return "alias";
  if (typeof node !== "object") return null;

  const record = node as {
    tag?: string;
    items?: readonly unknown[];
    key?: unknown;
    value?: unknown;
  };
  if (record.tag?.startsWith("!") || record.tag?.startsWith("tag:")) return "tag";
  for (const item of record.items ?? []) {
    const issue = inspectNode(item, depth + 1, state);
    if (issue) return issue;
  }
  const keyIssue = inspectNode(record.key, depth + 1, state);
  if (keyIssue) return keyIssue;
  return inspectNode(record.value, depth + 1, state);
}
