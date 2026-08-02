import { deriveTimelineBounds, isMonthString, monthToIndex } from "./timeline.js";
import type {
  DiagnosticCode,
  MonthString,
  NormalizeStintOptions,
  NormalizeStintResult,
  NormalizedStintExperience,
  NormalizedStintRole,
  StintDiagnostic,
} from "./types.js";

export const STINT_SCHEMA_VERSION = 1 as const;

interface MutableDiagnostics {
  errors: StintDiagnostic[];
  warnings: StintDiagnostic[];
}

const CONFIG_KEYS = new Set(["schemaVersion", "entries"]);
const ENTRY_KEYS = new Set([
  "id",
  "company",
  "location",
  "start",
  "end",
  "priority",
  "presentationId",
  "roles",
]);
const ROLE_KEYS = new Set(["id", "title", "start"]);

function addDiagnostic(
  diagnostics: MutableDiagnostics,
  severity: "error" | "warning",
  code: DiagnosticCode,
  path: string,
  message: string,
  relatedPaths?: readonly string[],
): void {
  diagnostics[severity === "error" ? "errors" : "warnings"].push({
    severity,
    code,
    path,
    message,
    ...(relatedPaths ? { relatedPaths } : {}),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  diagnostics: MutableDiagnostics,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-config",
      path ? `${path}.${key}` : key,
      "The configuration contains an unsupported field.",
    );
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validMonthIndex(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostics,
): number | null {
  if (!isMonthString(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-month",
      path,
      "Expected an ISO YYYY-MM month.",
    );
    return null;
  }
  return monthToIndex(value);
}

function result(
  config: NormalizeStintResult["config"],
  diagnostics: MutableDiagnostics,
): NormalizeStintResult {
  const errors = diagnostics.errors;
  const warnings = diagnostics.warnings;
  return {
    config: errors.length === 0 ? config : null,
    diagnostics: [...errors, ...warnings],
    errors,
    warnings,
  };
}

export function normalizeStintConfig(
  input: unknown,
  { referenceMonth }: NormalizeStintOptions,
): NormalizeStintResult {
  const diagnostics: MutableDiagnostics = { errors: [], warnings: [] };
  const referenceIndex = validMonthIndex(
    referenceMonth,
    "referenceMonth",
    diagnostics,
  );
  const source = asRecord(input);

  if (!source) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-config",
      "",
      "Expected a Stint configuration object.",
    );
    return result(null, diagnostics);
  }

  rejectUnknownKeys(source, CONFIG_KEYS, "", diagnostics);

  if (source.schemaVersion !== STINT_SCHEMA_VERSION) {
    addDiagnostic(
      diagnostics,
      "error",
      "unsupported-schema-version",
      "schemaVersion",
      `Expected schemaVersion ${STINT_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(source.entries)) {
    addDiagnostic(
      diagnostics,
      "error",
      "invalid-config",
      "entries",
      "Expected entries to be an array.",
    );
    return result(null, diagnostics);
  }

  const entryIds = new Set<string>();
  const roleIds = new Set<string>();
  const normalized: NormalizedStintExperience[] = [];
  const currentPaths: string[] = [];

  source.entries.forEach((entryValue, entryIndex) => {
    const path = `entries[${entryIndex}]`;
    const entry = asRecord(entryValue);
    if (!entry) {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-config",
        path,
        "Expected an experience entry object.",
      );
      return;
    }

    rejectUnknownKeys(entry, ENTRY_KEYS, path, diagnostics);

    const id = stringValue(entry.id) ?? "";
    if (!id.trim()) {
      addDiagnostic(
        diagnostics,
        "error",
        "empty-entry-id",
        `${path}.id`,
        "Experience IDs must not be empty.",
      );
    } else if (entryIds.has(id)) {
      addDiagnostic(
        diagnostics,
        "error",
        "duplicate-entry-id",
        `${path}.id`,
        `Duplicate experience ID: ${id}.`,
      );
    }
    if (id) entryIds.add(id);

    const company = stringValue(entry.company) ?? "";
    if (!company.trim()) {
      addDiagnostic(
        diagnostics,
        "error",
        "empty-company",
        `${path}.company`,
        "Company must not be empty.",
      );
    }


    if (entry.location !== undefined && typeof entry.location !== "string") {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-config",
        `${path}.location`,
        "Location must be a string when supplied.",
      );
    }
    if (
      entry.priority !== undefined &&
      (typeof entry.priority !== "number" || !Number.isFinite(entry.priority))
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-config",
        `${path}.priority`,
        "Priority must be a finite number when supplied.",
      );
    }
    if (
      entry.presentationId !== undefined &&
      typeof entry.presentationId !== "string"
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-config",
        `${path}.presentationId`,
        "Presentation ID must be a string when supplied.",
      );
    }

    const startIndex = validMonthIndex(
      entry.start,
      `${path}.start`,
      diagnostics,
    );
    const isCurrent = entry.end === null;
    const endIndexExclusive = isCurrent
      ? referenceIndex === null
        ? null
        : referenceIndex + 1
      : validMonthIndex(entry.end, `${path}.end`, diagnostics);

    if (
      startIndex !== null &&
      endIndexExclusive !== null &&
      startIndex >= endIndexExclusive
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "invalid-entry-span",
        `${path}.end`,
        "Entry end must be later than its start.",
      );
    }

    if (isCurrent) currentPaths.push(path);
    if (startIndex !== null && referenceIndex !== null && startIndex > referenceIndex) {
      addDiagnostic(
        diagnostics,
        "warning",
        "future-entry",
        `${path}.start`,
        "Entry starts after the supplied reference month.",
      );
    }
    const presentationId = stringValue(entry.presentationId);
    if (!presentationId?.trim()) {
      addDiagnostic(
        diagnostics,
        "warning",
        "missing-presentation",
        `${path}.presentationId`,
        "No optional presentation reference was supplied.",
      );
    }

    if (!Array.isArray(entry.roles) || entry.roles.length === 0) {
      addDiagnostic(
        diagnostics,
        "error",
        "empty-roles",
        `${path}.roles`,
        "Every experience entry needs at least one role.",
      );
      return;
    }

    const normalizedRoles: NormalizedStintRole[] = [];
    entry.roles.forEach((roleValue, roleIndex) => {
      const rolePath = `${path}.roles[${roleIndex}]`;
      const role = asRecord(roleValue);
      if (!role) {
        addDiagnostic(
          diagnostics,
          "error",
          "invalid-config",
          rolePath,
          "Expected a role object.",
        );
        return;
      }

      rejectUnknownKeys(role, ROLE_KEYS, rolePath, diagnostics);

      const roleId = stringValue(role.id) ?? "";
      if (!roleId.trim()) {
        addDiagnostic(
          diagnostics,
          "error",
          "empty-role-id",
          `${rolePath}.id`,
          "Role IDs must not be empty.",
        );
      } else if (roleIds.has(roleId)) {
        addDiagnostic(
          diagnostics,
          "error",
          "duplicate-role-id",
          `${rolePath}.id`,
          `Duplicate role ID: ${roleId}.`,
        );
      }
      if (roleId) roleIds.add(roleId);

      const title = stringValue(role.title) ?? "";
      if (!title.trim()) {
        addDiagnostic(
          diagnostics,
          "error",
          "empty-role-title",
          `${rolePath}.title`,
          "Role titles must not be empty.",
        );
      }

      const roleStartIndex = validMonthIndex(
        role.start,
        `${rolePath}.start`,
        diagnostics,
      );
      if (
        roleStartIndex !== null &&
        startIndex !== null &&
        endIndexExclusive !== null &&
        (roleStartIndex < startIndex || roleStartIndex >= endIndexExclusive)
      ) {
        addDiagnostic(
          diagnostics,
          "error",
          "role-outside-entry",
          `${rolePath}.start`,
          "Role start must fall within its experience entry.",
        );
      }

      if (roleStartIndex !== null) {
        normalizedRoles.push({
          id: roleId,
          title,
          start: role.start as MonthString,
          sourceOrder: roleIndex,
          startIndex: roleStartIndex,
          endIndexExclusive: endIndexExclusive ?? roleStartIndex,
        });
      }
    });

    normalizedRoles.sort(
      (left, right) =>
        left.startIndex - right.startIndex || left.sourceOrder - right.sourceOrder,
    );
    normalizedRoles.forEach((role, roleIndex) => {
      const nextRole = normalizedRoles[roleIndex + 1];
      role.endIndexExclusive = nextRole?.startIndex ?? endIndexExclusive ?? role.startIndex;
      if (role.endIndexExclusive <= role.startIndex) {
        addDiagnostic(
          diagnostics,
          "error",
          "zero-length-role",
          `${path}.roles[${role.sourceOrder}].start`,
          "Role spans must contain at least one month.",
        );
      }
    });

    if (startIndex !== null && endIndexExclusive !== null) {
      normalized.push({
        id,
        company,
        ...(typeof entry.location === "string" ? { location: entry.location } : {}),
        start: entry.start as MonthString,
        end: isCurrent ? null : (entry.end as MonthString),
        priority:
          typeof entry.priority === "number" && Number.isFinite(entry.priority)
            ? entry.priority
            : 0,
        ...(presentationId ? { presentationId } : {}),
        sourceOrder: entryIndex,
        startIndex,
        endIndexExclusive,
        isCurrent,
        roles: normalizedRoles,
      });
    }
  });

  if (currentPaths.length > 1) {
    addDiagnostic(
      diagnostics,
      "warning",
      "multiple-current-entries",
      "entries",
      "Multiple entries have a null end month.",
      currentPaths,
    );
  }

  normalized.sort(
    (left, right) =>
      left.startIndex - right.startIndex || left.sourceOrder - right.sourceOrder,
  );

  let farthestEnd: number | null = null;
  let farthestPath: string | null = null;
  normalized.forEach((entry) => {
    const path = `entries[${entry.sourceOrder}]`;
    if (farthestEnd !== null) {
      if (entry.startIndex < farthestEnd) {
        addDiagnostic(
          diagnostics,
          "warning",
          "overlap",
          path,
          "Entry overlaps an earlier experience span.",
          farthestPath ? [farthestPath] : undefined,
        );
      } else if (entry.startIndex > farthestEnd) {
        addDiagnostic(
          diagnostics,
          "warning",
          "gap",
          path,
          "There is a gap before this experience entry.",
          farthestPath ? [farthestPath] : undefined,
        );
      }
    }
    if (farthestEnd === null || entry.endIndexExclusive > farthestEnd) {
      farthestEnd = entry.endIndexExclusive;
      farthestPath = path;
    }
  });

  const config = {
    schemaVersion: STINT_SCHEMA_VERSION,
    referenceMonth,
    entries: normalized,
    bounds: deriveTimelineBounds(normalized),
  };
  return result(config, diagnostics);
}

export const validateStintConfig = normalizeStintConfig;

export * from "./timeline.js";
export type * from "./types.js";
