import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];
const checkoutPin = "08eba0b27e820071cde6df949e0beb9ba4906955";
const setupNodePin = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const uploadArtifactPin = "ea165f8d65b6e75b540449e92b4886f43607fa02";
const downloadArtifactPin = "d3f86a106a0bac45b974a628896c90dbdf5c8093";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release workflow authority", () => {
  it("runs the complete package gates in CI", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain(`actions/checkout@${checkoutPin}`);
    expect(workflow).toContain(`actions/setup-node@${setupNodePin}`);
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run test --workspaces --if-present");
    expect(workflow).toContain("npm run test:policy");
    expect(workflow).toContain("npm run build --workspaces --if-present");
    expect(workflow).toContain("npm run package:dry-run");
    expect(workflow).toContain("npm run release:verify:u7");
    expect(workflow).not.toContain("npm run release:verify:u11");
    expect(workflow).not.toContain("npm run release:preflight:local");
    expect(workflow).toContain("npm run build");
    expectUnversionedActionsToBeAbsent(workflow);
  });

  // The CLI imports @macworks/stint/schema, which resolves into the runtime's
  // dist. Any workflow that tests before building fails on a clean checkout.
  // ci.yml was fixed for this once; release.yml was not, and the bug only
  // surfaced on a release dispatch.
  it.each([".github/workflows/ci.yml", ".github/workflows/release.yml"])(
    "builds workspaces before testing them in %s",
    (path) => {
      const workflow = read(path);
      const build = workflow.indexOf("npm run build --workspaces --if-present");
      const test = workflow.indexOf("npm run test --workspaces --if-present");

      expect(build, "workflow must build workspaces").toBeGreaterThan(-1);
      expect(test, "workflow must test workspaces").toBeGreaterThan(-1);
      expect(build, "build must precede test").toBeLessThan(test);
    },
  );

  it("keeps build and lifecycle code outside the OIDC publishing job", () => {
    const workflow = read(".github/workflows/release.yml");
    const publishJob = workflow.slice(workflow.indexOf("\n  publish:"));

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
    expect(workflow).toContain("environment:\n      name: stint-npm-release");
    expect(workflow).toContain("github.ref_protected == true");
    expect(workflow).toContain(`actions/checkout@${checkoutPin}`);
    expect(workflow).toContain(`actions/setup-node@${setupNodePin}`);
    expect(workflow).toContain(`actions/upload-artifact@${uploadArtifactPin}`);
    expect(workflow).toContain(`actions/download-artifact@${downloadArtifactPin}`);
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(workflow).toContain("npm run release:preflight -- --channel");
    expect(workflow.match(/- run: npm run test:policy/g)).toHaveLength(1);
    expect(workflow).toContain("sha256sum --check release-candidate.sha256");
    expect(workflow).toContain(
      "EXPECTED_ARTIFACT_DIGEST: ${{ needs.candidate.outputs.artifact-digest }}",
    );
    expect(workflow).toContain("node stint-release.mjs --channel");
    expect(publishJob).not.toContain("actions/checkout@");
    expect(publishJob).not.toContain("npm ci");
    expect(publishJob).not.toMatch(/npm run (?:lint|test|build|package)/);
    expect(publishJob).not.toContain("npm install");
    expectUnversionedActionsToBeAbsent(workflow);
  });
});

