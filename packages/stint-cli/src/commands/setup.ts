import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CliError } from "../diagnostics.js";
import { validateLinkedInProfileUrl } from "../browser/security.js";
import { captureLinkedInBrowser } from "../browser/session.js";
import { inspectProject, publicProjectInspection } from "../project.js";
import { readAnswers, type SetupAnswers } from "../setup/answers.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import { setupSourceChoices } from "../agent-guide.js";
import { cleanupSetupSession, createSetupSession } from "../setup/session.js";
import { executePackageInstall, installReceipt, planPackageInstall } from "../setup/package-manager.js";
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

export async function setupCommand(
  options: ParsedOptions,
  io: CliIo,
): Promise<CommandResult> {
  rejectUnknownOptions(options, SETUP_VALUES, ["apply", "dry-run", "experimental-browser", "json"]);
  if (options.positionals.length > 1) {
    throw new CliError("E_COMMAND", "setup accepts at most one source path.", { exitCode: 2 });
  }
  const answers = options.values.answers ? readAnswers(options.values.answers) : undefined;
  if (answers?.session?.action === "reset" || answers?.session?.action === "resume") {
    return {
      payload: {
        ok: true,
        state: "failed_recoverably",
        remediation: answers.session.action === "reset"
          ? "There is no persisted setup session to reset; rerun setup with session.action=\"new\"."
          : "No resumable setup session is available; rerun setup with session.action=\"new\".",
      },
      human: "No persisted setup session is available. Rerun setup with a new session.",
    };
  }
  if (answers?.review?.mode === "reject") {
    return {
      payload: { ok: true, state: "needs_review", remediation: "The proposed setup was rejected; no files were written." },
      human: "The proposed setup was rejected. No files were written.",
    };
  }
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
        if (path) return runFileImport(options, inspection, path, answers);
      }
      if (choice === "2") {
        const path = (await io.prompt("Path to a canonical JSON draft (or press Enter for agent/manual guidance): ")).trim();
        if (path) return runFileImport(options, inspection, path, answers);
        return {
          payload: {
            ok: true,
            state: "needs_review",
            remediation: "Create a local canonical JSON draft, then rerun `stint setup <draft.json>`; screenshots and résumé text should be normalized by the agent with provider-boundary consent first.",
            project: publicProjectInspection(inspection),
          },
          human: "Create a local canonical JSON draft, then rerun setup with that file. No data was written.",
        };
      }
      if (choice === "3") {
        return browserState("needs_linkedin_consent", inspection, "The LinkedIn browser importer is experimental and requires explicit consent.");
      }
    }
    return {
      payload: {
        ok: true,
        state: "needs_source_choice",
        sources: setupSourceChoices,
        project: publicProjectInspection(inspection),
      },
      human: "Choose one: Import a file, Paste or enter history, or LinkedIn browser (experimental).",
    };
  }

  if (source.kind === "linkedin-browser") {
    const url = source.url ?? options.values.url;
    validateLinkedInProfileUrl(url ?? "");
    const consent = answers?.consent?.linkedinBrowser === true || options.flags.has("experimental-browser");
    if (!consent) {
      return browserState("needs_linkedin_consent", inspection, "We don't send your profile or project data to Stint servers; setup runs on your device. The visible browser connects directly to LinkedIn, and you sign in there.");
    }
    if (!io.isTTY || !io.prompt) {
      return browserState("waiting_for_browser_sign_in", inspection, "Run the consented browser step from a terminal so you can sign in visibly; Stint never receives your credentials.", "rerun_in_tty");
    }
    const session = createSetupSession();
    try {
      const imported = await captureLinkedInBrowser(url!, session.directory, io.prompt);
      if (imported.config.entries.length === 0) {
        return browserState("failed_recoverably", inspection, "No experience entries were recognized. Use LinkedIn PDF/CSV/ZIP, a local canonical JSON draft, or manual entry.", "browser_no_entries");
      }
      const draftPath = join(session.directory, "draft.json");
      const draft = `${JSON.stringify(imported.config)}\n`;
      if (Buffer.byteLength(draft, "utf8") > 2 * 1024 * 1024) {
        throw new CliError("E_IMPORT_LIMIT", "The rendered LinkedIn draft exceeds its 2 MiB limit.");
      }
      writeFileSync(draftPath, draft, { mode: 0o600 });
      const result = await runFileImport(options, inspection, draftPath, answers);
      return {
        ...result,
        payload: {
          ...result.payload,
          privacy: "The visible browser connected directly to LinkedIn. Stint did not receive credentials or send profile data to Stint servers.",
          warnings: [...((result.payload as { warnings?: readonly unknown[] }).warnings ?? []), ...imported.warnings],
        },
      };
    } catch (error) {
      if (error instanceof CliError && error.code === "E_BROWSER") {
        return browserState("failed_recoverably", inspection, "The visible LinkedIn browser could not complete. Use LinkedIn PDF/CSV/ZIP, a local canonical JSON draft, or manual entry.", "browser_unavailable");
      }
      throw error;
    } finally {
      cleanupSetupSession(session);
    }
  }

  if (source.kind !== "file" || !source.path) {
    return {
      payload: {
        ok: true,
        state: "needs_review",
        remediation: "Provide a local file, canonical JSON, pasted history, or choose manual entry.",
        project: publicProjectInspection(inspection),
      },
      human: "This source needs a local draft or manual review before it can be applied.",
    };
  }
  return runFileImport(options, inspection, source.path, answers);
}

