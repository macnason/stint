import {
  isMonthString,
  type MonthString,
  type StintConfig,
} from "@macworks/stint/schema";

import { assertValidConfig, canonicalJson, currentUtcMonth } from "../config.js";
import { CliError } from "../diagnostics.js";
import { requireOption, type ParsedOptions } from "../options.js";
import { resolveProject } from "../project.js";
import {
  applyTransaction,
  isConflictPolicy,
  planTransaction,
  type ConflictPolicy,
  type TransactionPlan,
} from "../transaction.js";
import { renderExperienceModule } from "../templates/experience.js";

export const MUTATION_COMMON_VALUES = [
  "project",
  "config",
  "data",
  "conflict",
] as const;

export function mutationOptions(options: ParsedOptions, isTTY: boolean) {
  const project = resolveProject(requireOption(options, "project"));
  const configPath = requireOption(options, "config");
  const dataPath = requireOption(options, "data");
  const rawConflict = options.values.conflict;
  if (!isTTY && !rawConflict) {
    throw new CliError(
      "E_REQUIRED_OPTION",
      "Non-interactive mutations require --conflict abort, skip, or overwrite.",
      { exitCode: 2 },
    );
  }
  const conflict = rawConflict ?? "abort";
  if (!isConflictPolicy(conflict)) {
    throw new CliError("E_OPTION", "Conflict policy must be abort, skip, or overwrite.", {
      exitCode: 2,
    });
  }
  return { project, configPath, dataPath, conflict };
}

interface PlanConfigWritesOptions {
  projectRoot: string;
  configPath: string;
  dataPath: string;
  conflict: ConflictPolicy;
  config: StintConfig;
  expectedConfigContent?: string | Uint8Array;
  expectedDataContent?: string | Uint8Array;
  referenceMonth?: MonthString;
}

export function planConfigWrites({
  projectRoot,
  configPath,
  dataPath,
  conflict,
  config,
  expectedConfigContent,
  expectedDataContent,
  referenceMonth = currentUtcMonth(),
}: PlanConfigWritesOptions): TransactionPlan {
  assertValidConfig(config, referenceMonth);
  return planTransaction({
    projectRoot,
    conflict,
    writes: [
      {
        path: configPath,
        content: canonicalJson(config),
        ...(expectedConfigContent === undefined
          ? {}
          : { expectedOriginalContent: expectedConfigContent }),
      },
      {
        path: dataPath,
        content: renderExperienceModule(config),
        ...(expectedDataContent === undefined
          ? {}
          : { expectedOriginalContent: expectedDataContent }),
      },
    ],
  });
}

export function executePlan(plan: TransactionPlan, dryRun: boolean): void {
  if (!dryRun) applyTransaction(plan);
}

export function publicPlan(plan: TransactionPlan, dryRun: boolean) {
  return {
    ok: true,
    dryRun,
    project: plan.projectRoot,
    actions: plan.actions.map(({ path, action, bytes }) => ({ path, action, bytes })),
  };
}

export function monthOption(value: string, name: string): MonthString {
  if (!isMonthString(value)) {
    throw new CliError("E_OPTION", `Option --${name} must use YYYY-MM.`, {
      exitCode: 2,
    });
  }
  return value;
}
