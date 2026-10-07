import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import {
  recommendOnboarding,
  type AgentBrowserCapability,
} from "../src/setup/onboarding.js";

const directories: string[] = [];
const browser: AgentBrowserCapability = {
  tool: "agent-browser",
  available: true,
  interactive: false,
  access: "ready",
};
const url = "https://www.linkedin.com/in/example";
function project() {
  const root = mkdtempSync(join(tmpdir(), "stint-onboarding-"));
  directories.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { vite: "8" } })
  );
  return root;
}
async function invoke(args: string[]) {
  let stdout = "",
    stderr = "";
  const status = await runCli(args, {
    isTTY: false,
    writeOut: (s) => {
      stdout += s;
    },
    writeError: (s) => {
      stderr += s;
    },
  });
  return { status, result: stdout ? JSON.parse(stdout) : undefined, stderr };
}
afterEach(() => {
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

describe("capability-aware onboarding", () => {
  it("asks the agent to inspect tools rather than assuming an installed browser is usable", () => {
    expect(recommendOnboarding().route).toBe("inspect-agent-tools");
    expect(recommendOnboarding().next).toContain("shared browser");
  });
  it.each([
    "agent-browser",
    "puppeteer",
    "playwright",
    "shared-browser",
    "other",
  ] as const)("reuses an accessible %s session, including headless", (tool) => {
    expect(recommendOnboarding({ ...browser, tool })).toMatchObject({
      route: "agent-browser",
      action: "capture-experience",
      tool,
    });
  });
  it("inspects unknown access and hands interactive sign-in to the person", () => {
    expect(
      recommendOnboarding({ ...browser, access: "unknown" })
    ).toMatchObject({ route: "agent-browser", action: "inspect-profile" });
    expect(
      recommendOnboarding({
        ...browser,
        access: "sign-in-required",
        interactive: true,
      })
    ).toMatchObject({ route: "agent-browser", action: "human-sign-in" });
  });
  it("falls back without retrying unavailable, blocked, or noninteractive sign-in", () => {
    for (const capability of [
      { ...browser, available: false },
      { ...browser, access: "blocked" as const },
      { ...browser, access: "sign-in-required" as const },
    ]) {
      expect(recommendOnboarding(capability).route).toBe("local-file");
    }
    expect(recommendOnboarding(browser, false).route).toBe("local-file");
  });
  it("accepts a LinkedIn URL as a source without fetching, launching, or writing", async () => {
    const root = project();
    const fetch = vi.spyOn(globalThis, "fetch");
    const { status, result } = await invoke([
      "setup",
      `${url}?tracking=example#experience`,
      "--project",
      root,
      "--apply",
      "--json",
    ]);
    expect(status).toBe(0);
    expect(result).toMatchObject({
      state: "needs_browser_capabilities",
      applied: false,
      profileUrl: url,
      onboarding: { route: "inspect-agent-tools" },
    });
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lets agents coordinate an existing browser in non-TTY mode", async () => {
    const root = project();
    const answers = join(root, "answers.json");
    writeFileSync(
      answers,
      JSON.stringify({ version: 1, capabilities: { browser } })
    );
    const { status, result } = await invoke([
      "setup",
      url,
      "--project",
      root,
      "--answers",
      answers,
      "--json",
    ]);
    expect(status).toBe(0);
    expect(result).toMatchObject({
      state: "needs_browser_capture",
      onboarding: { tool: "agent-browser", action: "capture-experience" },
      browserCapture: { nextCommand: ["setup", "draft.json", "--json"] },
    });
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
  });
  it("returns a sign-in handoff or local fallback based on observed capability", async () => {
    const root = project(),
      answers = join(root, "answers.json");
    for (const [interactive, state] of [
      [true, "waiting_for_browser_sign_in"],
      [false, "needs_source_choice"],
    ] as const) {
      writeFileSync(
        answers,
        JSON.stringify({
          version: 1,
          capabilities: {
            browser: { ...browser, interactive, access: "sign-in-required" },
          },
        })
      );
      const result = await invoke([
        "setup",
        url,
        "--project",
        root,
        "--answers",
        answers,
        "--json",
      ]);
      expect(result.status).toBe(0);
      expect(result.result.state).toBe(state);
    }
  });
  it("rejects malformed capability reports rather than interpreting truthy values", async () => {
    const root = project(),
      answers = join(root, "answers.json");
    writeFileSync(
      answers,
      JSON.stringify({
        version: 1,
        capabilities: { browser: { ...browser, available: "false" } },
      })
    );
    const result = await invoke([
      "setup",
      url,
      "--project",
      root,
      "--answers",
      answers,
      "--json",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("E_ANSWERS");
  });
  it("provides the canonical guide and discovery from the CLI", async () => {
    const guide = await invoke(["guide", "--json"]);
    expect(guide.status).toBe(0);
    expect(guide.result.markdown).toContain("One coordinating agent");
    expect(guide.result.browserCapture.schemaExample.schemaVersion).toBe(1);
    const doctor = await invoke(["doctor", "--project", project(), "--json"]);
    expect(doctor.result.capabilities).toMatchObject({
      localDocumentImport: true,
      browserSession: "not-inspected",
    });
    expect(doctor.result.onboarding.route).toBe("inspect-agent-tools");
  });
  it.each([
    "https://static.licdn.com/in/example",
    "https://user:password@www.linkedin.com/in/example",
    "https://www.linkedin.com/in/",
    "https://evil.example/in/example",
  ])("rejects misleading profile input %s", async (source) => {
    const result = await invoke([
      "setup",
      source,
      "--project",
      project(),
      "--json",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("E_URL");
    expect(result.stderr).not.toContain("password@");
  });
});