describe("release preflight", () => {
  it("allows a versioned local candidate with private placeholder packages after U7 and U11 pass", () => {
    const fixture = createFixture({ localCandidate: true });
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    expect(runPreflight(fixture, "local")).toMatchObject({
      channel: "local",
      publishable: false,
      gates: { u7: "passed", u11: "passed" },
    });
  });

  it("blocks next for placeholder names, private packages, and missing remote identity", () => {
    const fixture = createFixture();
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    const result = runPreflightFailure(fixture, "next");

    expect(result).toContain("placeholder package name");
    expect(result).toContain("must not be private");
    expect(result).toContain("version must be 1.0.0-next.0");
    expect(result).toContain("license metadata is required");
    expect(result).toContain("STINT_NPM_OWNER is required");
    expect(result).toContain("STINT_TRUSTED_PUBLISHER is required");
  });

  it("blocks version drift and stale or hand-touched gate evidence", () => {
    const fixture = createFixture({ publishable: true });
    writeGateEvidence(fixture, "u7", { version: "0.9.0" });
    writeFileSync(join(fixture, ".context/release-gates/u11.json"), "");

    const result = runPreflightFailure(fixture, "next", remoteEnvironment());

    expect(result).toContain("u7 gate evidence does not match package versions");
    expect(result).toContain("u11 gate evidence is not valid JSON");
  });

  it("blocks drift between package and documented candidate versions", () => {
    const fixture = createFixture({ publishable: true });
    writeFileSync(
      join(fixture, "docs/release/stint.md"),
      "# Release policy\n\nCandidate version: `1.0.0-next.1`\n",
    );
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    expect(runPreflightFailure(fixture, "next", remoteEnvironment())).toContain(
      "release docs candidate version must match runtime and CLI versions",
    );
  });

  // U9 (the portfolio drawer/grid gate) no longer gates latest. It lived in the
  // portfolio repository and cannot run here; per plan revision 2 the live docs
  // site plus the public URL requirements replace it. STINT_PUBLIC_DOCS_URL is
  // what now carries that requirement.
  it("requires public URLs and approval for latest, but no portfolio gate", () => {
    const fixture = createFixture({ publishable: true });
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    expect(runPreflight(fixture, "next", remoteEnvironment())).toMatchObject({
      channel: "next",
      publishable: true,
      gates: { u7: "passed", u11: "passed" },
    });

    const result = runPreflightFailure(fixture, "latest", remoteEnvironment());
    expect(result).not.toContain("u9");
    expect(result).toContain("STINT_PUBLIC_RUNTIME_NPM_URL is required");
    expect(result).toContain("STINT_PUBLIC_CLI_NPM_URL is required");
    expect(result).toContain("STINT_PUBLIC_SOURCE_URL is required");
    expect(result).toContain("STINT_PUBLIC_DOCS_URL is required");
    expect(result).toContain("STINT_LATEST_APPROVED must be true");
  });

  it("allows latest with public URLs and explicit approval", () => {
    const fixture = createFixture({ publishable: true });
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    expect(
      runPreflight(fixture, "latest", {
        ...remoteEnvironment(),
        STINT_PUBLIC_RUNTIME_NPM_URL:
          "https://www.npmjs.com/package/@macworks/stint",
        STINT_PUBLIC_CLI_NPM_URL:
          "https://www.npmjs.com/package/@macworks/stint-cli",
        STINT_PUBLIC_SOURCE_URL: "https://github.com/macnason/stint",
        STINT_PUBLIC_DOCS_URL: "https://stint.macnason.com",
        STINT_LATEST_APPROVED: "true",
      }),
    ).toMatchObject({
      channel: "latest",
      publishable: true,
      gates: { u7: "passed", u11: "passed" },
    });
  });

  it("binds npm ownership and public URLs to their exact release roles", () => {
    const fixture = createFixture({ publishable: true });
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    const result = runPreflightFailure(fixture, "latest", {
      ...remoteEnvironment(),
      STINT_NPM_OWNER: "someone-else",
      STINT_PUBLIC_RUNTIME_NPM_URL:
        "https://www.npmjs.com/package/@macworks/stint-cli",
      STINT_PUBLIC_CLI_NPM_URL: "https://127.0.0.1/@macworks/stint-cli",
      STINT_PUBLIC_SOURCE_URL: "https://github.com/unrelated/repository",
      STINT_PUBLIC_DOCS_URL: "https://192.168.1.2/docs",
      STINT_LATEST_APPROVED: "true",
    });

    expect(result).toContain("STINT_NPM_OWNER must exactly match both package scopes");
    expect(result).toContain(
      "STINT_PUBLIC_RUNTIME_NPM_URL must be the public npm URL for @macworks/stint",
    );
    expect(result).toContain(
      "STINT_PUBLIC_CLI_NPM_URL must be the public npm URL for @macworks/stint-cli",
    );
    expect(result).toContain(
      "STINT_PUBLIC_SOURCE_URL must be the public GitHub URL for macnason/stint",
    );
    expect(result).toContain("STINT_PUBLIC_DOCS_URL must be a public HTTPS URL");
  });

  it.each([
    "https://localhost/docs",
    "https://127.0.0.1/docs",
    "https://169.254.1.2/docs",
    "https://192.0.2.1/docs",
    "https://[::1]/docs",
    "https://[fe80::1]/docs",
    "https://docs.example/docs",
  ])("rejects a non-public docs host: %s", (docsUrl) => {
    const fixture = createFixture({ publishable: true });
    writeGateEvidence(fixture, "u7");
    writeGateEvidence(fixture, "u11");

    const result = runPreflightFailure(fixture, "latest", {
      ...remoteEnvironment(),
      STINT_PUBLIC_RUNTIME_NPM_URL:
        "https://www.npmjs.com/package/@macworks/stint",
      STINT_PUBLIC_CLI_NPM_URL:
        "https://www.npmjs.com/package/@macworks/stint-cli",
      STINT_PUBLIC_SOURCE_URL: "https://github.com/macnason/stint",
      STINT_PUBLIC_DOCS_URL: docsUrl,
      STINT_LATEST_APPROVED: "true",
    });

    expect(result).toContain("STINT_PUBLIC_DOCS_URL must be a public HTTPS URL");
  });
});

