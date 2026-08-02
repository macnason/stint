#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { addCommand } from "./commands/add.js";
import { helpCommand } from "./commands/help.js";
import { importCommand } from "./commands/import.js";
import { initCommand } from "./commands/init.js";
import type { CliIo, CommandResult } from "./commands/types.js";
import { validateCommand } from "./commands/validate.js";
import { asCliError, publicCliError, CliError } from "./diagnostics.js";
import { parseOptions } from "./options.js";

export type { CliIo } from "./commands/types.js";
export const commandName = "stint" as const;

const processIo: CliIo = {
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  writeOut(value) {
    process.stdout.write(value);
  },
  writeError(value) {
    process.stderr.write(value);
  },
};

export async function runCli(
  args: readonly string[],
  io: CliIo = processIo
): Promise<number> {
  const json = args.includes("--json");
  try {
    const rawCommand = args[0];
    const command =
      rawCommand === undefined || rawCommand === "--help" ? "help" : rawCommand;
    const commandArgs =
      rawCommand === "--help" || rawCommand === undefined ? [] : args.slice(1);
    const options = parseOptions(commandArgs);
    const result =
      command !== "help" && options.flags.has("help")
        ? helpCommand(options, [command, ...options.positionals])
        : await dispatch(command, options, io.isTTY);
    writeSuccess(io, result, json || options.flags.has("json"));
    return 0;
  } catch (error) {
    const diagnostic = asCliError(error);
    writeFailure(io, diagnostic, json);
    return diagnostic.exitCode;
  }
}

async function dispatch(
  command: string,
  options: ReturnType<typeof parseOptions>,
  isTTY: boolean
): Promise<CommandResult> {
  switch (command) {
    case "init":
      return initCommand(options, isTTY);
    case "add":
      return addCommand(options, isTTY);
    case "validate":
      return validateCommand(options);
    case "import":
      return importCommand(options, isTTY);
    case "help":
      return helpCommand(options);
    default:
      throw new CliError(
        "E_COMMAND",
        "Unknown command. Run stint help for usage.",
        {
          exitCode: 2,
        }
      );
  }
}

function writeSuccess(io: CliIo, result: CommandResult, json: boolean): void {
  io.writeOut(
    json ? `${JSON.stringify(result.payload)}\n` : `${result.human.trimEnd()}\n`
  );
}

function writeFailure(io: CliIo, error: CliError, json: boolean): void {
  const diagnostic = publicCliError(error);
  io.writeError(
    json
      ? `${JSON.stringify({ ok: false, error: diagnostic })}\n`
      : `${escapeTerminalText(diagnostic.code)}: ${escapeTerminalText(
          diagnostic.message
        )}${
          diagnostic.path ? ` (${escapeTerminalText(diagnostic.path)})` : ""
        }\n`
  );
}

function escapeTerminalText(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const invokedRealPath = resolveInvokedPath(invokedPath);
if (invokedRealPath && fileURLToPath(import.meta.url) === invokedRealPath) {
  void main().catch((error: unknown) => {
    const diagnostic = asCliError(error);
    writeFailure(processIo, diagnostic, process.argv.includes("--json"));
    process.exitCode = diagnostic.exitCode;
  });
}

function resolveInvokedPath(path: string): string {
  if (!path) return "";
  try {
    return realpathSync(path);
  } catch {
    return "";
  }
}
