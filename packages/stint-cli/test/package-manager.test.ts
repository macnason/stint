import { describe, expect, it } from "vitest";

import { installReceipt, planPackageInstall } from "../src/setup/package-manager.js";

describe("package manager plans", () => {
  it("builds shell-free exact install argv with scripts disabled", () => {
    const plan = planPackageInstall("npm", "@macworks/stint", "1.0.0-next.1");
    expect(plan.argv).toContain("--ignore-scripts");
    expect(plan.argv).toContain("@macworks/stint@1.0.0-next.1");
    expect(plan.command).toBe("npm");
    expect(installReceipt(plan, "planned")).toMatchObject({ status: "planned", resumeAction: "inspect-lockfile" });
    expect(planPackageInstall("bun", "@macworks/stint", "1.0.0-next.1").argv).toContain("--ignore-scripts");
  });

  it("rejects registry credentials and shell-shaped package input", () => {
    expect(() => planPackageInstall("npm", "bad;echo", "1.0.0")).toThrow(/exact registry/i);
    expect(() => planPackageInstall("npm", "@macworks/stint", "latest")).toThrow(/semver/i);
    expect(() => planPackageInstall("npm", "@macworks/stint", "1.0.0", "https://user:pass@example.com/")).toThrow(/HTTPS registry/i);
    expect(() => planPackageInstall("npm", "@macworks/stint", "1.0.0", "https://registry.example.com/")).toThrow(/HTTPS registry/i);
  });
});
