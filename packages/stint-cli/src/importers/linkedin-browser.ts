import { createHash } from "node:crypto";

import {
  addMonths,
  STINT_SCHEMA_VERSION,
  type MonthString,
  type StintExperience,
} from "@macworks/stint/schema";

import type { ImportResult, ImportWarning } from "./json.js";
import { CliError } from "../diagnostics.js";

export interface LinkedInBrowserItem {
  readonly text: string;
  readonly logoUrl?: string;
}

const MONTHS = new Map([
  ["jan", "01"], ["feb", "02"], ["mar", "03"], ["apr", "04"],
  ["may", "05"], ["jun", "06"], ["jul", "07"], ["aug", "08"],
  ["sep", "09"], ["sept", "09"], ["oct", "10"], ["nov", "11"], ["dec", "12"],
]);

/** Normalize only rendered, bounded experience text; raw page HTML never crosses this boundary. */
export function parseLinkedInBrowserItems(items: readonly LinkedInBrowserItem[]): ImportResult {
  const warnings: ImportWarning[] = [];
  const entries = new Map<string, StintExperience>();
  let totalText = 0;
  for (const [index, item] of items.entries()) {
    totalText += item.text.length + (item.logoUrl?.length ?? 0);
    if (totalText > 2 * 1024 * 1024) {
      throw new CliError("E_IMPORT_LIMIT", "The rendered LinkedIn experience data exceeds its 2 MiB limit.");
    }
    const lines = item.text.split(/\r?\n|\s{2,}/).map((line) => line.trim()).filter(Boolean);
    const span = parseSpan(item.text);
    if (!span) {
      warnings.push({ code: "linkedin-browser-date", message: `Experience ${index + 1} has no parseable month span and was held for review.`, path: `items[${index}]`, severity: "warning" });
      continue;
    }
    const title = (lines[0] ?? "Unspecified role").slice(0, 512);
    const company = (lines[1] ?? lines[0] ?? "Unspecified company").split(" · ")[0]!.trim().slice(0, 512);
    const location = lines.find((line) => /,|\b(remote|hybrid)\b/i.test(line) && !/\d{4}/.test(line))?.slice(0, 512);
    const key = `${company.toLowerCase()}\0${location ?? ""}`;
    const existing = entries.get(key);
    const role = { id: stableId(`${key}\0${title}\0${span.start}`), title, start: span.start };
    if (existing) {
      existing.roles = [...existing.roles, role];
      if (span.start < existing.start) existing.start = span.start;
      if (span.current) existing.end = null;
      else if (span.end && existing.end !== null && span.end > existing.end) existing.end = span.end;
      continue;
    }
    entries.set(key, {
      id: stableId(key),
      company,
      ...(location ? { location } : {}),
      start: span.start,
      end: span.end,
      roles: [role],
    });
  }
  return { config: { schemaVersion: STINT_SCHEMA_VERSION, entries: [...entries.values()] }, warnings };
}

function parseSpan(text: string): { start: MonthString; end: MonthString | null; current: boolean } | undefined {
  const matches = [...text.matchAll(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})/gi)];
  if (matches.length === 0) return undefined;
  const start = toMonth(matches[0]![1]!, matches[0]![2]!);
  if (!start) return undefined;
  const current = /present|current|now/i.test(text);
  const endMatch = matches[1];
  if (current || !endMatch) return { start, end: null, current };
  const end = toMonth(endMatch[1]!, endMatch[2]!);
  return { start, end: end ? addMonths(end, 1) : null, current: false };
}

function toMonth(month: string, year: string): MonthString | undefined {
  const number = MONTHS.get(month.slice(0, 4).toLowerCase()) ?? MONTHS.get(month.slice(0, 3).toLowerCase());
  return number ? `${year}-${number}` as MonthString : undefined;
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
