import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import {
  addMonths,
  isMonthString,
  STINT_SCHEMA_VERSION,
  type MonthString,
  type StintExperience,
  type StintRole,
} from "@macnas/stint/schema";

import { CliError } from "../diagnostics.js";
import { decodeUtf8, type ImportResult, type ImportWarning } from "./json.js";

export const MAX_LINKEDIN_CSV_BYTES = 8 * 1024 * 1024;
export const MAX_LINKEDIN_ROWS = 10_000;
const MAX_CSV_RECORD_BYTES = 128 * 1024;

const HEADER_ALIASES = {
  company: ["company name", "company"],
  title: ["title", "position title"],
  location: ["location"],
  start: ["started on", "start date"],
  end: ["finished on", "end date"],
} as const;

interface PositionRow {
  readonly sourceOrder: number;
  readonly company: string;
  readonly location?: string;
  readonly title: string;
  readonly start: MonthString;
  readonly end: MonthString | null;
}

interface PositionGroup {
  readonly company: string;
  readonly location?: string;
  readonly start: MonthString;
  end: MonthString | null;
  readonly roles: Array<{ title: string; start: MonthString }>;
}

export function parseLinkedInCsv(
  source: Buffer,
  sourcePath: string,
): ImportResult {
  if (source.byteLength > MAX_LINKEDIN_CSV_BYTES) {
    throw new CliError("E_IMPORT_LIMIT", "The CSV input exceeds the 8 MiB limit.", {
      path: sourcePath,
    });
  }
  const text = decodeUtf8(source, sourcePath, "CSV");
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      columns: false,
      max_record_size: MAX_CSV_RECORD_BYTES,
      relax_column_count: false,
      skip_empty_lines: true,
    }) as string[][];
  } catch (error) {
    const lines = safeCsvLine(error);
    throw new CliError(
      error instanceof Error && /max_record_size/i.test(error.message)
        ? "E_IMPORT_LIMIT"
        : "E_IMPORT_PARSE",
      `The CSV input is malformed${lines ? ` near line ${lines}` : ""}.`,
      { cause: error, path: sourcePath },
    );
  }
  if (records.length === 0) {
    throw new CliError("E_IMPORT_PARSE", "The CSV input has no header row.", {
      path: sourcePath,
    });
  }
  if (records.length - 1 > MAX_LINKEDIN_ROWS) {
    throw new CliError("E_IMPORT_LIMIT", "The CSV input exceeds the row limit.", {
      path: sourcePath,
    });
  }

  const headers = records[0]!.map(normalizeHeader);
  const columns = resolveColumns(headers, sourcePath);
  const warnings: ImportWarning[] = [];
  const knownIndexes = new Set(Object.values(columns).filter((value) => value !== undefined));
  const unknownCount = headers.filter((_header, index) => !knownIndexes.has(index)).length;
  if (unknownCount > 0) {
    warnings.push({
      code: "linkedin-unknown-columns",
      message: `${unknownCount} unrecognized LinkedIn column${unknownCount === 1 ? " was" : "s were"} ignored.`,
      path: "header",
      severity: "warning",
    });
  }

  const rows = records.slice(1).map((record, index) => {
    const rowNumber = index + 2;
    const company = requiredCell(record, columns.company, rowNumber, sourcePath);
    const title = requiredCell(record, columns.title, rowNumber, sourcePath);
    const start = parseLinkedInMonth(
      requiredCell(record, columns.start, rowNumber, sourcePath),
      rowNumber,
      "start",
      sourcePath,
    );
    const rawEnd = record[columns.end]?.trim() ?? "";
    const end = !rawEnd || /^(present|current)$/i.test(rawEnd)
      ? null
      : nextMonth(parseLinkedInMonth(rawEnd, rowNumber, "finish", sourcePath));
    if (end !== null && end <= start) {
      throw rowError(rowNumber, "The finished month precedes the started month.", sourcePath);
    }
    const location = columns.location === undefined
      ? undefined
      : record[columns.location]?.trim() || undefined;
    return { sourceOrder: index, company, title, start, end, location } satisfies PositionRow;
  });

  return {
    config: { schemaVersion: STINT_SCHEMA_VERSION, entries: buildEntries(rows) },
    warnings,
  };
}

function resolveColumns(headers: readonly string[], sourcePath: string) {
  const resolved: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof typeof HEADER_ALIASES, readonly string[]]
  >) {
    const matches = headers.flatMap((header, index) =>
      aliases.includes(header) ? [index] : [],
    );
    if (matches.length > 1) {
      throw new CliError(
        "E_IMPORT_SCHEMA",
        "The LinkedIn Positions header is ambiguous after normalization.",
        { path: sourcePath },
      );
    }
    if (matches[0] !== undefined) resolved[field] = matches[0];
  }
  if (
    resolved.company === undefined ||
    resolved.title === undefined ||
    resolved.start === undefined ||
    resolved.end === undefined
  ) {
    throw new CliError(
      "E_IMPORT_SCHEMA",
      "The required LinkedIn Positions columns are missing or unsupported.",
      { path: sourcePath },
    );
  }
  return resolved as {
    company: number;
    title: number;
    start: number;
    end: number;
    location?: number;
  };
}

