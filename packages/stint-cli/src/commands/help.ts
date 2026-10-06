import { CliError } from "../diagnostics.js";
import { linkedinPrivacyNotice } from "../agent-guide.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import type { CommandResult } from "./types.js";

interface CommandDescription {
  readonly key: string;
  readonly usage: string;
  readonly description: string;
  readonly options: readonly string[];
  readonly notes?: readonly string[];
}

const COMMANDS: readonly CommandDescription[] = [
  {
    key: "guide",
    usage: "stint guide [--json]",
    description: "Read the canonical agent onboarding guide and browser handoff contract.",
    options: ["--json                    Emit the guide, prompt, and capture contract"],
  },
  {
    key: "extract",
    usage: "stint extract INPUT [--output draft.json] [--json]",
    description: "Read a local LinkedIn PDF or PNG/JPEG screenshot into a reviewable draft, without a project.",
    options: ["--output FILE             Save a new editable canonical JSON draft", "--json                    Emit the draft and review warnings"],
    notes: ["PDF text extraction and English OCR are bundled and run offline. Existing output files are never replaced."],
  },
  {
    key: "setup",
    usage: "stint setup [SOURCE] [--answers FILE|-] [--apply] [--json]",
    description: "Discover the project, choose a source, preview, and apply a Stint setup.",
    options: [
      "SOURCE                    Local file, LinkedIn HTTPS URL, or linkedin for the experimental browser",
      "--answers FILE|-          Versioned non-interactive choices",
      "--apply                   Apply after the draft is reviewed",
      "--experimental-browser   Explicitly opt into the visible LinkedIn browser",
      "--json                    Emit machine-readable state output",
    ],
  },
  {
    key: "init",
    usage:
      "stint init --project DIR --config FILE --data FILE --conflict POLICY [--dry-run] [--json]",
    description: "Create canonical JSON and a typed TypeScript data module.",
    options: [
      "--project DIR             Project root",
      "--config FILE            Canonical JSON path inside the project",
      "--data FILE              Generated TypeScript path inside the project",
      "--conflict POLICY        abort, skip, or overwrite",
      "--dry-run                Plan without writing",
      "--json                   Emit machine-readable output",
    ],
  },
  {
    key: "add",
    usage: "stint add employer ... | stint add role ...",
    description: "Add an employer or role by stable ID.",
    options: [
      "Run stint add employer --help or stint add role --help for details.",
    ],
  },
  {
    key: "add employer",
    usage:
      "stint add employer --project DIR --config FILE --data FILE --conflict POLICY --id ID --company NAME [--location LOCATION] --start YYYY-MM --end YYYY-MM|current|null [--priority NUMBER] [--presentation-id ID] --role-id ID --role-title TITLE --role-start YYYY-MM [--dry-run] [--json]",
    description: "Add an employer and its first role by stable IDs.",
    options: [
      "--id ID                  Stable employer ID",
      "--company NAME           Employer name",
      "--location LOCATION      Optional location",
      "--start YYYY-MM          Inclusive employer start month",
      "--end YYYY-MM|current|null  Exclusive end month; current/null means ongoing",
      "--priority NUMBER        Optional finite overlap priority",
      "--presentation-id ID     Optional presentation asset reference",
      "--role-id ID             Stable initial role ID",
      "--role-title TITLE       Initial role title",
      "--role-start YYYY-MM     Inclusive initial role start month",
      "--project/--config/--data/--conflict  Required mutation paths and policy",
      "--dry-run                Plan without writing",
      "--json                   Emit machine-readable output",
    ],
    notes: [
      "Employer end months are exclusive: --end 2025-07 includes 2025-06, not 2025-07.",
    ],
  },
  {
    key: "add role",
    usage:
      "stint add role --project DIR --config FILE --data FILE --conflict POLICY --employer-id ID --id ID --title TITLE --start YYYY-MM [--dry-run] [--json]",
    description: "Add a role to an employer selected by stable ID.",
    options: [
      "--employer-id ID         Existing stable employer ID",
      "--id ID                  Stable role ID",
      "--title TITLE            Role title",
      "--start YYYY-MM          Inclusive role start month",
      "--project/--config/--data/--conflict  Required mutation paths and policy",
      "--dry-run                Plan without writing",
      "--json                   Emit machine-readable output",
    ],
    notes: [
      "A role ends at the next role start or at its employer's exclusive end month.",
    ],
  },
  {
    key: "validate",
    usage:
      "stint validate --project DIR --config FILE [--reference-month YYYY-MM] [--json]",
    description:
      "Validate canonical JSON without loading generated TypeScript.",
    options: [
      "--project DIR             Project root",
      "--config FILE            Canonical JSON path inside the project",
      "--reference-month YYYY-MM Month used to resolve current entries",
      "--json                   Emit every redacted error and warning",
    ],
  },
  {
    key: "doctor",
    usage: "stint doctor [--project DIR] [--json]",
    description: "Inspect the detected project, package manager, framework, and Stint targets.",
    options: [
      "--project DIR             Optional project root override",
      "--json                   Emit machine-readable output",
    ],
  },
  {
    key: "import",
    usage:
      "stint import INPUT --format auto|json|yaml|linkedin-csv|linkedin-zip|pdf|image --project DIR --config FILE --data FILE --conflict POLICY [--reference-month YYYY-MM] [--dry-run] [--json]",
    description:
      "Import a local file into canonical JSON and typed TypeScript.",
    options: [
      "INPUT                    Local PDF, PNG/JPEG, JSON, YAML, or LinkedIn CSV/ZIP",
      "--format FORMAT          auto, json, yaml, linkedin-csv, linkedin-zip, pdf, image",
      "--project/--config/--data/--conflict  Required mutation paths and policy",
      "--reference-month YYYY-MM Month used to resolve current entries",
      "--dry-run                Plan without writing",
      "--json                   Emit machine-readable redacted output",
    ],
  },
  {
    key: "help",
    usage: "stint help [--json]",
    description: "Show command usage.",
    options: ["--json                   Emit machine-readable output"],
  },
];

