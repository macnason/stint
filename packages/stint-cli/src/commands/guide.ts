import { guideBundle } from "../agent-guide.js";
import { CliError } from "../diagnostics.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import { browserCaptureContract } from "../setup/onboarding.js";
import type { CommandResult } from "./types.js";

export function guideCommand(options: ParsedOptions): CommandResult {
  rejectUnknownOptions(options, [], ["json"]);
  if (options.positionals.length)
    throw new CliError(
      "E_COMMAND",
      "guide does not accept positional arguments.",
      { exitCode: 2 }
    );
  const guide = guideBundle();
  return {
    payload: { ok: true, ...guide, browserCapture: browserCaptureContract },
    human: guide.markdown,
  };
}
