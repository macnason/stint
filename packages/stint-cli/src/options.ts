import { CliError } from "./diagnostics.js";

export interface ParsedOptions {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
}

const BOOLEAN_OPTIONS = new Set([
  "apply",
  "advanced",
  "dry-run",
  "experimental-browser",
  "help",
  "json",
  "offline",
  "wizard",
]);

export function parseOptions(args: readonly string[]): ParsedOptions {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    const name = argument.slice(2);
    if (!name || name.includes("=")) {
      throw new CliError("E_OPTION", "Options must use --name value syntax.", {
        exitCode: 2,
      });
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      if (flags.has(name)) {
        throw new CliError("E_OPTION", `Option --${name} was supplied twice.`, {
          exitCode: 2,
        });
      }
      flags.add(name);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError("E_REQUIRED_OPTION", `Option --${name} needs a value.`, {
        exitCode: 2,
      });
    }
    if (name in values) {
      throw new CliError("E_OPTION", `Option --${name} was supplied twice.`, {
        exitCode: 2,
      });
    }
    values[name] = value;
    index += 1;
  }

  return { positionals, values, flags };
}

export function requireOption(options: ParsedOptions, name: string): string {
  const value = options.values[name];
  if (value === undefined || value.length === 0) {
    throw new CliError("E_REQUIRED_OPTION", `Required option --${name} is missing.`, {
      exitCode: 2,
    });
  }
  return value;
}

export function rejectUnknownOptions(
  options: ParsedOptions,
  allowedValues: readonly string[],
  allowedFlags: readonly string[] = ["json"],
): void {
  const allowedValueSet = new Set(allowedValues);
  const allowedFlagSet = new Set(allowedFlags);
  const unknown = [
    ...Object.keys(options.values).filter((name) => !allowedValueSet.has(name)),
    ...[...options.flags].filter((name) => !allowedFlagSet.has(name)),
  ];
  if (unknown.length > 0) {
    throw new CliError("E_OPTION", `Unknown option --${unknown[0]}.`, {
      exitCode: 2,
    });
  }
}