export function helpCommand(
  options: ParsedOptions,
  topic: readonly string[] = []
): CommandResult {
  rejectUnknownOptions(options, [], ["advanced", "help", "json"]);

  if (topic.length > 0) {
    const key = topic.join(" ");
    const command = COMMANDS.find((candidate) => candidate.key === key);
    if (!command) {
      throw new CliError(
        "E_COMMAND",
        "Unknown command. Run stint help for usage.",
        {
          exitCode: 2,
        }
      );
    }
    return {
      payload: {
        ok: true,
        command: command.key,
        usage: command.usage,
        description: command.description,
        options: command.options,
        ...(command.notes ? { notes: command.notes } : {}),
      },
      human: renderCommand(command),
    };
  }

  if (options.positionals.length > 0) {
    throw new CliError(
      "E_COMMAND",
      "help does not accept positional arguments.",
      {
        exitCode: 2,
      }
    );
  }

  return {
    payload: {
      ok: true,
      commands: COMMANDS.filter((command) => options.flags.has("advanced") || command.key !== "init").map(
        (command) => command.key
      ),
      usage: COMMANDS.filter((command) => options.flags.has("advanced") || command.key !== "init").map((command) => command.usage),
      excluded: ["preview", "presentation scaffold"],
    },
    human: renderOverview(),
  };
}

function renderOverview(): string {
  const usage = COMMANDS.filter((command) => command.key !== "init" && command.key !== "add")
    .map((command) => `  ${command.usage}`)
    .join("\n");
  return `stint - author canonical Stint experience data

Commands:
${usage}

Quick setup infers project, config, data, format, current month, and abort-on-conflict defaults.
Agents: run stint guide --json to recommend a source using your available browser tools.
Use stint help --advanced for legacy path, format, conflict, date, and field flags.
Employer starts are inclusive; non-current employer ends are exclusive.
The JSON configuration is canonical; TypeScript is generated as a typed literal.

File imports stay local-only and generate canonical JSON plus typed TypeScript atomically.
${linkedinPrivacyNotice}
`;
}

function renderCommand(command: CommandDescription): string {
  const options = command.options.map((option) => `  ${option}`).join("\n");
  const notes = command.notes?.map((note) => `  ${note}`).join("\n");
  return `Usage:
  ${command.usage}

${command.description}

Options:
${options}${notes ? `\n\nNotes:\n${notes}` : ""}
`;
}
