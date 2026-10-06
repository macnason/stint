import { discoverLocalCapabilities, recommendOnboarding } from "../setup/onboarding.js";
import { inspectProject, publicProjectInspection } from "../project.js";
import { CliError } from "../diagnostics.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import type { CommandResult } from "./types.js";

export function doctorCommand(options: ParsedOptions): CommandResult {
  rejectUnknownOptions(options, ["project"], ["json"]);
  if (options.positionals.length > 0) {
    throw new CliError("E_COMMAND", "doctor does not accept positional arguments.", { exitCode: 2 });
  }
  const inspection = inspectProject(options.values.project ?? ".");
  const inspectionPayload = publicProjectInspection(inspection);
  const payload = {
    ok: true,
    project: inspectionPayload.root,
    ...inspectionPayload,
    capabilities: discoverLocalCapabilities(),
    onboarding: recommendOnboarding(),
  };
  return {
    payload,
    human: `Project ${inspection.project.root}\nFramework: ${inspection.framework}\nPackage manager: ${inspection.packageManager}\nStint dependency: ${inspection.existingStintDependency ? "present" : "not found"}\nRun stint guide for capability-aware agent onboarding.`,
  };
}
