import { readFileSync } from "node:fs";
import type { StintConfig, StintExperience, StintRole } from "@macworks/stint/schema";

import {
  assertValidConfig,
  currentUtcMonth,
  readCanonicalConfigDocument,
} from "../config.js";
import { CliError } from "../diagnostics.js";
import {
  rejectUnknownOptions,
  requireOption,
  type ParsedOptions,
} from "../options.js";
import { renderExperienceModule } from "../templates/experience.js";
import { readFileNoFollow } from "../project.js";
import {
  executePlan,
  monthOption,
  mutationOptions,
  MUTATION_COMMON_VALUES,
  planConfigWrites,
  publicPlan,
} from "./shared.js";
import type { CliIo, CommandResult } from "./types.js";

const EMPLOYER_VALUES = [
  ...MUTATION_COMMON_VALUES,
  "id",
  "company",
  "location",
  "start",
  "end",
  "priority",
  "presentation-id",
  "role-id",
  "role-title",
  "role-start",
  "from",
] as const;
const ROLE_VALUES = [
  ...MUTATION_COMMON_VALUES,
  "employer-id",
  "id",
  "title",
  "start",
  "from",
] as const;

export async function addCommand(options: ParsedOptions, isTTY: boolean, io?: CliIo): Promise<CommandResult> {
  const kind = options.positionals[0];
  if ((kind !== "employer" && kind !== "role") || options.positionals.length !== 1) {
    throw new CliError("E_COMMAND", "Use add employer or add role.", { exitCode: 2 });
  }
  rejectUnknownOptions(
    options,
    kind === "employer" ? EMPLOYER_VALUES : ROLE_VALUES,
    ["dry-run", "json"],
  );
  if (options.values.from) {
    options = optionsFromCanonical(options, kind);
  }
  if (!options.values.from && isTTY && io?.prompt) {
    options = await promptOptions(options, kind, io);
  }
  const common = mutationOptions(options, isTTY);
  const document = readCanonicalConfigDocument(
    common.project.root,
    common.configPath,
  );
  const { config } = document;
  assertValidConfig(config, currentUtcMonth());
  const updated =
    kind === "employer" ? addEmployer(config, options) : addRole(config, options);
  const dryRun = options.flags.has("dry-run");
  const plan = planConfigWrites({
    projectRoot: common.project.root,
    configPath: common.configPath,
    dataPath: common.dataPath,
    conflict: common.conflict,
    config: updated,
    expectedConfigContent: document.source,
    expectedDataContent: renderExperienceModule(config),
  });
  executePlan(plan, dryRun);
  return {
    payload: publicPlan(plan, dryRun),
    human: `${dryRun ? "Planned" : "Applied"} ${plan.actions.length} Stint file actions.`,
  };
}

function optionsFromCanonical(
  options: ParsedOptions,
  kind: "employer" | "role",
): ParsedOptions {
  const sourcePath = options.values.from!;
  let source: string;
  try {
    source = (sourcePath === "-" ? readFileSync(0) : readFileNoFollow(sourcePath)).toString("utf8");
  } catch (error) {
    throw new CliError("E_NOT_FOUND", "The canonical add input could not be read.", { cause: error, path: sourcePath });
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new CliError("E_OPTION", "--from input must be valid JSON.", { cause: error, path: sourcePath });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("E_OPTION", "--from input must be one JSON object.");
  }
  const record = value as Record<string, unknown>;
  const values: Record<string, string> = { ...options.values };
  const set = (key: string, field: unknown) => {
    if (typeof field === "string" && field.length > 0) values[key] = field;
  };
  if (kind === "employer") {
    set("id", record.id);
    set("company", record.company);
    set("location", record.location);
    set("start", record.start);
    set("end", record.end === null ? "null" : record.end);
    set("priority", typeof record.priority === "number" ? String(record.priority) : record.priority);
    set("presentation-id", record.presentationId);
    const role = record.role && typeof record.role === "object" ? record.role as Record<string, unknown> : {};
    set("role-id", role.id);
    set("role-title", role.title);
    set("role-start", role.start);
  } else {
    set("employer-id", record.employerId ?? record.employer_id);
    set("id", record.id);
    set("title", record.title);
    set("start", record.start);
  }
  return { ...options, values };
}

