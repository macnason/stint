import type { DiagnosticCode, StintDiagnostic } from "@macworks/stint/schema";

export type CliErrorCode =
  | "E_COMMAND"
  | "E_CONFLICT"
  | "E_CONFIG_INVALID"
  | "E_CONFIG_PARSE"
  | "E_DUPLICATE_ID"
  | "E_ARCHIVE"
  | "E_IMPORT_FORMAT"
  | "E_IMPORT_LIMIT"
  | "E_IMPORT_PARSE"
  | "E_IMPORT_SCHEMA"
  | "E_IO"
  | "E_NOT_FOUND"
  | "E_OPTION"
  | "E_PROJECT"
  | "E_REQUIRED_OPTION"
  | "E_SECURITY";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly exitCode: number;
  readonly path?: string;

  constructor(
    code: CliErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: Readonly<Record<string, unknown>>;
      exitCode?: number;
      path?: string;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.details = options.details;
    this.exitCode = options.exitCode ?? 1;
    this.path = options.path;
  }
}

export interface PublicDiagnostic {
  code: string;
  message: string;
  path?: string;
  relatedPaths?: readonly string[];
  severity?: "error" | "warning";
}

const SAFE_SCHEMA_MESSAGES = {
  "duplicate-entry-id": "An experience ID is duplicated.",
  "duplicate-role-id": "A role ID is duplicated.",
  "empty-company": "A company value is empty.",
  "empty-entry-id": "An experience ID is empty.",
  "empty-role-id": "A role ID is empty.",
  "empty-role-title": "A role title is empty.",
  "empty-roles": "An experience has no roles.",
  "future-entry": "An experience starts after the reference month.",
  gap: "The data contains an employment gap.",
  "invalid-config": "The configuration structure is invalid.",
  "invalid-entry-span": "An experience span is invalid.",
  "invalid-month": "A month value is invalid.",
  "missing-presentation": "Optional presentation metadata is absent.",
  "multiple-current-entries": "Multiple current experiences are present.",
  overlap: "Experience spans overlap.",
  "role-outside-entry": "A role falls outside its experience span.",
  "unsupported-schema-version": "The schema version is unsupported.",
  "zero-length-role": "A role span has no duration.",
} satisfies Record<DiagnosticCode, string>;

export function publicSchemaDiagnostic(
  diagnostic: Pick<
    StintDiagnostic,
    "code" | "path" | "relatedPaths" | "severity"
  >
): PublicDiagnostic {
  return {
    code: diagnostic.code,
    message: SAFE_SCHEMA_MESSAGES[diagnostic.code],
    path: diagnostic.path,
    ...(diagnostic.relatedPaths
      ? { relatedPaths: diagnostic.relatedPaths }
      : {}),
    severity: diagnostic.severity,
  };
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return new CliError("E_IO", "The operation could not be completed.", {
    cause: error,
  });
}

export function publicCliError(error: CliError): PublicDiagnostic {
  return {
    code: error.code,
    message: error.message,
    ...(error.path ? { path: error.path } : {}),
    severity: "error",
    ...error.details,
  };
}
