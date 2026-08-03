import { lstatSync } from "node:fs";

import {
  STINT_SCHEMA_VERSION,
  validateStintConfig,
  type MonthString,
  type StintConfig,
} from "@macworks/stint/schema";

import { CliError, publicSchemaDiagnostic } from "./diagnostics.js";
import { prepareDestination, readFileNoFollow } from "./project.js";

export const MAX_CONFIG_BYTES = 1024 * 1024;

export interface CanonicalConfigDocument {
  readonly config: StintConfig;
  readonly source: Buffer;
}

export function emptyStintConfig(): StintConfig {
  return { schemaVersion: STINT_SCHEMA_VERSION, entries: [] };
}

export function canonicalJson(config: StintConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function readCanonicalConfig(
  projectRoot: string,
  configPath: string,
): StintConfig {
  return readCanonicalConfigDocument(projectRoot, configPath).config;
}

export function readCanonicalConfigDocument(
  projectRoot: string,
  configPath: string,
): CanonicalConfigDocument {
  const destination = prepareDestination(projectRoot, configPath);
  let source: Buffer;
  try {
    const metadata = lstatSync(destination.absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CliError("E_SECURITY", "The configuration must be a regular JSON file.", {
        path: destination.relativePath,
      });
    }
    if (metadata.size > MAX_CONFIG_BYTES) {
      throw new CliError("E_CONFIG_PARSE", "The configuration exceeds the 1 MiB limit.", {
        path: destination.relativePath,
      });
    }
    source = readFileNoFollow(destination.absolutePath);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_NOT_FOUND", "The canonical JSON configuration was not found.", {
      cause: error,
      path: destination.relativePath,
    });
  }

  const text = source.toString("utf8");
  try {
    return { config: JSON.parse(text) as StintConfig, source };
  } catch (error) {
    const location = jsonErrorLocation(text, error);
    throw new CliError(
      "E_CONFIG_PARSE",
      location
        ? `The configuration is not valid JSON at line ${location.line}, column ${location.column}.`
        : "The configuration is not valid JSON.",
      { cause: error, path: destination.relativePath },
    );
  }
}

export function assertValidConfig(
  config: unknown,
  referenceMonth: MonthString,
): asserts config is StintConfig {
  const result = validateStintConfig(config, { referenceMonth });
  if (result.errors.length > 0) {
    const first = publicSchemaDiagnostic(result.errors[0]!);
    throw new CliError("E_CONFIG_INVALID", first.message, { path: first.path });
  }
}

export function validateConfig(
  config: unknown,
  referenceMonth: MonthString,
) {
  const result = validateStintConfig(config, { referenceMonth });
  return {
    valid: result.errors.length === 0,
    errors: result.errors.map(publicSchemaDiagnostic),
    warnings: result.warnings.map(publicSchemaDiagnostic),
  };
}

export function currentUtcMonth(): MonthString {
  return new Date().toISOString().slice(0, 7) as MonthString;
}

function jsonErrorLocation(
  source: string,
  error: unknown,
): { line: number; column: number } | null {
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
    if (token === '"') {
      inString = true;
    } else if (token === "{" || token === "[") {
      stack.push({ token, offset });
    } else if (token === "}" || token === "]") {
      const expected = token === "}" ? "{" : "[";
      if (stack.at(-1)?.token !== expected) return offset;
      stack.pop();
    }
  }
  if (inString) return Math.max(0, source.length - 1);
  return stack.at(-1)?.offset ?? Math.max(0, source.length - 1);
}
