import { resolve } from "node:path";

import { CliError } from "../diagnostics.js";
import { inspectProject } from "../project.js";
import { readAnswers, type SetupAnswers } from "../setup/answers.js";
import { parseOptions, rejectUnknownOptions, type ParsedOptions } from "../options.js";
import { importCommand } from "./import.js";
import type { CliIo, CommandResult } from "./types.js";

const SETUP_VALUES = [
  "answers",
  "config",
  "conflict",
  "data",
  "format",
  "project",
  "reference-month",
  "source",
  "url",
] as const;

const SOURCE_CHOICES = [
  "Import a file",
  "Paste or enter history",
  "LinkedIn browser (experimental)",
] as const;

export async function setupCommand(
  options: ParsedOptions,
  io: CliIo,
): Promise<CommandResult> {
  rejectUnknownOptions(options, SETUP_VALUES, ["apply", "dry-run", "experimental-browser", "json"]);
  if (options.positionals.length > 1) {
    throw new CliError("E_COMMAND", "setup accepts at most one source path.", { exitCode: 2 });
  }
  const answers = options.values.answers ? readAnswers(options.values.answers) : undefined;
  const projectPath = answers?.project?.path ?? options.values.project ?? ".";
  const inspection = inspectProject(projectPath);
  const source = resolveSource(options, answers);

  if (!source) {
    if (io.isTTY && io.prompt) {
      const choice = (await io.prompt(
        "How would you like to add your history? 1) Import a file 2) Paste or enter history 3) LinkedIn browser (experimental) [1]: ",
      )).trim() || "1";
      if (choice === "1" && io.prompt) {
        const path = (await io.prompt("Path to the export or résumé: ")).trim();
        if (path) return runFileImport(options, io, inspection, path, answers);
      }
      if (choice === "3") {
        return browserState("needs_linkedin_consent", inspection, "The LinkedIn browser importer is experimental and requires explicit consent.");
      }
    }
    return {
      payload: {
        ok: true,
        state: "needs_source_choice",
        sources: SOURCE_CHOICES,
        project: publicInspection(inspection),
      },
      human: "Choose one: Import a file, Paste or enter history, or LinkedIn browser (experimental).",
    };
  }

  if (source.kind === "linkedin-browser") {
    const url = source.url ?? options.values.url;
    validateLinkedInUrl(url);
    const consent = answers?.consent?.linkedinBrowser || options.flags.has("experimental-browser");
    if (!consent) {
      return browserState("needs_linkedin_consent", inspection, "We don't send your profile or project data to Stint servers; setup runs on your device. The visible browser connects directly to LinkedIn, and you sign in there.");
    }
    return browserState("failed_recoverably", inspection, "The experimental browser importer is unavailable in this build. Export your LinkedIn profile as a PDF or use CSV/ZIP, paste, or manual entry.", "browser_unavailable");
  }

  if (source.kind !== "file" || !source.path) {
    return {
      payload: {
        ok: true,
        state: "needs_review",
        remediation: "Provide a local file, canonical JSON, pasted history, or choose manual entry.",
        project: publicInspection(inspection),
      },
      human: "This source needs a local draft or manual review before it can be applied.",
    };
  }
  return runFileImport(options, io, inspection, source.path, answers);
}

async function runFileImport(
  options: ParsedOptions,
  _io: CliIo,
  inspection: ReturnType<typeof inspectProject>,
  sourcePath: string,
  answers?: SetupAnswers,
): Promise<CommandResult> {
  const apply = answers?.apply === true || options.flags.has("apply");
  const importOptions: ParsedOptions = {
    positionals: [resolve(inspection.project.root, sourcePath)],
    values: {
      ...options.values,
      ...(answers?.project?.path ? { project: answers.project.path } : {}),
      ...(answers?.conflict ? { conflict: answers.conflict } : {}),
      ...(answers?.source?.path ? { source: answers.source.path } : {}),
    },
    flags: new Set([
      ...[...options.flags].filter((flag) => flag !== "apply" && flag !== "experimental-browser" && !(apply && flag === "dry-run")),
      ...(apply ? [] : ["dry-run"]),
    ]),
  };
  delete (importOptions.values as Record<string, string>).answers;
  delete (importOptions.values as Record<string, string>).source;
  delete (importOptions.values as Record<string, string>).url;
  delete (importOptions.values as Record<string, string>).reference;
  const result = await importCommand(importOptions, false);
  return {
    payload: {
      ...result.payload,
      state: apply ? "complete" : "ready_to_apply",
      projectInspection: publicInspection(inspection),
      privacy: "File parsing stays on this device and does not call Stint servers.",
    },
    human: apply
      ? result.human
      : `${result.human} Review the plan, then rerun with --apply or answers.apply=true.`,
  };
}

function resolveSource(options: ParsedOptions, answers?: SetupAnswers): { kind: string; path?: string; url?: string } | undefined {
  if (answers?.source) return answers.source;
  const positional = options.positionals[0];
  const explicit = options.values.source;
  if (positional === "linkedin" || explicit === "linkedin") {
    return { kind: "linkedin-browser", url: options.values.url };
  }
  if (positional) return { kind: "file", path: positional };
  if (explicit) return { kind: "file", path: explicit };
  if (options.values.url) return { kind: "linkedin-browser", url: options.values.url };
  return undefined;
}

function publicInspection(inspection: ReturnType<typeof inspectProject>) {
  return {
    root: inspection.project.root,
    framework: inspection.framework,
    packageManager: inspection.packageManager,
    existingStintDependency: inspection.existingStintDependency,
    likelyConfigPath: inspection.likelyConfigPath,
    likelyDataPath: inspection.likelyDataPath,
    existingFiles: inspection.existingFiles,
    ambiguities: inspection.ambiguities,
  };
}

function browserState(
  state: string,
  inspection: ReturnType<typeof inspectProject>,
  message: string,
  remediation?: string,
): CommandResult {
  return {
    payload: {
      ok: true,
      state,
      ...(remediation ? { remediation } : {}),
      project: publicInspection(inspection),
      privacy: message,
    },
    human: message,
  };
}

function validateLinkedInUrl(url: string | undefined): void {
  if (!url) {
    throw new CliError("E_URL", "LinkedIn browser setup requires --url https://www.linkedin.com/in/... .", { exitCode: 2 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError("E_URL", "LinkedIn profile URL must be a valid HTTPS URL.", { exitCode: 2 });
  }
  if (parsed.protocol !== "https:" || !/^(www\.)?linkedin\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith("/in/")) {
    throw new CliError("E_URL", "LinkedIn profile URL must use https://www.linkedin.com/in/... .", { exitCode: 2 });
  }
}

export function setupOptionValues(): readonly string[] {
  return SETUP_VALUES;
}

export function setupOptionsFromAnswers(answers: SetupAnswers): ParsedOptions {
  return parseOptions([
    ...(answers.source?.path ? [answers.source.path] : []),
    ...(answers.project?.path ? ["--project", answers.project.path] : []),
  ]);
}
