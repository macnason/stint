import { describe, expect, it } from "vitest";

import { agentGuideMarkdown, agentPrompt, guideBundle, llmsText, stintCliVersion } from "../src/agent-guide.js";

describe("canonical agent guide", () => {
  it("keeps copied prompt, Markdown, and llms content on one source", () => {
    const bundle = guideBundle();
    expect(bundle.version).toBe(stintCliVersion);
    expect(bundle.prompt).toBe(agentPrompt);
    expect(bundle.markdown).toBe(agentGuideMarkdown);
    expect(bundle.llms).toBe(llmsText);
    expect(agentPrompt).toContain("npx @macworks/stint-cli setup --json");
    expect(agentPrompt).toContain("Keep setup in this chat by default");
    expect(agentPrompt).toContain("Do not start a web server or open the upload wizard by default");
    expect(agentGuideMarkdown).toContain("complete_with_handoff");
    expect(agentGuideMarkdown).toContain("visible browser");
    expect(agentGuideMarkdown).toContain("we don't send your profile or project data to Stint servers");
    expect(agentPrompt).toContain("the person signs in there");
    expect(agentPrompt).toContain("never enter passwords, MFA, or CAPTCHA");
    expect(agentPrompt).toContain("Don't run a separate doctor step");
    expect(agentPrompt).toContain("Don't call setup complete just because the data file exists");
    expect(agentPrompt).toContain("npx @macworks/stint-cli logos");
    expect(agentPrompt).toContain("Never fetch, crop, resize or restyle logos by hand");
    expect(agentGuideMarkdown).toContain("## Company logos");
    expect(agentGuideMarkdown).toContain("logos={stintLogos}");
  });
});
