import { emptyStintConfig } from "../config.js";
import { CliError } from "../diagnostics.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import {
  executePlan,
  mutationOptions,
  MUTATION_COMMON_VALUES,
  planConfigWrites,
  publicPlan,
} from "./shared.js";
import type { CommandResult } from "./types.js";

export function initCommand(options: ParsedOptions, isTTY: boolean): CommandResult {
  rejectUnknownOptions(options, MUTATION_COMMON_VALUES, ["dry-run", "json"]);
  if (options.positionals.length > 0) {
    throw new CliError("E_COMMAND", "init does not accept positional arguments.", {
      exitCode: 2,
    });
  }
  const common = mutationOptions(options, isTTY);
  const dryRun = options.flags.has("dry-run");
  const plan = planConfigWrites({
    projectRoot: common.project.root,
    configPath: common.configPath,
    dataPath: common.dataPath,
    conflict: common.conflict,
    config: emptyStintConfig(),
  });
  executePlan(plan, dryRun);
  return {
    payload: publicPlan(plan, dryRun),
    human: `${dryRun ? "Planned" : "Applied"} ${plan.actions.length} Stint file actions.`,
  };
}
