import type { MonthString } from "@macworks/stint/schema";

import {
  currentUtcMonth,
  readCanonicalConfig,
  validateConfig,
} from "../config.js";
import { CliError } from "../diagnostics.js";
import {
  rejectUnknownOptions,
  requireOption,
  type ParsedOptions,
} from "../options.js";
import { resolveProject } from "../project.js";
import { monthOption } from "./shared.js";
import type { CommandResult } from "./types.js";

export function validateCommand(options: ParsedOptions): CommandResult {
  rejectUnknownOptions(
    options,
    ["project", "config", "reference-month"],
    ["json"]
  );
  if (options.positionals.length > 0) {
    throw new CliError(
      "E_COMMAND",
      "validate does not accept positional arguments.",
      {
        exitCode: 2,
      }
    );
  }
  const project = resolveProject(requireOption(options, "project"));
  const configPath = requireOption(options, "config");
  const rawReference = options.values["reference-month"];
  const referenceMonth: MonthString = rawReference
    ? monthOption(rawReference, "reference-month")
    : currentUtcMonth();
  const config = readCanonicalConfig(project.root, configPath);
  const result = validateConfig(config, referenceMonth);
  if (!result.valid) {
    const first = result.errors[0];
    throw new CliError(
      "E_CONFIG_INVALID",
      first?.message ?? "The configuration is invalid.",
      {
        path: first?.path,
        details: {
          valid: false,
          errors: result.errors,
          warnings: result.warnings,
        },
      }
    );
  }
  return {
    payload: {
      ok: true,
      valid: true,
      config: configPath,
      entries: config.entries.length,
      warnings: result.warnings,
    },
    human: `Valid Stint configuration with ${config.entries.length} entries and ${result.warnings.length} warnings.`,
  };
}