describe("release gate evidence", () => {
  it("deletes stale evidence before a failing gate command", () => {
    const fixture = createFixture();
    const evidencePath = join(fixture, ".context/release-gates/u7.json");
    writeFileSync(evidencePath, '{"status":"passed"}\n');

    const result = runGate(fixture, "u7", [process.execPath, "-e", "process.exit(7)"]);

    expect(result.status).toBe(7);
    expect(() => readFileSync(evidencePath, "utf8")).toThrow();
  });

  it("writes complete evidence only after a successful gate command", () => {
    const fixture = createFixture();
    const command = [process.execPath, "-e", "process.exit(0)"];

    const result = runGate(fixture, "u11", command);

    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(
      readFileSync(join(fixture, ".context/release-gates/u11.json"), "utf8"),
    );
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      gate: "u11",
      status: "passed",
      commit: "test-sha",
      runId: "test-run",
      command,
    });
    expect(evidence.packages).toHaveLength(2);
    expect(new Date(evidence.completedAt).toISOString()).toBe(evidence.completedAt);
  });
});

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function expectUnversionedActionsToBeAbsent(workflow: string): void {
  for (const match of workflow.matchAll(/uses:\s*([^\s]+)/g)) {
    expect(match[1], `action must be pinned: ${match[1]}`).toMatch(/@[0-9a-f]{40}$/);
  }
}

