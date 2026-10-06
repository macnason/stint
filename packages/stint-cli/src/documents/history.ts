import { addMonths, type MonthString } from "@macworks/stint/schema";
import { parseLinkedInCsv } from "../importers/linkedin-csv.js";
import type { ImportResult, ImportWarning } from "../importers/json.js";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const SPAN = new RegExp(
  `^(${MONTH}\\s+\\d{4})\\s*[-–—]\\s*(${MONTH}\\s+\\d{4}|Present|Current)(?:\\s|$)`,
  "i"
);
const DURATION =
  /^(?:Full-time\s*[·•–—-]\s*)?\d+\s+(?:years?|yrs?|months?|mos?)(?:\s+\d+\s+(?:months?|mos?))?$/i;
const EMPLOYMENT =
  /\s+[·•–—-]\s*(?:Full-time|Part-time|Self-employed|Contract|Freelance|Internship|Apprenticeship)$/i;
const STOP =
  /^(?:Education|Licenses? (?:&|and) certifications?|Skills|Languages|Recommendations|Interests|Volunteer experience|Honors (?:&|and) awards)$/i;
const META =
  /^(?:Page \d+ of \d+|\d+ of \d+|Experience|Full-time|Part-time|Self-employed|Contract|Freelance|Internship|Remote|Hybrid|On-site)$/i;

/** Conservative English LinkedIn layout reader. Uncertain rows stay unresolved. */
export function parseDocumentHistory(
  text: string,
  layout: "pdf" | "image"
): ImportResult {
  let lines = text
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const heading = lines.findIndex((l) => /^[<←\s]*Experience[|\s]*$/i.test(l));
  if (heading >= 0) lines = lines.slice(heading + 1);
  const stop = lines.findIndex((l) => STOP.test(l));
  if (stop >= 0) lines = lines.slice(0, stop);
  lines = lines.filter(
    (l) => !META.test(l) && !/^Skills:/i.test(l) && !/\+\d+ skills$/i.test(l)
  );
  const warnings: ImportWarning[] = [
    {
      code: "document-review",
      message:
        "Check every extracted company, role and date against the document before applying. English LinkedIn layouts are supported; OCR can misread text.",
      path: "document",
      severity: "warning",
    },
  ];
  const rows: string[][] = [];
  let groupedCompany: string | undefined;
  let group = 0;
  const groupedRows: {
    row: string[];
    group: number;
    start: MonthString;
    end: MonthString | null;
  }[] = [];
  let boundary = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (DURATION.test(line)) {
      group++;
      groupedCompany = i > boundary ? lines[i - 1] : undefined;
      boundary = i + 1;
      continue;
    }
    if (!/\b\d{4}\s*[-–—]/.test(line)) continue;
    const span = SPAN.exec(line);
    const before = lines.slice(boundary, i);
    let company: string | undefined;
    let title: string | undefined;
    if (
      layout === "image" &&
      before.length >= 2 &&
      EMPLOYMENT.test(before.at(-1)!)
    ) {
      company = before.at(-1)!.replace(EMPLOYMENT, "");
      title = before.at(-2);
      groupedCompany = undefined;
    } else if (
      groupedCompany &&
      before.length > 0 &&
      before.slice(0, -1).every((line) => line.includes(","))
    ) {
      company = groupedCompany;
      title = before.at(-1);
    } else if (!groupedCompany && before.length >= 2) {
      [company, title] =
        layout === "pdf" ? before.slice(-2) : before.slice(-2).reverse();
    }
    company = company
      ?.replace(EMPLOYMENT, "")
      .split(/\s+[·•]\s+/)[0]
      ?.trim();
    if (
      !span ||
      !company ||
      !title ||
      company.length > 512 ||
      title.length > 512
    ) {
      warnings.push({
        code: "document-unresolved",
        message: `Date range near document line ${
          i + 1
        } needs manual review; no months or employer were guessed.`,
        path: `document.lines[${i}]`,
        severity: "warning",
      });
    } else {
      try {
        // Validate each row independently so one damaged OCR date does not hide valid entries.
        const entry = parseLinkedInCsv(
          Buffer.from(
            "Company Name,Title,Started On,Finished On\n" +
              [company, title, span[1]!, span[2]!]
                .map((v) => `"${v.replaceAll('"', '""')}"`)
                .join(",")
          ),
          "document"
        ).config.entries[0]!;
        const row = [company, title, span[1]!, span[2]!];
        rows.push(row);
        if (groupedCompany)
          groupedRows.push({ row, group, start: entry.start, end: entry.end });
      } catch {
        warnings.push({
          code: "document-unresolved",
          message: `Invalid dates near document line ${
            i + 1
          }; correct this entry in the draft.`,
          path: `document.lines[${i}]`,
          severity: "warning",
        });
      }
    }
    boundary = i + 1;
  }
  if (
    rows.length === 0 &&
    !warnings.some((w) => w.code === "document-unresolved")
  ) {
    warnings.push({
      code: "document-unresolved",
      message:
        "No complete experience entries were recognized. Use an English LinkedIn PDF or crop a screenshot to Experience; alternatively use a CSV export.",
      path: "document",
      severity: "warning",
    });
  }
  groupedRows.sort(
    (a, b) => a.group - b.group || a.start.localeCompare(b.start)
  );
  for (let i = 0; i < groupedRows.length - 1; i++) {
    const current = groupedRows[i]!,
      next = groupedRows[i + 1]!;
    if (
      current.group === next.group &&
      current.end === addMonths(next.start, 1) &&
      current.start < next.start
    ) {
      current.row[3] = addMonths(next.start, -1);
      warnings.push({
        code: "document-promotion-boundary",
        message:
          "Grouped roles share a transition month; the newer role begins at its stated start month. Review the promotion boundary.",
        path: "document",
        severity: "warning",
      });
    }
  }
  const csv = [["Company Name", "Title", "Started On", "Finished On"], ...rows]
    .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const parsed = parseLinkedInCsv(Buffer.from(csv), "document");
  return { config: parsed.config, warnings: [...warnings, ...parsed.warnings] };
}
