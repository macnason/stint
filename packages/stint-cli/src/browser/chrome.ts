import { accessSync, constants } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

import { CliError } from "../diagnostics.js";

const MACOS_BROWSER_EXECUTABLES = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "Chromium.app/Contents/MacOS/Chromium",
  "Brave Browser.app/Contents/MacOS/Brave Browser",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const LINUX_BROWSERS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge",
];

export function systemChromeCandidates(
  platformName = platform(),
  homeDirectory = homedir(),
): readonly string[] {
  if (platformName !== "darwin") return LINUX_BROWSERS;
  return ["/Applications", join(homeDirectory, "Applications")].flatMap((directory) =>
    MACOS_BROWSER_EXECUTABLES.map((executable) => join(directory, executable)),
  );
}

export function findSystemChrome(): string {
  const candidates = systemChromeCandidates();
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      if (!directory) continue;
      const path = join(directory, candidate);
      try {
        accessSync(path, constants.X_OK);
        return path;
      } catch {
        continue;
      }
    }
  }
  throw new CliError("E_BROWSER", "No supported system Chrome or Chromium installation was found.");
}

export interface VisibleBrowserLaunch {
  readonly executablePath: string;
  readonly headless: false;
  readonly userDataDirectory: string;
}

export function visibleBrowserLaunch(userDataDirectory: string): VisibleBrowserLaunch {
  if (!userDataDirectory || userDataDirectory === process.env.HOME) {
    throw new CliError("E_SECURITY", "Browser setup requires a dedicated temporary profile directory.");
  }
  return { executablePath: findSystemChrome(), headless: false, userDataDirectory };
}
