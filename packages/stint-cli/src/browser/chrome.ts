import { accessSync, constants } from "node:fs";
import { platform } from "node:os";

import { CliError } from "../diagnostics.js";

const MACOS_BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const LINUX_BROWSERS = ["google-chrome", "chromium", "chromium-browser"];

export function findSystemChrome(): string {
  const candidates = platform() === "darwin" ? MACOS_BROWSERS : LINUX_BROWSERS;
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
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
