import { describe, expect, it } from "vitest";

import { systemChromeCandidates } from "../src/browser/chrome.js";

describe("system Chrome discovery", () => {
  it("finds stable and Canary Chrome in system and user Applications folders", () => {
    expect(systemChromeCandidates("darwin", "/Users/example")).toEqual(
      expect.arrayContaining([
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Users/example/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Users/example/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ]),
    );
  });
});
