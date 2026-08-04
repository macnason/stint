import { lstatSync } from "node:fs";
import { extname, resolve } from "node:path";
import { currentUtcMonth, validateConfig } from "../config.js";
import { CliError } from "../diagnostics.js";
import { parseJsonImport, type ImportResult } from "../importers/json.js";
import { parseLinkedInCsv } from "../importers/linkedin-csv.js";
import { MAX_ZIP_BYTES, parseLinkedInZip } from "../importers/linkedin-zip.js";
import { parseYamlImport } from "../importers/yaml.js";
import { monthOption } from "./shared.js";
import { readFileNoFollow } from "../project.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import {
  executePlan,
  mutationOptions,
  MUTATION_COMMON_VALUES,
  planConfigWrites,
  publicPlan,
} from "./shared.js";
import type { CommandResult } from "./types.js";

const IMPORT_VALUES = [
  ...MUTATION_COMMON_VALUES,
  "format",
  "reference-month",
] as const;

type ImportFormat = "json" | "yaml" | "linkedin-csv" | "linkedin-zip";

export async function importCommand(
  options: ParsedOptions,
  isTTY: boolean,
): Promise<CommandResult> {
  rejectUnknownOptions(options, IMPORT_VALUES, ["dry-run", "json"]);
  if (options.positionals.length !== 1) {
    throw new CliError("E_COMMAND", "import requires exactly one input file.", {
      exitCode: 2,
    });
  }
  const common = mutationOptions(options, isTTY, { requireExplicitPaths: false });
  const inputPath = resolve(options.positionals[0]!);
  const format = resolveFormat(inputPath, options.values.format);
  const source = readImportFile(inputPath, format);
  const imported = await parseImport(source, inputPath, format);
  const referenceMonth = options.values["reference-month"]
    ? monthOption(options.values["reference-month"], "reference-month")
    : currentUtcMonth();
  const validation = validateConfig(imported.config, referenceMonth);
  if (!validation.valid) {
    const first = validation.errors[0]!;
    throw new CliError("E_CONFIG_INVALID", first.message, { path: first.path });
  }

  const dryRun = options.flags.has("dry-run");
  const plan = planConfigWrites({
    projectRoot: common.project.root,
    configPath: common.configPath,
    dataPath: common.dataPath,
    conflict: common.conflict,
    config: imported.config,
    referenceMonth,
  });
  executePlan(plan, dryRun);
  const warnings = [...imported.warnings, ...validation.warnings];
  return {
    payload: {
      ...publicPlan(plan, dryRun),
      format,
      importedEntries: imported.config.entries.length,
      warningCount: warnings.length,
      warnings,
    },
    human: `${dryRun ? "Planned" : "Imported"} ${imported.config.entries.length} experience entries with ${warnings.length} warnings.`,
  };
}

function readImportFile(inputPath: string, format: ImportFormat): Buffer {
  try {
    const metadata = lstatSync(inputPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new CliError("E_SECURITY", "Import input must be a regular file.", {
        path: inputPath,
      });
    }
    const maximum = format === "linkedin-zip" ? MAX_ZIP_BYTES : 8 * 1024 * 1024;
    if (metadata.size > maximum) {
      throw new CliError("E_IMPORT_LIMIT", "The import input exceeds its byte limit.", {
        path: inputPath,
      });
    }
    return readFileNoFollow(inputPath);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_NOT_FOUND", "The import input could not be read.", {
      cause: error,
      path: inputPath,
    });
  }
}

async function parseImport(
  source: Buffer,
  inputPath: string,
  format: ImportFormat,
): Promise<ImportResult> {
  switch (format) {
    case "json":
      return parseJsonImport(source, inputPath);
    case "yaml":
      return parseYamlImport(source, inputPath);
    case "linkedin-csv":
      return parseLinkedInCsv(source, inputPath);
    case "linkedin-zip":
      return parseLinkedInZip(source, inputPath);
  }
}

function resolveFormat(inputPath: string, requested?: string): ImportFormat {
  if (requested && requested !== "auto") {
    if (
      requested === "json" ||
      requested === "yaml" ||
      requested === "linkedin-csv" ||
      requested === "linkedin-zip"
    ) {
      return requested;
    }
    throw new CliError(
      "E_OPTION",
      "Import format must be auto, json, yaml, linkedin-csv, or linkedin-zip.",
      { exitCode: 2 },
    );
  }
  switch (extname(inputPath).toLowerCase()) {
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".csv":
      return "linkedin-csv";
    case ".zip":
      return "linkedin-zip";
    default:
      throw new CliError(
        "E_IMPORT_FORMAT",
        "The import format could not be inferred; pass --format explicitly.",
        { path: inputPath },
      );
  }
}