function buildEntries(rows: readonly PositionRow[]): StintExperience[] {
  const sorted = [...rows].sort(
    (left, right) =>
      left.start.localeCompare(right.start) || left.sourceOrder - right.sourceOrder,
  );
  const groups: PositionGroup[] = [];
  const continuations = new Map<string, PositionGroup[]>();
  for (const row of sorted) {
    const identity = `${normalizeIdentity(row.company)}\0${normalizeIdentity(row.location ?? "")}`;
    const continuationKey = `${identity}\0${row.start}`;
    const candidates = continuations.get(continuationKey);
    let group = candidates?.pop();
    if (candidates?.length === 0) continuations.delete(continuationKey);

    if (group) {
      group.roles.push({ title: row.title, start: row.start });
      group.end = row.end;
    } else {
      group = {
        company: row.company,
        ...(row.location ? { location: row.location } : {}),
        start: row.start,
        end: row.end,
        roles: [{ title: row.title, start: row.start }],
      };
      groups.push(group);
    }

    if (row.end !== null) {
      const nextKey = `${identity}\0${row.end}`;
      const nextCandidates = continuations.get(nextKey) ?? [];
      nextCandidates.push(group);
      continuations.set(nextKey, nextCandidates);
    }
  }

  const usedEntryIds = new Map<string, number>();
  const usedRoleIds = new Map<string, number>();
  return groups.map((group): StintExperience => {
    const entrySeed = stableSeed(group);
    const entryId = uniqueId(
      `${slug(group.company) || "experience"}-${group.start}-${shortHash(entrySeed)}`,
      usedEntryIds,
    );
    const roles: StintRole[] = group.roles.map((role) => ({
      id: uniqueId(
        `${entryId}-${slug(role.title) || "role"}-${shortHash(`${role.title}\0${role.start}`)}`,
        usedRoleIds,
      ),
      title: role.title,
      start: role.start,
    }));
    return {
      id: entryId,
      company: group.company,
      ...(group.location ? { location: group.location } : {}),
      start: group.start,
      end: group.end,
      roles,
    };
  });
}

function parseLinkedInMonth(
  value: string,
  rowNumber: number,
  field: string,
  sourcePath: string,
): MonthString {
  if (isMonthString(value)) return value;
  const named = /^([A-Za-z]+)\s+(\d{4})$/.exec(value);
  const numeric = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(value);
  const month = named ? MONTHS.get(named[1]!.toLowerCase()) : numeric ? Number(numeric[1]) : undefined;
  const year = Number(named?.[2] ?? numeric?.[2]);
  if (!month || !Number.isSafeInteger(year) || year < 1000 || year > 9999) {
    throw rowError(rowNumber, `The ${field} month is unsupported.`, sourcePath);
  }
  return `${year}-${String(month).padStart(2, "0")}` as MonthString;
}

const MONTHS: ReadonlyMap<string, number> = new Map(
  [
    ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
    ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
    ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
    ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
    ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
    ["dec", 12], ["december", 12],
  ] as const,
);

function nextMonth(month: MonthString): MonthString {
  return addMonths(month, 1);
}

function requiredCell(
  record: readonly string[],
  index: number,
  rowNumber: number,
  sourcePath: string,
): string {
  const value = record[index]?.trim() ?? "";
  if (!value) throw rowError(rowNumber, "A required value is empty.", sourcePath);
  return value;
}

function rowError(rowNumber: number, message: string, sourcePath: string): CliError {
  return new CliError("E_IMPORT_SCHEMA", `LinkedIn Positions row ${rowNumber}: ${message}`, {
    path: sourcePath,
  });
}

function normalizeHeader(value: string): string {
  return value.replace(/^\ufeff/, "").trim().toLowerCase().replace(/[_\W]+/g, " ").trim();
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function stableSeed(group: PositionGroup): string {
  return JSON.stringify([
    normalizeIdentity(group.company),
    normalizeIdentity(group.location ?? ""),
    group.start,
    group.end,
    group.roles.map((role) => [normalizeIdentity(role.title), role.start]),
  ]);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function uniqueId(base: string, used: Map<string, number>): string {
  const occurrence = (used.get(base) ?? 0) + 1;
  used.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

function safeCsvLine(error: unknown): number | null {
  if (error && typeof error === "object" && "lines" in error) {
    const lines = Number((error as { lines?: unknown }).lines);
    return Number.isSafeInteger(lines) && lines > 0 ? lines : null;
  }
  return null;
}
