import type { StintConfig } from "@macworks/stint/schema";

import { CliError } from "../diagnostics.js";

export const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;

export interface ImportResult {
  readonly config: StintConfig;
  readonly extraction?: { readonly pages: number; readonly ocrPages: number };
  readonly warnings: readonly ImportWarning[];
}

export interface ImportWarning {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly severity: "warning";
}

export function parseJsonImport(source: Buffer, sourcePath: string): ImportResult {
  if (source.byteLength > MAX_JSON_BYTES) {
    throw new CliError("E_IMPORT_LIMIT", "The JSON input exceeds the 1 MiB limit.", {
      path: sourcePath,
    });
  }
  const text = decodeUtf8(source, sourcePath, "JSON");
  assertJsonDepth(text, sourcePath);
  try {
    return { config: JSON.parse(text) as StintConfig, warnings: [] };
  } catch (error) {
    const { line, column } = jsonErrorLocation(text, error);
    throw new CliError(
      "E_IMPORT_PARSE",
      `The JSON input is invalid at line ${line}, column ${column}.`,
      { cause: error, path: sourcePath },
    );
  }
}

export function decodeUtf8(
  source: Buffer,
  sourcePath: string,
  format: string,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (error) {
    throw new CliError("E_IMPORT_PARSE", `The ${format} input is not valid UTF-8.`, {
      cause: error,
      path: sourcePath,
    });
  }
}

function assertJsonDepth(source: string, sourcePath: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const token of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (token === "\\") escaped = true;
      else if (token === '"') inString = false;
      continue;
    }
    if (token === '"') inString = true;
    else if (token === "{" || token === "[") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new CliError("E_IMPORT_LIMIT", "The JSON input exceeds the nesting limit.", {
          path: sourcePath,
        });
      }
    } else if (token === "}" || token === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
}

function jsonErrorLocation(
  source: string,
  error: unknown,
): { line: number; column: number } {
  const message = error instanceof Error ? error.message : "";
  const match = /position\s+(\d+)/i.exec(message);
  const position = match ? Number(match[1]) : structuralMismatchOffset(source);
  const preceding = source.slice(0, position);
  const lines = preceding.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function structuralMismatchOffset(source: string): number {
  const stack: Array<{ token: "{" | "["; offset: number }> = [];
  let inString = false;
  let escaped = false;
  for (let offset = 0; offset < source.length; offset += 1) {
    const token = source[offset]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (token === "\\") escaped = true;
      else if (token === '"') inString = false;
      continue;
    }
    if (token === '"') inString = true;
    else if (token === "{" || token === "[") stack.push({ token, offset });
    else if (token === "}" || token === "]") {
      const expected = token === "}" ? "{" : "[";
      if (stack.at(-1)?.token !== expected) return offset;
      stack.pop();
    }
  }
  return stack.at(-1)?.offset ?? Math.max(0, source.length - 1);
}
