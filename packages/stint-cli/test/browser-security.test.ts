import { describe, expect, it } from "vitest";

import { isAllowedLinkedInNavigation, validateLinkedInProfileUrl } from "../src/browser/security.js";

describe("LinkedIn browser trust boundary", () => {
  it("accepts only HTTPS profile URLs", () => {
    expect(validateLinkedInProfileUrl("https://www.linkedin.com/in/example").hostname).toBe("www.linkedin.com");
    expect(() => validateLinkedInProfileUrl("http://www.linkedin.com/in/example")).toThrow(/HTTPS/i);
    expect(() => validateLinkedInProfileUrl("https://example.com/in/example")).toThrow(/LinkedIn/i);
  });

  it("allows only LinkedIn navigation origins", () => {
    expect(isAllowedLinkedInNavigation("https://www.linkedin.com/feed/")).toBe(true);
    expect(isAllowedLinkedInNavigation("https://linkedin.com/login")).toBe(true);
    expect(isAllowedLinkedInNavigation("https://static.licdn.com/assets/app.js")).toBe(true);
    expect(isAllowedLinkedInNavigation("https://www.linkedin.com:444/login")).toBe(false);
    expect(isAllowedLinkedInNavigation("https://evil.example/login")).toBe(false);
    expect(isAllowedLinkedInNavigation("javascript:alert(1)")).toBe(false);
  });
});
