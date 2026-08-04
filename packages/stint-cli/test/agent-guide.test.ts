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
    expect(agentGuideMarkdown).toContain("complete_with_handoff");
    expect(agentGuideMarkdown).toContain("visible browser");
    expect(agentGuideMarkdown).toContain("we don't send your profile or project data to Stint servers");
  });
});
