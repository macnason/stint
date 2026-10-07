import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError } from "../diagnostics.js";
import { canonicalJson, currentUtcMonth, validateConfig } from "../config.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import { parseImport, readImportFile, resolveFormat } from "./import.js";
import { renderHistoryReview } from "../documents/review.js";
import type { CommandResult } from "./types.js";

export async function extractCommand(
  options: ParsedOptions
): Promise<CommandResult> {
  rejectUnknownOptions(options, ["output", "format"], ["json"]);
  if (options.positionals.length !== 1)
    throw new CliError("E_COMMAND", "extract requires one local input file.", {
      exitCode: 2,
    });
  const input = resolve(options.positionals[0]!);
  const format = resolveFormat(input, options.values.format);
  const result = await parseImport(
    readImportFile(input, format),
    input,
    format
  );
  const validation = validateConfig(result.config, currentUtcMonth());
  if (!validation.valid)
    throw new CliError("E_CONFIG_INVALID", validation.errors[0]!.message);
  const output = options.values.output
    ? resolve(options.values.output)
    : undefined;
  if (output) {
    try {
      writeFileSync(output, canonicalJson(result.config), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      throw new CliError(
        "E_IO",
        "Could not create the draft. Choose a new filename in an existing directory; existing files are never overwritten.",
        { cause: error, path: output }
      );
    }
  }
  const warnings = [...result.warnings, ...validation.warnings];
  return {
    payload: {
      ok: true,
      state: "needs_review",
      format,
      ...(result.extraction ? { extraction: result.extraction } : {}),
      draft: result.config,
      warnings,
      ...(output ? { output } : {}),
    },
    human: `${renderHistoryReview({ ...result, warnings })}\n${
      output
        ? `Draft saved to ${output}. Review it, then run stint setup with that file.`
        : "To save an editable draft, rerun with --output draft.json."
    }`,
  };
}