async function promptOptions(
  options: ParsedOptions,
  kind: "employer" | "role",
  io: CliIo,
): Promise<ParsedOptions> {
  const values: Record<string, string> = { ...options.values };
  const ask = async (name: string, label: string): Promise<void> => {
    if (values[name] === undefined) values[name] = (await io.prompt!(label)).trim();
  };
  if (kind === "employer") {
    await ask("id", "Employer ID: ");
    await ask("company", "Company: ");
    await ask("location", "Location (optional): ");
    await ask("start", "Employer start (YYYY-MM): ");
    await ask("end", "Employer end (YYYY-MM, current, or null): ");
    await ask("role-id", "Initial role ID: ");
    await ask("role-title", "Initial role title: ");
    await ask("role-start", "Initial role start (YYYY-MM): ");
  } else {
    await ask("employer-id", "Employer ID: ");
    await ask("id", "Role ID: ");
    await ask("title", "Role title: ");
    await ask("start", "Role start (YYYY-MM): ");
  }
  return { ...options, values };
}

function addEmployer(config: StintConfig, options: ParsedOptions): StintConfig {
  const id = requireOption(options, "id");
  const roleId = requireOption(options, "role-id");
  assertUnusedEntryId(config, id);
  assertUnusedRoleId(config, roleId);
  const start = monthOption(requireOption(options, "start"), "start");
  const rawEnd = requireOption(options, "end");
  const end = rawEnd === "current" || rawEnd === "null" ? null : monthOption(rawEnd, "end");
  const roleStart = monthOption(requireOption(options, "role-start"), "role-start");
  const rawPriority = options.values.priority;
  const priority = rawPriority === undefined ? undefined : Number(rawPriority);
  if (priority !== undefined && !Number.isFinite(priority)) {
    throw new CliError("E_OPTION", "Option --priority must be a finite number.", {
      exitCode: 2,
    });
  }
  const entry: StintExperience = {
    id,
    company: requireOption(options, "company"),
    start,
    end,
    roles: [
      {
        id: roleId,
        title: requireOption(options, "role-title"),
        start: roleStart,
      },
    ],
    ...(options.values.location ? { location: options.values.location } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(options.values["presentation-id"]
      ? { presentationId: options.values["presentation-id"] }
      : {}),
  };
  return { ...config, entries: [...config.entries, entry] };
}

function addRole(config: StintConfig, options: ParsedOptions): StintConfig {
  const employerId = requireOption(options, "employer-id");
  const id = requireOption(options, "id");
  assertUnusedRoleId(config, id);
  let found = false;
  const role: StintRole = {
    id,
    title: requireOption(options, "title"),
    start: monthOption(requireOption(options, "start"), "start"),
  };
  const entries = config.entries.map((entry) => {
    if (entry.id !== employerId) return entry;
    found = true;
    return { ...entry, roles: [...entry.roles, role] };
  });
  if (!found) {
    throw new CliError("E_NOT_FOUND", "No employer has the supplied stable ID.");
  }
  return { ...config, entries };
}

function assertUnusedEntryId(config: StintConfig, id: string): void {
  if (config.entries.some((entry) => entry.id === id)) {
    throw new CliError("E_DUPLICATE_ID", "The supplied employer ID is already in use.");
  }
}

function assertUnusedRoleId(config: StintConfig, id: string): void {
  if (config.entries.some((entry) => entry.roles.some((role) => role.id === id))) {
    throw new CliError("E_DUPLICATE_ID", "The supplied role ID is already in use.");
  }
}
