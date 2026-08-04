import { inspectProject } from "../project.js";
import { CliError } from "../diagnostics.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import type { CommandResult } from "./types.js";

export function doctorCommand(options: ParsedOptions): CommandResult {
  rejectUnknownOptions(options, ["project"], ["json"]);
  if (options.positionals.length > 0) {
    throw new CliError("E_COMMAND", "doctor does not accept positional arguments.", { exitCode: 2 });
  }
  const inspection = inspectProject(options.values.project ?? ".");
  const payload = {
    ok: true,
    project: inspection.project.root,
    framework: inspection.framework,
    packageManager: inspection.packageManager,
    existingStintDependency: inspection.existingStintDependency,
    likelyConfigPath: inspection.likelyConfigPath,
    likelyDataPath: inspection.likelyDataPath,
    existingFiles: inspection.existingFiles,
    ambiguities: inspection.ambiguities,
  };
  return {
    payload,
    human: `Project ${inspection.project.root}\nFramework: ${inspection.framework}\nPackage manager: ${inspection.packageManager}\nStint dependency: ${inspection.existingStintDependency ? "present" : "not found"}`,
  };
}