function createFixture(
  options: { publishable?: boolean; localCandidate?: boolean } = {},
): string {
  const fixture = mkdtempSync(join(tmpdir(), "stint-release-policy-"));
  temporaryDirectories.push(fixture);
  mkdirSync(join(fixture, "packages/stint-cli"), { recursive: true });
  mkdirSync(join(fixture, ".changeset"), { recursive: true });
  mkdirSync(join(fixture, ".context/release-gates"), { recursive: true });
  mkdirSync(join(fixture, "docs/release"), { recursive: true });
  cpSync(
    resolve(repositoryRoot, "scripts/stint-release-preflight.mjs"),
    join(fixture, "stint-release-preflight.mjs"),
  );

  const publishable = options.publishable ?? false;
  const runtimeName = publishable ? "@macworks/stint" : "@portfolio/stint";
  const cliName = publishable ? "@macworks/stint-cli" : "@portfolio/stint-cli";
  const version = publishable || options.localCandidate ? "1.0.0-next.0" : "0.0.0";
  const metadata = publishable
    ? {
        license: "MIT",
        repository: {
          type: "git",
          url: "git+https://github.com/macnason/stint.git",
        },
        homepage: "https://stint.macnason.com",
        publishConfig: { access: "public" },
      }
    : {};

  writeJson(join(fixture, "packages/stint/package.json"), {
    name: runtimeName,
    version,
    private: !publishable,
    ...metadata,
  });
  writeJson(join(fixture, "packages/stint-cli/package.json"), {
    name: cliName,
    version,
    private: !publishable,
    dependencies: { [runtimeName]: version },
    ...metadata,
  });
  writeJson(join(fixture, ".changeset/config.json"), {
    fixed: [[runtimeName, cliName]],
  });
  writeFileSync(
    join(fixture, "docs/release/stint.md"),
    `# Release policy\n\nCandidate version: \`${version}\`\n`,
  );
  return fixture;
}

function writeGateEvidence(
  fixture: string,
  gate: "u7" | "u11",
  overrides: { version?: string } = {},
): void {
  const runtime = JSON.parse(
    readFileSync(join(fixture, "packages/stint/package.json"), "utf8"),
  ) as { name: string; version: string };
  const cli = JSON.parse(
    readFileSync(join(fixture, "packages/stint-cli/package.json"), "utf8"),
  ) as { name: string; version: string };
  writeJson(join(fixture, `.context/release-gates/${gate}.json`), {
    schemaVersion: 1,
    gate,
    status: "passed",
    commit: "test-sha",
    runId: "test-run",
    packages: [
      { name: runtime.name, version: overrides.version ?? runtime.version },
      { name: cli.name, version: overrides.version ?? cli.version },
    ],
  });
}

function remoteEnvironment(): NodeJS.ProcessEnv {
  return {
    STINT_NPM_OWNER: "macworks",
    STINT_TRUSTED_PUBLISHER:
      "macnason/stint:.github/workflows/release.yml:stint-npm-release",
    STINT_PROTECTED_ENVIRONMENT: "stint-npm-release",
    GITHUB_REPOSITORY: "macnason/stint",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF_PROTECTED: "true",
  };
}

function runPreflight(
  fixture: string,
  channel: "local" | "next" | "latest",
  environment: NodeJS.ProcessEnv = {},
): Record<string, unknown> {
  const result = executePreflight(fixture, channel, environment);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function runPreflightFailure(
  fixture: string,
  channel: "next" | "latest",
  environment: NodeJS.ProcessEnv = {},
): string {
  const result = executePreflight(fixture, channel, environment);
  expect(result.status).not.toBe(0);
  return result.stderr;
}

/**
 * The preflight reads release identity from the environment, and the release
 * workflow sets those same variables for real. Inheriting them would make these
 * tests assert against the ambient release environment rather than their own
 * fixtures — passing under ci.yml and failing under release.yml. Everything the
 * preflight consults is stripped, so each case states its own world.
 */
function hermeticEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("STINT_") || key.startsWith("GITHUB_")) continue;
    environment[key] = value;
  }
  return environment;
}

function executePreflight(
  fixture: string,
  channel: "local" | "next" | "latest",
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync(
    process.execPath,
    [join(fixture, "stint-release-preflight.mjs"), "--root", fixture, "--channel", channel],
    {
      encoding: "utf8",
      env: {
        ...hermeticEnvironment(),
        GITHUB_SHA: "test-sha",
        STINT_GATE_RUN_ID: "test-run",
        ...environment,
      },
    },
  );
}

function runGate(fixture: string, gate: "u7" | "u11", command: string[]) {
  return spawnSync(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/run-release-gate.mjs"),
      "--gate",
      gate,
      "--",
      ...command,
    ],
    {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_SHA: "test-sha",
        STINT_GATE_RUN_ID: "test-run",
      },
    },
  );
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
