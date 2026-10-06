import { addMonths } from "@macworks/stint/schema";
import type { ImportResult } from "../importers/json.js";

interface ReviewWarning {
  message: string;
  code?: string;
  path?: string;
  relatedPaths?: readonly string[];
}

export function renderHistoryReview(result: {
  config: ImportResult["config"];
  warnings: readonly ReviewWarning[];
}): string {
  const safe = (text: string) =>
    text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const companyAt = (path?: string) => {
    const match = /^entries\[(\d+)\]/.exec(path ?? "");
    return match ? result.config.entries[Number(match[1])]?.company : undefined;
  };
  const warnings = result.warnings
    .filter((w) => w.code !== "missing-presentation")
    .map((w) => {
      const company = companyAt(w.path),
        related = companyAt(w.relatedPaths?.[0]);
      return w.code === "overlap" && company && related
        ? `Review: ${safe(company)} overlaps ${safe(
            related
          )}. Check the dates or concurrent roles.`
        : `Review: ${safe(w.message)}`;
    });
  return [
    ...result.config.entries.flatMap((entry) => [
      `${safe(entry.company)} · ${entry.start} → ${
        entry.end ? addMonths(entry.end, -1) : "Present"
      }`,
      ...entry.roles.map((role) => `  ${safe(role.title)} · ${role.start}`),
    ]),
    ...new Set(warnings),
  ].join("\n");
}
