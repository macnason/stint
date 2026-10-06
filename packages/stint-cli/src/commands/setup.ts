import { browserCaptureContract, discoverLocalCapabilities, recommendOnboarding } from "../setup/onboarding.js";
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
  "port",
] as const;

const LINKEDIN_PRIVACY_MESSAGE = "We don't send your profile or project data to Stint servers; setup runs on your device. The visible browser connects directly to LinkedIn, and you sign in there yourself. Stint never enters passwords, MFA, or CAPTCHA.";

export async function setupCommand(
  options: ParsedOptions,
  io: CliIo,
): Promise<CommandResult> {
  rejectUnknownOptions(options, SETUP_VALUES, ["apply", "dry-run", "experimental-browser", "json", "wizard"]);
  if (options.flags.has("wizard")) {
    if (options.positionals.length || Object.keys(options.values).some(key => !["project", "port"].includes(key)) || [...options.flags].some(flag => !["wizard", "json"].includes(flag))) {
      throw new CliError("E_OPTION", "The upload wizard accepts only --project, --port and --json. Choose and review your file in the browser.");
    }
    const port = Number(options.values.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError("E_OPTION", "Choose a valid port.");
    const { startWizard } = await import("../wizard/server.js");
    const wizard = await startWizard(options.values.project ?? ".", port);
    const stop = () => { void wizard.close(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return { payload: { ok: true, state: "waiting_for_upload", url: wizard.url, port: wizard.port, expiresInMinutes: 60 }, human: `Open this link to choose your file and review your history:\n${wizard.url}\nKeep this process running while you finish setup.` };
  }
  if (options.values.port) throw new CliError("E_OPTION", "--port is only used with --wizard.");
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
        const path = (await io.prompt("Path to the LinkedIn PDF, screenshot, or export: ")).trim();
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
        return browserState("needs_linkedin_consent", inspection, LINKEDIN_PRIVACY_MESSAGE);
      }
    }
    return {
      payload: {
        ok: true,
        state: "needs_source_choice",
        sources: setupSourceChoices,
        capabilities: discoverLocalCapabilities(),
        onboarding: recommendOnboarding(answers?.capabilities?.browser, answers?.consent?.agentProviderBoundary),
        project: publicProjectInspection(inspection),
      },
      human: "Choose one: Import a file, Paste or enter history, or LinkedIn browser (experimental).",
    };
  }

  if (source.kind === "linkedin-browser") {
    const url = source.url ?? options.values.url;
    const profileUrl = validateLinkedInProfileUrl(url ?? "").href;
    const recommendation = recommendOnboarding(answers?.capabilities?.browser, answers?.consent?.agentProviderBoundary);
    const directUrl = /^https?:/i.test(options.positionals[0] ?? "");
    if (!options.flags.has("experimental-browser") && (directUrl || answers?.capabilities?.browser || answers?.consent?.agentProviderBoundary === false)) {
      const state = recommendation.route === "agent-browser"
        ? (recommendation.action === "human-sign-in" ? "waiting_for_browser_sign_in" : "needs_browser_capture")
        : recommendation.route === "local-file" ? "needs_source_choice" : "needs_browser_capabilities";
      return {
        payload: { ok: true, state, applied: false, profileUrl, onboarding: recommendation,
          capabilities: discoverLocalCapabilities(), project: publicProjectInspection(inspection),
          browserCapture: browserCaptureContract,
          privacy: "Stint has not opened a browser or fetched this profile. Agent browser tools follow their own provider boundary; use local PDF/OCR when local-only processing is preferred." },
        human: `${recommendation.reason}\n${recommendation.next}\nRun stint guide for the browser handoff and review steps.`,
      };
    }
    const consent = answers?.consent?.linkedinBrowser === true || options.flags.has("experimental-browser");
    if (!consent) {
      return browserState("needs_linkedin_consent", inspection, LINKEDIN_PRIVACY_MESSAGE);
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
  const apply = !options.flags.has("dry-run") && (answers?.apply === true || options.flags.has("apply"));
  const supportedIntegration = inspection.framework === "next" || inspection.framework === "vite";
  if (!supportedIntegration || !inspection.likelyDataPath) {
    return {
      payload: {
        ok: true,
        state: "complete_with_handoff",
        applied: false,
        projectInspection: publicProjectInspection(inspection),
        privacy: "File parsing stays on this device and does not call Stint servers.",
        handoff: "Choose and review the integration and data-module paths for this project, then use `stint import` with explicit --config and --data paths.",
      },
      human: "The project needs a manual integration handoff. No paths were guessed and no files were written.",
    };
  }
  const importOptions: ParsedOptions = {
    positionals: [resolve(inspection.project.root, sourcePath)],
    values: {
      ...options.values,
      config: options.values.config ?? inspection.likelyConfigPath,
      data: options.values.data ?? inspection.likelyDataPath,
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
  const autoIntegration = answers?.integration?.mode !== "handoff";
  const installPlan = autoIntegration && supportedIntegration && !inspection.existingStintDependency && inspection.packageManager !== "unknown"
    ? planPackageInstall(inspection.packageManager, "@macworks/stint", "1.0.0-next.3")
    : undefined;
  let installReceiptPayload = installPlan ? installReceipt(installPlan, "planned") : undefined;
  let result: CommandResult;
  if (apply && installPlan) {
    const previewOptions: ParsedOptions = { ...normalizedImportOptions, flags: new Set([...normalizedImportOptions.flags, "dry-run"]) };
    result = await importCommand(previewOptions, false);
    if ((result.payload.warnings as Array<{ code: string }> | undefined)?.some(warning => warning.code === "document-unresolved")) {
      throw new CliError("E_IMPORT_SCHEMA", "Some document entries need review. Extract and correct a draft before applying; no package was installed.");
    }
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
    ? "complete"
    : ((result.payload.warnings as Array<{ code: string }> | undefined)?.some(warning => warning.code === "document-unresolved") ? "needs_review" : "ready_to_apply");
  return {
    payload: {
      ...result.payload,
      state,
      projectInspection: publicProjectInspection(inspection),
      privacy: "File parsing stays on this device and does not call Stint servers.",
      ...(installPlan && installReceiptPayload ? { installPlan, installReceipt: installReceiptPayload } : {}),
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
  if (positional && /^https?:/i.test(positional)) return { kind: "linkedin-browser", url: positional };
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
