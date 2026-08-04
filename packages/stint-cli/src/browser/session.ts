import type { Browser, Page } from "puppeteer-core";

import { CliError } from "../diagnostics.js";
import { parseLinkedInBrowserItems, type LinkedInBrowserItem } from "../importers/linkedin-browser.js";
import { isAllowedLinkedInNavigation, validateLinkedInProfileUrl } from "./security.js";
import { visibleBrowserLaunch } from "./chrome.js";

export async function captureLinkedInBrowser(
  profileUrl: string,
  userDataDirectory: string,
  prompt: (message: string) => Promise<string>,
) {
  const url = validateLinkedInProfileUrl(profileUrl);
  const { launch } = await import("puppeteer-core");
  const launchOptions = visibleBrowserLaunch(userDataDirectory);
  let browser: Browser | undefined;
  let ownedProcess: ReturnType<Browser["process"]> | undefined;
  try {
    browser = await launch({
      executablePath: launchOptions.executablePath,
      headless: false,
      userDataDir: launchOptions.userDataDirectory,
      defaultViewport: null,
    });
    ownedProcess = browser.process();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30_000);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const requestUrl = request.url();
      const allowed = requestUrl.startsWith("data:") || requestUrl.startsWith("about:") || isAllowedLinkedInNavigation(requestUrl);
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !allowed) {
        void request.abort().catch(() => undefined);
      } else if (allowed) {
        void request.continue().catch(() => undefined);
      } else {
        void request.abort().catch(() => undefined);
      }
    });
    page.on("popup", (popup) => {
      if (popup) void popup.close().catch(() => undefined);
    });
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    if (!isAllowedLinkedInNavigation(page.url())) {
      throw new CliError("E_BROWSER", "LinkedIn redirected the visible browser to an unexpected origin.");
    }
    await prompt("Sign in to LinkedIn in the visible browser, open the Experience section, then press Enter here to capture the rendered entries. ");
    if (!isAllowedLinkedInNavigation(page.url())) {
      throw new CliError("E_BROWSER", "The visible browser left the allowed LinkedIn origin.");
    }
    const items = await renderedExperienceItems(page);
    return parseLinkedInBrowserItems(items);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_BROWSER", "The visible LinkedIn browser could not complete capture.", { cause: error });
  } finally {
    try {
      await browser?.close();
    } catch {
      ownedProcess?.kill("SIGTERM");
    }
  }
}

async function renderedExperienceItems(page: Page): Promise<LinkedInBrowserItem[]> {
  return page.evaluate(() => {
    const root = document.querySelector("#experience")?.closest("section") ?? document.querySelector("main");
    const nodes = root ? Array.from(root.querySelectorAll("li")) : [];
    return nodes.slice(0, 500).map((node) => ({
      text: (node.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, 16_384),
      logoUrl: node.querySelector<HTMLImageElement>("img")?.currentSrc.slice(0, 2_048) || undefined,
    })).filter((item) => item.text.length > 0);
  });
}