async function runFileImport(
  options: ParsedOptions,
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
  const importValues = Object.fromEntries(
    Object.entries(importOptions.values).filter(([key]) => !["answers", "source", "url"].includes(key)),
  );
  const normalizedImportOptions: ParsedOptions = { ...importOptions, values: importValues };
  const supportedIntegration = inspection.framework === "next" || inspection.framework === "vite";
  const autoIntegration = answers?.integration?.mode !== "handoff";
  const installPlan = autoIntegration && supportedIntegration && !inspection.existingStintDependency && inspection.packageManager !== "unknown"
    ? planPackageInstall(inspection.packageManager, "@macworks/stint", "1.0.0-next.1")
    : undefined;
  let installReceiptPayload = installPlan ? installReceipt(installPlan, "planned") : undefined;
  let result: CommandResult;
  if (apply && installPlan) {
    const previewOptions: ParsedOptions = { ...normalizedImportOptions, flags: new Set([...normalizedImportOptions.flags, "dry-run"]) };
    result = await importCommand(previewOptions, false);
    installReceiptPayload = executePackageInstall(installPlan, inspection.project.root);
    if (installReceiptPayload.status === "failed") {
      return {
        payload: {
          ...result.payload,
          state: "failed_recoverably",
          installPlan,
          installReceipt: installReceiptPayload,
          remediation: "Inspect the package-manager output and rerun setup after the dependency install is available.",
          projectInspection: publicProjectInspection(inspection),
        },
        human: "The package install did not complete. No Stint files were written; rerun setup after fixing the install.",
      };
    }
    result = await importCommand(normalizedImportOptions, false);
  } else {
    result = await importCommand(normalizedImportOptions, false);
  }
  const state = apply
    ? supportedIntegration
      ? installPlan ? "complete_with_handoff" : "complete"
      : "complete_with_handoff"
    : "ready_to_apply";
  return {
    payload: {
      ...result.payload,
      state,
      projectInspection: publicProjectInspection(inspection),
      privacy: "File parsing stays on this device and does not call Stint servers.",
      ...(installPlan && installReceiptPayload ? { installPlan, installReceipt: installReceiptPayload } : {}),
      ...(supportedIntegration
        ? installPlan
          ? { handoff: `Run the reviewed ${installPlan.command} install plan, then rerun setup to complete the consumer integration.` }
          : {}
        : {
            handoff: "Add the Stint dependency and render the generated data module in the detected application entry point.",
          }),
    },
    human: apply
      ? supportedIntegration
        ? result.human
        : `${result.human} The project needs a manual integration handoff.`
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
      project: publicProjectInspection(inspection),
      privacy: message,
    },
    human: message,
  };
}
